import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TuneForm, type StandardForTune, type AssigneeOption } from "./tune-form";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksTunePage() {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner") redirect("/dashboard");
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  const draft = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draft.error && draft.error.code !== "PGRST116") throw new Error(draft.error.message);
  const picks = draft.data?.picked_task_ids ?? [];
  if (picks.length === 0) redirect("/onboarding/tasks");

  const standardsRes = await svc
    .from("tasks")
    .select(
      "id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, assigned_to_profile_id",
    )
    .is("household_id", null)
    .in("id", picks);
  if (standardsRes.error) throw new Error(standardsRes.error.message);
  const standards = (standardsRes.data ?? []) as StandardForTune[];

  // Roster (active members) for the assignee dropdown.
  const memRes = await svc
    .from("household_memberships")
    .select("profile_id, role, profile:profiles(display_name, email)")
    .eq("household_id", ctx.household.id)
    .eq("status", "active");
  if (memRes.error) throw new Error(memRes.error.message);

  type Row = {
    profile_id: string;
    role: "owner" | "family_member" | "maid";
    profile: { display_name: string | null; email: string } | { display_name: string | null; email: string }[] | null;
  };
  const rows = (memRes.data ?? []) as unknown as Row[];

  const ownerSelf: AssigneeOption | null = (() => {
    const me = rows.find((r) => r.profile_id === ctx.profile.id);
    if (!me) return null;
    return { value: ctx.profile.id, label: "Me (owner)" };
  })();
  const family: AssigneeOption[] = rows
    .filter((r) => r.role === "family_member")
    .map((r) => {
      const p = Array.isArray(r.profile) ? r.profile[0] : r.profile;
      return { value: r.profile_id, label: p?.display_name || p?.email || "Family member" };
    });
  const maidRow = rows.find((r) => r.role === "maid");
  const maid: AssigneeOption | null = (() => {
    if (ctx.household.maid_mode !== "invited") return null;
    if (!maidRow) return null;
    const p = Array.isArray(maidRow.profile) ? maidRow.profile[0] : maidRow.profile;
    return { value: maidRow.profile_id, label: `Maid (${p?.display_name || p?.email || "joined"})` };
  })();

  const assignees: AssigneeOption[] = [
    ...(ownerSelf ? [ownerSelf] : []),
    ...family,
    ...(maid ? [maid] : []),
    { value: "anyone", label: "Anyone" },
  ];

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Tune your tasks</h1>
        <Link
          href="/onboarding/tasks"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← Back
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Step 2 of 2 — set how often, what time, and who does each.
      </p>
      <TuneForm standards={standards} assignees={assignees} />
    </main>
  );
}
