"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

const TZ = "Asia/Singapore";

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Date navigation strip for /tasks and /tasks/[date].
 *
 * Shows 5 pills: Yesterday, Today, Tomorrow, +2, +3. Each pill links to
 * /tasks/<ymd> for the single-day view. The strip on the /tasks index page
 * highlights Today; the per-day page highlights the selected date.
 *
 * `activeYmd` is the currently-viewed date (YYYY-MM-DD in SG). Pass
 * `undefined` from the index (so the "active" highlight is just today).
 */
export function TasksWeekStrip({ activeYmd }: { activeYmd?: string }) {
  const today = sgYmd(new Date());
  // Anchor Date at SG midnight so day arithmetic stays in the same zone.
  const anchor = new Date(`${today}T00:00:00+08:00`);
  const days: { ymd: string; primary: string; secondary: string }[] = [];

  for (let offset = -1; offset <= 3; offset++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() + offset);
    const ymd = sgYmd(d);
    let primary: string;
    if (offset === -1) primary = "Yest";
    else if (offset === 0) primary = "Today";
    else if (offset === 1) primary = "Tom";
    else primary = new Intl.DateTimeFormat("en-SG", { timeZone: TZ, weekday: "short" }).format(d);
    const secondary = ymd.slice(8); // day-of-month
    days.push({ ymd, primary, secondary });
  }

  return (
    <nav aria-label="Days" className="flex gap-1 border-b border-border px-2 py-2">
      {days.map((d) => {
        const isActive = d.ymd === activeYmd;
        const isToday = d.ymd === today;
        return (
          <Link
            key={d.ymd}
            href={`/tasks/${d.ymd}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-1 py-2 text-center text-xs",
              isActive
                ? "bg-primary text-primary-foreground font-semibold"
                : isToday
                  ? "bg-muted font-medium"
                  : "hover:bg-muted/60",
            )}
          >
            {d.primary}
            <div className="text-[10px] opacity-80">{d.secondary}</div>
          </Link>
        );
      })}
    </nav>
  );
}
