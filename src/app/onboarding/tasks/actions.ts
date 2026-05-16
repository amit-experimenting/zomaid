"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createServiceClient } from "@/lib/supabase/server";

// --- Stage 1: save picks --------------------------------------------------

const savePicksSchema = z.object({
  standardTaskIds: z.array(z.string().uuid()).min(1),
});

export async function saveTaskSetupPicks(input: unknown) {
  const data = savePicksSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can run task setup");
  if (ctx.household.maid_mode === "unset") throw new Error("set household mode first");
  if (ctx.household.task_setup_completed_at !== null) throw new Error("task setup already completed");

  // Validate every picked id is in fact a current standard task.
  const svc = createServiceClient();
  const standards = await svc
    .from("tasks")
    .select("id")
    .is("household_id", null)
    .is("archived_at", null);
  if (standards.error) throw new Error(standards.error.message);
  const validIds = new Set(standards.data.map((r) => r.id));
  const bad = data.standardTaskIds.filter((id) => !validIds.has(id));
  if (bad.length > 0) throw new Error("unknown standard task id");

  const upsert = await svc
    .from("task_setup_drafts")
    .upsert(
      {
        household_id: ctx.household.id,
        picked_task_ids: data.standardTaskIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );
  if (upsert.error) throw new Error(upsert.error.message);

  redirect("/onboarding/tasks/tune");
}

// --- Stage 2: submit final setup ------------------------------------------

const entrySchema = z
  .object({
    standardTaskId: z.string().uuid(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.coerce.number().int().min(1).max(60),
    byweekday: z.array(z.coerce.number().int().min(0).max(6)).optional(),
    bymonthday: z.coerce.number().int().min(1).max(31).optional(),
    dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    assigneeProfileId: z.union([z.string().uuid(), z.literal("anyone")]),
  })
  .refine(
    (v) =>
      (v.frequency === "weekly" && !!v.byweekday && v.byweekday.length > 0) ||
      v.frequency !== "weekly",
    { message: "weekly requires byweekday" },
  )
  .refine(
    (v) => (v.frequency === "monthly" && typeof v.bymonthday === "number") || v.frequency !== "monthly",
    { message: "monthly requires bymonthday" },
  );

const submitSchema = z.object({
  entries: z.array(entrySchema).min(1),
});

export async function submitTaskSetup(input: unknown) {
  const data = submitSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can run task setup");
  if (ctx.household.maid_mode === "unset") throw new Error("set household mode first");
  if (ctx.household.task_setup_completed_at !== null) {
    // Already done in another tab; treat as no-op + redirect.
    redirect("/dashboard");
  }

  const svc = createServiceClient();

  // Validate assignees are active members of this household.
  const assigneeIds = Array.from(
    new Set(
      data.entries
        .map((e) => e.assigneeProfileId)
        .filter((v): v is string => v !== "anyone"),
    ),
  );
  if (assigneeIds.length > 0) {
    const mem = await svc
      .from("household_memberships")
      .select("profile_id")
      .eq("household_id", ctx.household.id)
      .eq("status", "active")
      .in("profile_id", assigneeIds);
    if (mem.error) throw new Error(mem.error.message);
    const memberSet = new Set(mem.data.map((r) => r.profile_id));
    const missing = assigneeIds.filter((id) => !memberSet.has(id));
    if (missing.length > 0) throw new Error("assignee is not an active member");
  }

  // Load picked standards' title + notes.
  const standardIds = Array.from(new Set(data.entries.map((e) => e.standardTaskId)));
  const stdRes = await svc
    .from("tasks")
    .select("id, title, notes")
    .is("household_id", null)
    .in("id", standardIds);
  if (stdRes.error) throw new Error(stdRes.error.message);
  const stdById = new Map(stdRes.data.map((r) => [r.id, r]));
  for (const id of standardIds) {
    if (!stdById.has(id)) throw new Error("unknown standard task id");
  }

  // CAS-claim the setup gate atomically. Only the session that wins this
  // UPDATE (task_setup_completed_at IS NULL → timestamp) proceeds with
  // writes. Any concurrent session that already set the timestamp will
  // match zero rows and bail.
  const claim = await svc
    .from("households")
    .update({ task_setup_completed_at: new Date().toISOString() })
    .eq("id", ctx.household.id)
    .is("task_setup_completed_at", null)
    .select("id");
  if (claim.error) throw new Error(claim.error.message);
  if ((claim.data ?? []).length === 0) {
    // Lost the race — another tab finished first. Redirect without
    // doing any further writes.
    redirect("/dashboard");
  }

  // Insert household-owned cloned tasks.
  const inserts = data.entries.map((e) => {
    const std = stdById.get(e.standardTaskId)!;
    return {
      household_id: ctx.household.id,
      title: std.title,
      notes: std.notes ?? null,
      assigned_to_profile_id: e.assigneeProfileId === "anyone" ? null : e.assigneeProfileId,
      recurrence_frequency: e.frequency,
      recurrence_interval: e.interval,
      recurrence_byweekday: e.frequency === "weekly" ? (e.byweekday ?? null) : null,
      recurrence_bymonthday: e.frequency === "monthly" ? (e.bymonthday ?? null) : null,
      due_time: e.dueTime.length === 5 ? `${e.dueTime}:00` : e.dueTime,
      created_by_profile_id: ctx.profile.id,
      recurrence_starts_on: new Date().toISOString().slice(0, 10),
    };
  });
  const insRes = await svc.from("tasks").insert(inserts);
  if (insRes.error) throw new Error(insRes.error.message);

  // Hide ALL standards for this household (so even un-picked standards
  // never seed occurrences).
  const allStd = await svc.from("tasks").select("id").is("household_id", null).is("archived_at", null);
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

  // Drop the draft.
  await svc.from("task_setup_drafts").delete().eq("household_id", ctx.household.id);

  // Materialise today/this week so Home is non-empty on next render.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  const horizonYmd = horizon.toISOString().slice(0, 10);
  await svc.rpc("tasks_generate_occurrences", { p_horizon_date: horizonYmd });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
