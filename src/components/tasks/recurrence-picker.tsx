"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * `mode` is UI-only. "one_off" maps to a single-date task; on submit the
 * task-form translates it to frequency="daily", interval=1, starts_on=endsOn=date
 * so the existing recurrence generator emits exactly one occurrence.
 */
export type RecurrenceValue = {
  mode: "one_off" | "daily" | "weekly" | "monthly";
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  /** For one_off: the single date the task is due on. For recurring: start of recurrence. */
  startsOn: string;
  endsOn: string | null;
  dueTime: string;
};

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecurrencePicker({
  value, onChange,
}: { value: RecurrenceValue; onChange: (next: RecurrenceValue) => void }) {
  function setMode(m: RecurrenceValue["mode"]) {
    onChange({
      ...value,
      mode: m,
      byweekday: m === "weekly" ? (value.byweekday.length > 0 ? value.byweekday : [1]) : [],
      bymonthday: m === "monthly" ? (value.bymonthday ?? 1) : null,
    });
  }
  function toggleDay(d: number) {
    const set = new Set(value.byweekday);
    if (set.has(d)) set.delete(d); else set.add(d);
    onChange({ ...value, byweekday: Array.from(set).sort() });
  }
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="text-sm font-medium">Schedule</legend>

      <div className="grid grid-cols-4 gap-1">
        {([
          { id: "one_off", label: "One-off" },
          { id: "daily", label: "Daily" },
          { id: "weekly", label: "Weekly" },
          { id: "monthly", label: "Monthly" },
        ] as const).map((m) => (
          <Button
            key={m.id}
            type="button"
            variant={value.mode === m.id ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {value.mode === "one_off" ? (
        <div>
          <Label htmlFor="rp-date" className="text-xs">Date</Label>
          <Input
            id="rp-date"
            type="date"
            value={value.startsOn}
            onChange={(e) => onChange({ ...value, startsOn: e.target.value, endsOn: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm">every</span>
            <Input
              type="number"
              min={1}
              max={365}
              value={value.interval}
              onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
              className="w-20"
            />
            <span className="text-sm">
              {value.mode === "daily" ? "day(s)" : value.mode === "weekly" ? "week(s)" : "month(s)"}
            </span>
          </div>

          {value.mode === "weekly" && (
            <div>
              <Label className="text-xs">On these days</Label>
              <div className="mt-1 flex gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    aria-label={DAY_LABELS[i]}
                    aria-pressed={value.byweekday.includes(i)}
                    className={cn(
                      "h-8 w-8 rounded-full text-xs font-medium",
                      value.byweekday.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {value.mode === "monthly" && (
            <div>
              <Label htmlFor="rp-bmd" className="text-xs">Day of month</Label>
              <Input
                id="rp-bmd"
                type="number"
                min={1}
                max={31}
                value={value.bymonthday ?? 1}
                onChange={(e) => onChange({ ...value, bymonthday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                className="w-24"
              />
            </div>
          )}

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div>
              <Label htmlFor="rp-starts" className="text-xs">Starts on</Label>
              <Input
                id="rp-starts"
                type="date"
                value={value.startsOn}
                onChange={(e) => onChange({ ...value, startsOn: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="rp-ends" className="text-xs">Ends on (optional)</Label>
              <Input
                id="rp-ends"
                type="date"
                value={value.endsOn ?? ""}
                onChange={(e) => onChange({ ...value, endsOn: e.target.value || null })}
              />
            </div>
          </div>
        </>
      )}

      <div>
        <Label htmlFor="rp-time" className="text-xs">Due time of day</Label>
        <Input
          id="rp-time"
          type="time"
          value={value.dueTime.slice(0, 5)}
          onChange={(e) => onChange({ ...value, dueTime: `${e.target.value}:00` })}
        />
      </div>
    </fieldset>
  );
}
