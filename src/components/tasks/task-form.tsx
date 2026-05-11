"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecurrencePicker, type RecurrenceValue } from "./recurrence-picker";
import { createTask, updateTask } from "@/app/tasks/actions";

export type TaskFormProps = {
  mode: "create" | "edit";
  taskId?: string;
  members: { id: string; display_name: string }[];
  initial?: {
    title: string;
    notes: string | null;
    assignedToProfileId: string | null;
    recurrence: RecurrenceValue;
  };
};

const defaultRecurrence: RecurrenceValue = {
  frequency: "weekly",
  interval: 1,
  byweekday: [0],
  bymonthday: null,
  startsOn: new Date().toISOString().slice(0, 10),
  endsOn: null,
  dueTime: "09:00:00",
};

export function TaskForm({ mode, taskId, members, initial }: TaskFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [assignee, setAssignee] = useState<string>(initial?.assignedToProfileId ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(initial?.recurrence ?? defaultRecurrence);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const payload = {
        title: title.trim(),
        notes: notes.trim() || null,
        assignedToProfileId: assignee || null,
        recurrence: {
          frequency: recurrence.frequency,
          interval: recurrence.interval,
          byweekday: recurrence.frequency === "weekly" ? recurrence.byweekday : undefined,
          bymonthday: recurrence.frequency === "monthly" ? (recurrence.bymonthday ?? undefined) : undefined,
          startsOn: recurrence.startsOn,
          endsOn: recurrence.endsOn,
        },
        dueTime: recurrence.dueTime,
      };
      const res = mode === "create"
        ? await createTask(payload)
        : await updateTask({ taskId: taskId!, ...payload });
      if (!res.ok) { setError(res.error.message); return; }
      router.push("/tasks");
    });
  }

  return (
    <form className="mx-auto max-w-md space-y-4 p-4" onSubmit={submit}>
      <div>
        <Label htmlFor="t-title">Title</Label>
        <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      </div>
      <div>
        <Label htmlFor="t-notes">Notes (optional)</Label>
        <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </div>
      <div>
        <Label htmlFor="t-assignee">Assignee</Label>
        <select
          id="t-assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Anyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </div>
      <RecurrencePicker value={recurrence} onChange={setRecurrence} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !title.trim()}>
        {mode === "create" ? "Create task" : "Save changes"}
      </Button>
    </form>
  );
}
