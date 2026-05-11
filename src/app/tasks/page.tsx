import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/site/main-nav";
import { NotificationToggle } from "@/components/tasks/notification-toggle";
import { TodayList } from "@/components/tasks/_today-list";
import { OccurrenceRow, type OccurrenceRowItem } from "@/components/tasks/occurrence-row";

export default async function TasksIndex() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const isOwnerOrMaid = ctx.membership.role === "owner" || ctx.membership.role === "maid";

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startNextWeek = new Date(startToday); startNextWeek.setDate(startNextWeek.getDate() + 7);

  const { data: occRows } = await supabase
    .from("task_occurrences")
    .select("id, due_at, status, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))")
    .gte("due_at", startToday.toISOString())
    .lt("due_at", startNextWeek.toISOString())
    .order("due_at", { ascending: true });

  // Filter to caller's household via the joined tasks.household_id.
  const filtered = (occRows ?? []).filter((r: any) => r.tasks?.household_id === ctx.household.id);

  const toItem = (r: any): OccurrenceRowItem => ({
    occurrenceId: r.id,
    taskId: r.tasks.id,
    title: r.tasks.title,
    dueAt: r.due_at,
    assigneeName: Array.isArray(r.tasks.profiles)
      ? (r.tasks.profiles[0]?.display_name ?? null)
      : (r.tasks.profiles?.display_name ?? null),
    status: r.status,
  });

  const today = filtered.filter((r: any) => new Date(r.due_at) < startTomorrow).map(toItem);
  const upcoming = filtered.filter((r: any) => new Date(r.due_at) >= startTomorrow).map(toItem);

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="tasks" />
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Tasks</h1>
          {isOwnerOrMaid && <Link href="/tasks/new"><Button size="sm">+ New</Button></Link>}
        </div>
        {isOwnerOrMaid && <div className="mt-2"><NotificationToggle /></div>}
      </header>

      <section>
        <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today</h2>
        {today.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">Nothing for today.</p>
        ) : (
          <TodayList items={today} readOnly={!isOwnerOrMaid} />
        )}
      </section>

      <section>
        <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming (next 7 days)</h2>
        {upcoming.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">No upcoming occurrences.</p>
        ) : (
          upcoming.map((it) => (
            <OccurrenceRow key={it.occurrenceId} item={it} readOnly={!isOwnerOrMaid} onTap={() => {}} />
          ))
        )}
      </section>
    </main>
  );
}
