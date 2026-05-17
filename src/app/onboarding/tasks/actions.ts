"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createServiceClient } from "@/lib/supabase/server";

// --- Picker draft save ----------------------------------------------------
//
// Called fire-and-forget by the picker on every toggle. Best-effort —
// silently no-ops on empty or stale state so a mid-typing race doesn't
// surface to the user. Role-agnostic; RLS still gates owner-or-maid.

const draftIdsSchema = z.array(z.string().uuid());

export async function saveDraftAction(pickedTaskIds: string[]): Promise<void> {
  const parsed = draftIdsSchema.safeParse(pickedTaskIds);
  if (!parsed.success) return;
  const ctx = await getCurrentHousehold();
  if (!ctx) return;
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    return;
  }
  if (ctx.household.maid_mode === "unset") return;
  if (ctx.household.task_setup_completed_at !== null) return;

  const svc = createServiceClient();
  await svc.from("task_setup_drafts").upsert(
    {
      household_id: ctx.household.id,
      picked_task_ids: parsed.data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  );
}

// --- Picker finalize ------------------------------------------------------
//
// Clones picked standards into household-owned tasks using each standard's
// seed defaults (frequency / interval / byweekday / bymonthday / due_time).
// No per-task tuning, no assignee — Home Mode users typically have no other
// active members at this point, and tasks default to "anyone". Returns
// { error } so the client can stay in place on failure; on success the
// client navigates to /dashboard itself.

export async function finalizePicksAction(
  pickedTaskIds: string[],
): Promise<{ error: string } | void> {
  const parsed = draftIdsSchema.safeParse(pickedTaskIds);
  if (!parsed.success) return { error: "invalid picks" };
  if (parsed.data.length === 0) return { error: "pick at least one task" };

  const ctx = await getCurrentHousehold();
  if (!ctx) return { error: "no active household" };
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    return { error: "only owner or maid can run task setup" };
  }
  if (ctx.household.maid_mode === "unset") return { error: "set household mode first" };
  if (ctx.household.task_setup_completed_at !== null) {
    // Already done in another tab — treat as success; caller will navigate.
    return;
  }

  const svc = createServiceClient();

  // Load picked standards' full defaults.
  const standardIds = Array.from(new Set(parsed.data));
  const stdRes = await svc
    .from("tasks")
    .select(
      "id, title, notes, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time",
    )
    .is("household_id", null)
    .is("archived_at", null)
    .in("id", standardIds);
  if (stdRes.error) return { error: stdRes.error.message };
  const stdById = new Map(stdRes.data.map((r) => [r.id, r]));
  for (const id of standardIds) {
    if (!stdById.has(id)) return { error: "unknown standard task id" };
  }

  // CAS-claim the setup gate atomically.
  const claim = await svc
    .from("households")
    .update({ task_setup_completed_at: new Date().toISOString() })
    .eq("id", ctx.household.id)
    .is("task_setup_completed_at", null)
    .select("id");
  if (claim.error) return { error: claim.error.message };
  if ((claim.data ?? []).length === 0) {
    // Lost the race — another tab finished first.
    return;
  }

  const todayYmd = new Date().toISOString().slice(0, 10);
  const inserts = standardIds.map((id) => {
    const std = stdById.get(id)!;
    return {
      household_id: ctx.household.id,
      title: std.title,
      notes: std.notes ?? null,
      assigned_to_profile_id: null as string | null,
      recurrence_frequency: std.recurrence_frequency,
      recurrence_interval: std.recurrence_interval,
      recurrence_byweekday: std.recurrence_byweekday ?? null,
      recurrence_bymonthday: std.recurrence_bymonthday ?? null,
      due_time: std.due_time,
      created_by_profile_id: ctx.profile.id,
      recurrence_starts_on: todayYmd,
    };
  });

  try {
    const insRes = await svc.from("tasks").insert(inserts);
    if (insRes.error) throw new Error(insRes.error.message);

    // Hide ALL standards for this household (so un-picked standards never
    // seed occurrences).
    const allStd = await svc
      .from("tasks")
      .select("id")
      .is("household_id", null)
      .is("archived_at", null);
    if (allStd.error) throw new Error(allStd.error.message);
    const hideRows = allStd.data.map((r) => ({
      household_id: ctx.household.id,
      task_id: r.id,
      hidden_by_profile_id: ctx.profile.id,
    }));
    if (hideRows.length > 0) {
      const hideRes = await svc
        .from("household_task_hides")
        .upsert(hideRows, { onConflict: "household_id,task_id" });
      if (hideRes.error) throw new Error(hideRes.error.message);
    }

    await svc.from("task_setup_drafts").delete().eq("household_id", ctx.household.id);

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);
    const horizonYmd = horizon.toISOString().slice(0, 10);
    await svc.rpc("tasks_generate_occurrences", { p_horizon_date: horizonYmd });
  } catch (err) {
    await svc
      .from("households")
      .update({ task_setup_completed_at: null })
      .eq("id", ctx.household.id);
    return { error: err instanceof Error ? err.message : "task setup failed" };
  }

  revalidatePath("/dashboard");
}

// --- Re-run setup (only when household has zero tasks) --------------------
//
// Recovery path for households whose tasks were wiped (e.g. by a migration)
// but whose `task_setup_completed_at` latch is still set. The zero-tasks
// guard keeps this safe to expose: households with real tasks can never
// trip it. RLS still gates owner-or-maid.

export async function resetTaskSetupForEmptyState() {
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    throw new Error("only owner or maid can run task setup");
  }
  if (ctx.household.task_setup_completed_at === null) {
    redirect("/onboarding/tasks");
  }

  const svc = createServiceClient();

  const countRes = await svc
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("household_id", ctx.household.id);
  if (countRes.error) throw new Error(countRes.error.message);
  if ((countRes.count ?? 0) > 0) throw new Error("household still has tasks");

  await svc.from("task_setup_drafts").delete().eq("household_id", ctx.household.id);
  await svc.from("household_task_hides").delete().eq("household_id", ctx.household.id);

  const reset = await svc
    .from("households")
    .update({ task_setup_completed_at: null })
    .eq("id", ctx.household.id);
  if (reset.error) throw new Error(reset.error.message);

  revalidatePath("/dashboard");
  redirect("/onboarding/tasks");
}
