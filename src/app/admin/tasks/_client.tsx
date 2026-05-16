"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecurrencePicker, type RecurrenceValue } from "@/components/tasks/recurrence-picker";
import { archiveStandardTask, createStandardTask } from "./actions";

type StandardTask = {
  id: string;
  title: string;
  notes: string | null;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  recurrence_starts_on: string;
  recurrence_ends_on: string | null;
  due_time: string;
  archived_at: string | null;
};

const defaultRecurrence: RecurrenceValue = {
  mode: "weekly",
  interval: 1,
  byweekday: [0],
  bymonthday: null,
  startsOn: new Date().toISOString().slice(0, 10),
  endsOn: null,
  dueTime: "09:00:00",
};

function describeRecurrence(t: StandardTask): string {
  if (t.recurrence_frequency === "daily") {
    return t.recurrence_interval === 1 ? "every day" : `every ${t.recurrence_interval} days`;
  }
  if (t.recurrence_frequency === "weekly") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const list = (t.recurrence_byweekday ?? []).map((d) => days[d]).join("/");
    const prefix = t.recurrence_interval === 1 ? "weekly" : `every ${t.recurrence_interval} weeks`;
    return `${prefix} (${list})`;
  }
  const prefix = t.recurrence_interval === 1 ? "monthly" : `every ${t.recurrence_interval} months`;
  return `${prefix} on day ${t.recurrence_bymonthday}`;
}

export function AdminTasksClient({ tasks }: { tasks: StandardTask[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(defaultRecurrence);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      // "one_off" is a UI-only mode that the household task form maps to a
      // daily/interval=1 schedule pinned to a single date. Apply the same
      // mapping here so admins can author a single-day standard task.
      const frequency: "daily" | "weekly" | "monthly" =
        recurrence.mode === "one_off" ? "daily" : recurrence.mode;
      const isOneOff = recurrence.mode === "one_off";
      const res = await createStandardTask({
        title: title.trim(),
        notes: notes.trim() || null,
        recurrence: {
          frequency,
          interval: isOneOff ? 1 : recurrence.interval,
          byweekday: frequency === "weekly" ? recurrence.byweekday : undefined,
          bymonthday: frequency === "monthly" ? (recurrence.bymonthday ?? undefined) : undefined,
          startsOn: recurrence.startsOn,
          endsOn: isOneOff ? recurrence.startsOn : recurrence.endsOn,
        },
        dueTime: recurrence.dueTime,
      });
      if (!res.ok) { setError(res.error.message); return; }
      setTitle("");
      setNotes("");
      setRecurrence(defaultRecurrence);
      setShowForm(false);
      router.refresh();
    });
  }

  function archive(taskId: string) {
    start(async () => {
      const res = await archiveStandardTask({ taskId });
      if (!res.ok) { setError(res.error.message); return; }
      router.refresh();
    });
  }

  const active = tasks.filter((t) => t.archived_at === null);
  const archived = tasks.filter((t) => t.archived_at !== null);

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-muted-foreground">{active.length} active · {archived.length} archived</span>
        <Button type="button" size="sm" onClick={() => setShowForm((s) => !s)} disabled={pending}>
          {showForm ? "Cancel" : "+ New standard task"}
        </Button>
      </div>

      {showForm && (
        <form className="space-y-4 px-4 py-4 border-y border-border bg-muted/30" onSubmit={submit}>
          <div>
            <Label htmlFor="at-title">Title</Label>
            <Input id="at-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
          </div>
          <div>
            <Label htmlFor="at-notes">Notes (optional)</Label>
            <Textarea id="at-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
          <RecurrencePicker value={recurrence} onChange={setRecurrence} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending || !title.trim()}>Create standard task</Button>
        </form>
      )}

      <section>
        <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Active</h2>
        {active.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">No active standard tasks.</p>
        ) : (
          active.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-muted-foreground">{describeRecurrence(t)} · {t.due_time.slice(0, 5)}</div>
                {t.notes && <div className="mt-1 text-xs text-muted-foreground">{t.notes}</div>}
              </div>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => archive(t.id)}>
                Archive
              </Button>
            </div>
          ))
        )}
      </section>

      {archived.length > 0 && (
        <section>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Archived</h2>
          {archived.map((t) => (
            <div key={t.id} className="border-b border-border px-4 py-3 text-muted-foreground line-through">
              <div>{t.title}</div>
              <div className="text-xs">{describeRecurrence(t)}</div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
