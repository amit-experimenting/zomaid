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
 * Date navigation strip used by `/dashboard` (Home) and `/recipes` (Meal).
 *
 * Shows 5 pills: Yest, Today, Tom, +2, +3. Each pill links to
 * `<baseHref>?date=<ymd>` (the `date` param is omitted for today so the link
 * is the shortest form).
 *
 * `baseHref` defaults to `/dashboard` for backwards compatibility with the
 * single previous caller — pass `/recipes` to use the strip on the meal
 * landing page.
 */
export function DayStrip({
  activeYmd,
  baseHref = "/dashboard",
}: {
  activeYmd: string;
  baseHref?: string;
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
    const sp = new URLSearchParams();
    if (ymd !== today) sp.set("date", ymd);
    const qs = sp.toString();
    return `${baseHref}${qs ? `?${qs}` : ""}`;
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
            <div className="opacity-80" style={{ fontSize: 10 }}>{d.secondary}</div>
          </Link>
        );
      })}
    </nav>
  );
}
