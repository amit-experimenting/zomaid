import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { PickForm } from "./pick-form";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksPickPage() {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner") redirect("/dashboard");
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  const standardsRes = await svc
    .from("tasks")
    .select(
      "id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time",
    )
    .is("household_id", null)
    .is("archived_at", null)
    .order("recurrence_frequency", { ascending: true })
    .order("title", { ascending: true });
  if (standardsRes.error) throw new Error(standardsRes.error.message);

  const draftRes = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draftRes.error && draftRes.error.code !== "PGRST116") {
    throw new Error(draftRes.error.message);
  }
  const initialPicks = draftRes.data?.picked_task_ids ?? [];

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Set up your tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 1 of 2 — pick the chores that apply to your home.
      </p>
      <div className="mt-6">
        <PickForm standards={standardsRes.data ?? []} initialPicks={initialPicks} />
      </div>
    </main>
  );
}
