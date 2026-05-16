"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitTaskSetup } from "../actions";

export type StandardForTune = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string;
  assigned_to_profile_id: string | null;
};

export type AssigneeOption = { value: string; label: string };

type Entry = {
  standardTaskId: string;
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  byweekday: number[];
  bymonthday: number;
  dueTime: string;
  assigneeProfileId: string;
};

const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 0, short: "S", long: "Sunday" },
  { value: 1, short: "M", long: "Monday" },
  { value: 2, short: "T", long: "Tuesday" },
  { value: 3, short: "W", long: "Wednesday" },
  { value: 4, short: "T", long: "Thursday" },
  { value: 5, short: "F", long: "Friday" },
  { value: 6, short: "S", long: "Saturday" },
];

function initialEntry(s: StandardForTune): Entry {
  return {
    standardTaskId: s.id,
    frequency: s.recurrence_frequency,
    interval: s.recurrence_interval,
    byweekday: s.recurrence_byweekday ?? [],
    bymonthday: s.recurrence_bymonthday ?? 1,
    dueTime: s.due_time.slice(0, 5),
    assigneeProfileId: "anyone",
  };
}

export function TuneForm({
  standards,
  assignees,
}: {
  standards: StandardForTune[];
  assignees: AssigneeOption[];
}) {
  const [entries, setEntries] = useState<Entry[]>(() => standards.map(initialEntry));
  const [pending, start] = useTransition();

  const update = (idx: number, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const onFinish = () => {
    start(async () => {
      await submitTaskSetup({
        entries: entries.map((e) => ({
          standardTaskId: e.standardTaskId,
          frequency: e.frequency,
          interval: e.interval,
          byweekday: e.frequency === "weekly" ? e.byweekday : undefined,
          bymonthday: e.frequency === "monthly" ? e.bymonthday : undefined,
          dueTime: e.dueTime,
          assigneeProfileId: e.assigneeProfileId,
        })),
      });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {standards.map((s, idx) => {
        const e = entries[idx];
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="text-sm font-medium">{s.title}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Frequency</span>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.frequency}
                  onChange={(ev) => update(idx, { frequency: ev.target.value as Entry["frequency"] })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.interval}
                  onChange={(ev) => update(idx, { interval: Math.max(1, Number(ev.target.value) || 1) })}
                />
              </label>
            </div>
            {e.frequency === "weekly" && (
              <div className="mt-3 flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Days</span>
                <div className="flex gap-1">
                  {WEEKDAYS.map((d) => {
                    const on = e.byweekday.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-label={d.long}
                        aria-pressed={on}
                        className={
                          "h-8 w-8 rounded-md border text-xs " +
                          (on ? "bg-foreground text-background" : "bg-background")
                        }
                        onClick={() => {
                          const next = on
                            ? e.byweekday.filter((v) => v !== d.value)
                            : [...e.byweekday, d.value].sort();
                          update(idx, { byweekday: next });
                        }}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {e.frequency === "monthly" && (
              <label className="mt-3 flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.bymonthday}
                  onChange={(ev) => update(idx, { bymonthday: Math.min(31, Math.max(1, Number(ev.target.value) || 1)) })}
                />
              </label>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Time</span>
                <input
                  type="time"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.dueTime}
                  onChange={(ev) => update(idx, { dueTime: ev.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Who</span>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.assigneeProfileId}
                  onChange={(ev) => update(idx, { assigneeProfileId: ev.target.value })}
                >
                  {assignees.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end pt-2">
        <Button onClick={onFinish} disabled={pending}>
          Finish →
        </Button>
      </div>
    </div>
  );
}
