"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export function WeekStrip({ activeDate }: { activeDate: string }) {
  const today = isoDate(new Date());
  const days: { date: string; label: string }[] = [];
  // Today + the next 3 days. Past dates are not reachable from the strip.
  const todayDate = new Date(`${today}T00:00:00+08:00`);
  for (let i = 0; i <= 3; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + i);
    const iso = isoDate(d);
    days.push({ date: iso, label: d.toLocaleDateString("en-SG", { weekday: "narrow" }) });
  }
  return (
    <nav aria-label="Week" className="flex gap-1 border-t border-border px-2 py-2">
      {days.map((d) => (
        <Link
          key={d.date}
          href={`/plan/${d.date}`}
          className={cn(
            "flex-1 rounded-md px-1 py-2 text-center text-xs",
            d.date === activeDate ? "bg-primary text-primary-foreground font-semibold"
              : d.date === today ? "bg-muted font-medium"
              : "hover:bg-muted/60",
          )}
        >
          {d.label}
          <div className="text-[10px] opacity-80">{d.date.slice(8)}</div>
        </Link>
      ))}
    </nav>
  );
}
