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
 * Date navigation strip used by the unified `/dashboard` Day view.
 *
 * Shows 5 pills: Yest, Today, Tom, +2, +3. Each pill links to
 * `/dashboard?date=<ymd>` and preserves the active `view` (Tasks vs Meal).
 * Replaces the older `WeekStrip` (next-4) and `TasksWeekStrip` (yest..+3) —
 * the yest..+3 window is the more useful triage range.
 */
export function DayStrip({
  activeYmd,
  view,
}: {
  activeYmd: string;
  view: "tasks" | "meal";
}) {
  const today = sgYmd(new Date());
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

  function hrefFor(ymd: string): string {
    // Encode params in a stable order: view first (when meal), then date.
    // Tasks is the default view → omit it from the URL to keep links shorter
    // and match the contract documented in the design doc.
    const sp = new URLSearchParams();
    if (view === "meal") sp.set("view", "meal");
    if (ymd !== today) sp.set("date", ymd);
    const qs = sp.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  }

  return (
    <nav aria-label="Days" className="flex gap-1 border-b border-border px-2 py-2">
      {days.map((d) => {
        const isActive = d.ymd === activeYmd;
        const isToday = d.ymd === today;
        return (
          <Link
            key={d.ymd}
            href={hrefFor(d.ymd)}
            aria-current={isActive ? "page" : undefined}
            scroll={false}
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
