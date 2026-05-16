import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/site/main-nav";
import { NotificationToggle } from "@/components/tasks/notification-toggle";
import { DaySections, type DaySection } from "@/components/tasks/_day-sections";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";

// Match the SG-centric assumption baked into /plan and the rest of the app.
// See docs/specs/2026-05-16-tasks-day-grouping-design.md for the rationale.
const TZ = "Asia/Singapore";
const HORIZON_DAYS = 14;
// Day window shown explicitly: Yesterday, Today, Tomorrow, +2.
const NAMED_FORWARD_DAYS = 3; // Today + next 2

/** Format a Date as YYYY-MM-DD in the household timezone (en-CA gives ISO). */
function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Add `days` to a Date and return a new instance. */
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Short human label for a date: "Wed 21 May". */
function sgShortLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

export default async function TasksIndex() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const isOwnerOrMaid = ctx.membership.role === "owner" || ctx.membership.role === "maid";
  // Any active member can add tasks; mark/done remains owner/maid only.
  const canAddTasks = isOwnerOrMaid || ctx.membership.role === "family_member";

  const now = new Date();
  const nowMs = now.getTime();
  const yesterdayYmd = sgYmd(addDays(now, -1));

  // 14-day horizon: enough to power Today + 4 named days + Later. Idempotent
  // RPC; cheap when nothing is missing.
  const horizonDate = addDays(now, HORIZON_DAYS);
  await supabase.rpc("tasks_generate_occurrences", {
    p_horizon_date: sgYmd(horizonDate),
  });

  // Right edge is the start of (today + HORIZON_DAYS) in SG, expressed as a
  // wall-clock instant. Simpler approximation: cap at now + HORIZON_DAYS * 24h.
  // Off-by-a-few-hours at the boundary is fine since we re-bucket by sgYmd.
  const rightEdge = new Date(nowMs + HORIZON_DAYS * 86_400_000);

  const { data: occRows } = await supabase
    .from("task_occurrences")
    .select(
      "id, due_at, status, household_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))"
    )
    .eq("household_id", ctx.household.id)
    .lt("due_at", rightEdge.toISOString())
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
  // Supabase's generated types don't pick up the task_occurrences→tasks
  // relation, so we cast via unknown — same pattern the original handler used.
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

  // Named day buckets keyed by YYYY-MM-DD in SG.
  // Order: Yesterday, Today, Tomorrow, +2.
  const namedYmds: string[] = [yesterdayYmd];
  const dayLabels: { ymd: string; label: string; subLabel?: string }[] = [
    { ymd: yesterdayYmd, label: "Yesterday", subLabel: sgShortLabel(addDays(now, -1)) },
  ];
  for (let i = 0; i < NAMED_FORWARD_DAYS; i++) {
    const d = addDays(now, i);
    const ymd = sgYmd(d);
    namedYmds.push(ymd);
    const short = sgShortLabel(d);
    if (i === 0) dayLabels.push({ ymd, label: "Today", subLabel: short });
    else if (i === 1) dayLabels.push({ ymd, label: "Tomorrow", subLabel: short });
    else dayLabels.push({ ymd, label: short });
  }

  const overdue: OccurrenceRowItem[] = [];
  const byDay = new Map<string, OccurrenceRowItem[]>();
  const later: OccurrenceRowItem[] = [];

  for (const r of all) {
    const item = toItem(r);
    const ymd = sgYmd(new Date(item.dueAt));
    const isPending = item.status === "pending";

    // Pending occurrences from 2+ days ago surface in Overdue.
    // Yesterday's pending items render inside the Yesterday section (still
    // marked overdue on the row) so the maid can act on them in-context.
    if (isPending && ymd < yesterdayYmd) {
      overdue.push(item);
      continue;
    }

    // Drop completed/skipped occurrences older than yesterday — keeps the
    // page from turning into an audit log while preserving yesterday's
    // history for the maid to reference.
    if (ymd < yesterdayYmd) continue;

    if (namedYmds.includes(ymd)) {
      const bucket = byDay.get(ymd) ?? [];
      bucket.push(item);
      byDay.set(ymd, bucket);
    } else {
      later.push(item);
    }
  }

  // Within each bucket: due_at asc, then title asc as a stable tiebreaker.
  const sortItems = (xs: OccurrenceRowItem[]) =>
    xs.sort((a, b) => {
      const da = new Date(a.dueAt).getTime();
      const db = new Date(b.dueAt).getTime();
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title);
    });
  sortItems(overdue);
  for (const v of byDay.values()) sortItems(v);
  sortItems(later);

  const days: DaySection[] = dayLabels.map((d) => ({
    ymd: d.ymd,
    label: d.label,
    subLabel: d.subLabel,
    items: byDay.get(d.ymd) ?? [],
  }));

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

      <DaySections
        overdue={overdue}
        days={days}
        later={later}
        readOnly={!isOwnerOrMaid}
      />
    </main>
  );
}
