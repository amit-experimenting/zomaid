import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/site/main-nav";
import { NotificationToggle } from "@/components/tasks/notification-toggle";
import { TasksWeekStrip } from "@/components/tasks/tasks-week-strip";
import { DaySections, type DaySection } from "@/components/tasks/_day-sections";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";

const TZ = "Asia/Singapore";

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function sgLongLabel(ymd: string): string {
  // Anchor to noon SG to dodge DST edges (SG has none, but harmless).
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${ymd}T12:00:00+08:00`));
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TasksByDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!YMD_RE.test(date)) notFound();
  // Reject obviously bad dates (e.g. 2025-13-40). Date parsing will silently
  // roll bad inputs forward; round-trip via sgYmd to detect that.
  const probe = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(probe.getTime()) || sgYmd(probe) !== date) notFound();

  const ctx = await requireHousehold();
  const supabase = await createClient();
  const isOwnerOrMaid =
    ctx.membership.role === "owner" || ctx.membership.role === "maid";
  const canAddTasks = isOwnerOrMaid || ctx.membership.role === "family_member";

  const now = new Date();
  const todayYmd = sgYmd(now);
  const isToday = date === todayYmd;

  // Generate occurrences out far enough to cover the target date (idempotent).
  // For dates in the past, this no-ops; for future dates, ensures coverage.
  const horizonDate = addDays(new Date(`${date}T12:00:00+08:00`), 1);
  await supabase.rpc("tasks_generate_occurrences", {
    p_horizon_date: sgYmd(horizonDate),
  });

  // Pull a window covering: (overdue start) → end-of-target-day. When the
  // target IS today we also surface overdue items from before yesterday; when
  // target is a different day we just show that day's occurrences.
  const targetStart = new Date(`${date}T00:00:00+08:00`);
  const targetEnd = new Date(`${date}T00:00:00+08:00`);
  targetEnd.setDate(targetEnd.getDate() + 1);

  // For today: also pull pending occurrences with due_at < yesterday-start.
  const leftEdge = isToday
    ? new Date("1970-01-01T00:00:00Z")
    : targetStart;

  const { data: occRows } = await supabase
    .from("task_occurrences")
    .select(
      "id, due_at, status, household_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))",
    )
    .eq("household_id", ctx.household.id)
    .gte("due_at", leftEdge.toISOString())
    .lt("due_at", targetEnd.toISOString())
    .order("due_at", { ascending: true });

  type OccRow = {
    id: string;
    due_at: string;
    status: "pending" | "done" | "skipped";
    tasks: {
      id: string;
      title: string;
      household_id: string | null;
      profiles: { display_name: string } | { display_name: string }[] | null;
    };
  };
  const all = ((occRows ?? []) as unknown) as OccRow[];

  const toItem = (r: OccRow): OccurrenceRowItem => ({
    occurrenceId: r.id,
    taskId: r.tasks.id,
    title: r.tasks.title,
    dueAt: r.due_at,
    assigneeName: Array.isArray(r.tasks.profiles)
      ? (r.tasks.profiles[0]?.display_name ?? null)
      : (r.tasks.profiles?.display_name ?? null),
    status: r.status,
    isStandard: r.tasks.household_id === null,
  });

  // Split: overdue (only when viewing today) vs items on the target date.
  const yesterdayYmd = sgYmd(addDays(now, -1));
  const overdue: OccurrenceRowItem[] = [];
  const onDay: OccurrenceRowItem[] = [];

  for (const r of all) {
    const item = toItem(r);
    const itemYmd = sgYmd(new Date(item.dueAt));
    if (itemYmd === date) {
      onDay.push(item);
      continue;
    }
    // Only land here when isToday=true and the row predates today. Treat
    // pre-yesterday pending items as Overdue; yesterday's pending items also
    // surface here (matches the /tasks index behaviour).
    if (isToday && item.status === "pending" && itemYmd < todayYmd) {
      // Keep the rendering split: < yesterday → Overdue; == yesterday is
      // dropped since this page focuses on Today (the index view shows
      // Yesterday as its own section).
      if (itemYmd < yesterdayYmd) overdue.push(item);
    }
  }

  const sortItems = (xs: OccurrenceRowItem[]) =>
    xs.sort((a, b) => {
      const da = new Date(a.dueAt).getTime();
      const db = new Date(b.dueAt).getTime();
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title);
    });
  sortItems(overdue);
  sortItems(onDay);

  const headingLabel = isToday
    ? "Today"
    : date === yesterdayYmd
      ? "Yesterday"
      : date === sgYmd(addDays(now, 1))
        ? "Tomorrow"
        : sgLongLabel(date);

  const days: DaySection[] = [
    { ymd: date, label: headingLabel, subLabel: sgLongLabel(date), items: onDay },
  ];

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="tasks" />
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Tasks</h1>
          {canAddTasks && (
            <Link href="/tasks/new">
              <Button size="sm">+ New</Button>
            </Link>
          )}
        </div>
        {isOwnerOrMaid && (
          <div className="mt-2">
            <NotificationToggle />
          </div>
        )}
      </header>

      <TasksWeekStrip activeYmd={date} />

      <DaySections
        overdue={overdue}
        days={days}
        later={[]}
        readOnly={!isOwnerOrMaid}
      />
    </main>
  );
}
