"use client";
import { useState, useTransition } from "react";
import { setPeopleEating } from "@/app/plan/actions";

export function PeoplePill({
  planDate,
  slot,
  initialPeople,
  rosterSize,
  locked,
  canEdit,
}: {
  planDate: string;
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  initialPeople: number | null;
  rosterSize: number;
  locked: boolean;
  canEdit: boolean;
}) {
  const effective = initialPeople ?? rosterSize;
  const [people, setPeople] = useState(effective);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const disabled = locked || !canEdit;

  const submit = (next: number) => {
    setErr(null);
    start(async () => {
      const res = await setPeopleEating({ planDate, slot, people: next });
      if (!res.ok) setErr(res.error.code === "PLAN_LOCKED" ? "Locked" : res.error.message);
      else setEditing(false);
    });
  };

  if (!editing) {
    // Rendered as <span role="button"> instead of <button> because PeoplePill
    // is nested inside SlotRow's outer <button> sheet-trigger; <button>
    // inside <button> is invalid HTML and triggers a Next.js hydration
    // error. role + tabIndex + keyboard handler preserves accessibility.
    return (
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) setEditing(true); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={
          "rounded-full border px-2 py-0.5 text-[10px] uppercase " +
          (disabled ? "opacity-50 cursor-default" : "cursor-pointer")
        }
      >
        {effective} people
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        max={50}
        value={people}
        onChange={(e) => setPeople(Number(e.target.value))}
        className="w-12 rounded border px-1 py-0.5 text-[11px]"
      />
      <button onClick={() => submit(people)} disabled={pending} className="text-[11px] text-emerald-700">save</button>
      <button onClick={() => { setEditing(false); setErr(null); }} className="text-[11px] text-muted-foreground">×</button>
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </span>
  );
}
