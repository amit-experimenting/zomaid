"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveTaskSetupPicks } from "./actions";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Standard = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string;
};

function summarise(s: Standard): string {
  const time = s.due_time.slice(0, 5);
  if (s.recurrence_frequency === "daily") {
    if (s.recurrence_interval === 1) return `Daily · ${time}`;
    return `Every ${s.recurrence_interval} days · ${time}`;
  }
  if (s.recurrence_frequency === "weekly") {
    const days = (s.recurrence_byweekday ?? [])
      .map((d) => WEEKDAY_SHORT[d])
      .join(", ");
    const prefix = s.recurrence_interval === 1 ? "Weekly" : `Every ${s.recurrence_interval} weeks`;
    return `${prefix} · ${days} ${time}`;
  }
  const prefix = s.recurrence_interval === 1 ? "Monthly" : `Every ${s.recurrence_interval} months`;
  return `${prefix} · day ${s.recurrence_bymonthday} ${time}`;
}

export function PickForm({
  standards,
  initialPicks,
}: {
  standards: Standard[];
  initialPicks: string[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initialPicks));
  const [pending, start] = useTransition();
  const allSelected = standards.length > 0 && picked.size === standards.length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (allSelected) setPicked(new Set());
    else setPicked(new Set(standards.map((s) => s.id)));
  };

  const onNext = () => {
    if (picked.size === 0) return;
    start(async () => {
      await saveTaskSetupPicks({ standardTaskIds: Array.from(picked) });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="h-4 w-4"
        />
        <span className="font-medium">Select all</span>
      </label>
      <ul className="divide-y rounded-md border">
        {standards.map((s) => (
          <li key={s.id} className="px-3 py-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-muted-foreground">{summarise(s)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted-foreground">{picked.size} selected</span>
        <Button onClick={onNext} disabled={pending || picked.size === 0}>
          Next →
        </Button>
      </div>
    </div>
  );
}
