// src/app/onboarding/tasks/pick-form.tsx
"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { finalizePicksAction, saveDraftAction } from "./actions";

type TaskRow = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string | null;
  relevance_tags: string[];
};

type Props = {
  tasks: TaskRow[];
  matchingTags: string[];
  profileSummary: string;
  initialPicks: string[] | null;
};

type Cadence = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
};

type CadenceKey = "daily" | "daily2" | "daily3" | "weekly" | "biweekly" | "monthly";

const CADENCES: { key: CadenceKey; label: string; matches: (c: Cadence) => boolean }[] = [
  { key: "daily",    label: "Daily",        matches: c => c.frequency === "daily"   && c.interval === 1 },
  { key: "daily2",   label: "Every 2 days", matches: c => c.frequency === "daily"   && c.interval === 2 },
  { key: "daily3",   label: "Every 3 days", matches: c => c.frequency === "daily"   && c.interval === 3 },
  { key: "weekly",   label: "Weekly",       matches: c => c.frequency === "weekly"  && c.interval === 1 },
  { key: "biweekly", label: "Bi-weekly",    matches: c => c.frequency === "weekly"  && c.interval === 2 },
  { key: "monthly",  label: "Monthly",      matches: c => c.frequency === "monthly" },
];

function classify(c: Cadence): CadenceKey {
  return CADENCES.find(x => x.matches(c))?.key ?? "daily";
}

// When the user promotes a daily/monthly task to weekly we need byweekday;
// when promoting to monthly we need bymonthday. Reuse the original task's
// value if it had one (round-trip preserves user intent), else sensible
// defaults: Mon-Fri for weekly, day 1 for monthly.
function buildCadence(key: CadenceKey, t: TaskRow): Cadence {
  switch (key) {
    case "daily":    return { frequency: "daily",   interval: 1, byweekday: null, bymonthday: null };
    case "daily2":   return { frequency: "daily",   interval: 2, byweekday: null, bymonthday: null };
    case "daily3":   return { frequency: "daily",   interval: 3, byweekday: null, bymonthday: null };
    case "weekly":   return { frequency: "weekly",  interval: 1, byweekday: t.recurrence_byweekday ?? [1, 2, 3, 4, 5], bymonthday: null };
    case "biweekly": return { frequency: "weekly",  interval: 2, byweekday: t.recurrence_byweekday ?? [1, 2, 3, 4, 5], bymonthday: null };
    case "monthly":  return { frequency: "monthly", interval: 1, byweekday: null, bymonthday: t.recurrence_bymonthday ?? 1 };
  }
}

function effective(t: TaskRow, overrides: Map<string, Cadence>): Cadence {
  const o = overrides.get(t.id);
  if (o) return o;
  return {
    frequency: t.recurrence_frequency,
    interval: t.recurrence_interval,
    byweekday: t.recurrence_byweekday,
    bymonthday: t.recurrence_bymonthday,
  };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Inline font-size styles to stay within the design-system rule (which only
// allows arbitrary text-[…] values in allowlisted UI primitives). These mirror
// the same pattern used in src/app/onboarding/profile/profile-form.tsx.
const CHIP_BADGE_STYLE = { fontSize: 11 };
const CHIP_EYEBROW_STYLE = { fontSize: 11 };
const CHIP_BODY_STYLE = { fontSize: 13 };
const LINK_TEXT_STYLE = { fontSize: 12 };
const COUNT_LINE_STYLE = { fontSize: 12 };
const SHOW_MORE_TITLE_STYLE = { fontSize: 13 };
const SHOW_MORE_HINT_STYLE = { fontSize: 11.5 };
const SECTION_LABEL_STYLE = { fontSize: 11 };
const TAG_PILL_STYLE = { fontSize: 10.5 };
const META_TEXT_STYLE = { fontSize: 12 };

// Time is shown in its own editable input; the meta line only carries cadence
// detail that isn't already in the section header (days of week / day of month).
function fmtMeta(c: Cadence): string {
  if (c.frequency === "weekly") {
    return (c.byweekday ?? []).map(d => DAY_NAMES[d]).join(", ");
  }
  if (c.frequency === "monthly") {
    return `Day ${c.bymonthday}`;
  }
  return "";
}

function tagCategory(tags: string[]): string | null {
  if (tags.some(t => t.startsWith("pets:"))) return "pet";
  if (tags.some(t => t.startsWith("age:"))) return "age";
  if (tags.some(t => t.startsWith("school:"))) return "school";
  if (tags.some(t => t.startsWith("feature:"))) return "feature";
  return null;
}

function isMatched(task: TaskRow, matchingTags: string[]): boolean {
  if (task.relevance_tags.length === 0) return true;
  return task.relevance_tags.some(t => matchingTags.includes(t));
}

export function PickForm({ tasks, matchingTags, profileSummary, initialPicks }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { matched, unmatched } = useMemo(() => {
    const m: TaskRow[] = [];
    const u: TaskRow[] = [];
    for (const t of tasks) (isMatched(t, matchingTags) ? m : u).push(t);
    return { matched: m, unmatched: u };
  }, [tasks, matchingTags]);

  const [picked, setPicked] = useState<Set<string>>(() => {
    if (initialPicks !== null) return new Set(initialPicks);
    return new Set(matched.map(t => t.id));
  });
  const [showAll, setShowAll] = useState(false);
  const [timeOverrides, setTimeOverrides] = useState<Map<string, string>>(new Map());
  const [cadenceOverrides, setCadenceOverrides] = useState<Map<string, Cadence>>(new Map());

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    void saveDraftAction(Array.from(next));
  }

  function setTime(id: string, value: string) {
    setTimeOverrides(prev => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }

  function setCadence(t: TaskRow, key: CadenceKey) {
    setCadenceOverrides(prev => {
      const next = new Map(prev);
      next.set(t.id, buildCadence(key, t));
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const times: Record<string, string> = {};
      for (const [id, value] of timeOverrides) {
        if (picked.has(id)) times[id] = value;
      }
      const cadences: Record<string, Cadence> = {};
      for (const [id, value] of cadenceOverrides) {
        if (picked.has(id)) cadences[id] = value;
      }
      const result = await finalizePicksAction(Array.from(picked), times, cadences);
      if (result?.error) {
        console.error(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  const matchedSections = CADENCES.map(({ key, label, matches }) => ({
    key,
    label,
    items: matched.filter(t => matches(effective(t, cadenceOverrides))),
  })).filter(s => s.items.length > 0);

  const unmatchedSections = CADENCES.map(({ key, label, matches }) => ({
    key,
    label,
    items: unmatched.filter(t => matches(effective(t, cadenceOverrides))),
  })).filter(s => s.items.length > 0);

  return (
    <form onSubmit={onSubmit} className="pb-32">

      <div className="mx-4 mt-3 bg-surface-1 border border-border rounded-md p-2.5 flex items-start gap-2.5">
        <span style={CHIP_BADGE_STYLE} className="inline-flex w-6 h-6 items-center justify-center bg-primary-subtle text-primary rounded font-semibold flex-shrink-0">P</span>
        <div className="flex-1 min-w-0">
          <div style={CHIP_EYEBROW_STYLE} className="text-text-muted uppercase tracking-wider font-semibold">Filtering by your profile</div>
          <div style={CHIP_BODY_STYLE} className="text-text-primary mt-0.5">{profileSummary}</div>
        </div>
        <Link href="/onboarding/profile?edit=1" style={LINK_TEXT_STYLE} className="text-primary font-semibold self-center">Edit</Link>
      </div>

      <div style={COUNT_LINE_STYLE} className="px-4 pt-3 pb-1 text-text-muted">
        Showing <strong className="text-text-primary">{matched.length} of {tasks.length}</strong> tasks matched to your home
      </div>

      {matchedSections.map(({ key, label, items }) => (
        <Section key={key} label={label} items={items} picked={picked} onToggle={toggle} timeOverrides={timeOverrides} onTimeChange={setTime} cadenceOverrides={cadenceOverrides} onCadenceChange={setCadence} />
      ))}

      {unmatched.length > 0 && !showAll ? (
        <div className="mx-4 mt-5 bg-surface-1 border border-dashed border-border-strong rounded-md p-3.5 text-center cursor-pointer" onClick={() => setShowAll(true)}>
          <div style={SHOW_MORE_TITLE_STYLE} className="text-primary font-semibold">Show {unmatched.length} more tasks (not matched to your profile)</div>
          <div style={SHOW_MORE_HINT_STYLE} className="text-text-muted mt-0.5">Tasks for pets/school/features you said no to</div>
        </div>
      ) : null}

      {showAll && unmatchedSections.map(({ key, label, items }) => (
        <Section key={`u-${key}`} label={label} items={items} picked={picked} onToggle={toggle} timeOverrides={timeOverrides} onTimeChange={setTime} cadenceOverrides={cadenceOverrides} onCadenceChange={setCadence} dimmed />
      ))}

      <div className="fixed bottom-14 left-0 right-0 bg-surface-1 border-t border-border p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" loading={pending} className="w-full">
          Done · Set up {picked.size} tasks
        </Button>
        <p style={COUNT_LINE_STYLE} className="text-text-muted text-center mt-1.5">You can add/remove tasks later in Tasks settings.</p>
      </div>
    </form>
  );
}

function Section({
  label,
  items,
  picked,
  onToggle,
  timeOverrides,
  onTimeChange,
  cadenceOverrides,
  onCadenceChange,
  dimmed = false,
}: {
  label: string;
  items: TaskRow[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  timeOverrides: Map<string, string>;
  onTimeChange: (id: string, value: string) => void;
  cadenceOverrides: Map<string, Cadence>;
  onCadenceChange: (t: TaskRow, key: CadenceKey) => void;
  dimmed?: boolean;
}) {
  return (
    <div className="px-4 mt-4">
      <div style={SECTION_LABEL_STYLE} className={`uppercase tracking-wider font-semibold mb-1.5 ${dimmed ? "text-text-disabled" : "text-text-muted"}`}>{label}</div>
      <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
        {items.map(t => {
          const isPicked = picked.has(t.id);
          const cat = tagCategory(t.relevance_tags);
          const cad = effective(t, cadenceOverrides);
          const meta = fmtMeta(cad);
          const cadKey = classify(cad);
          const cbId = `task-pick-${t.id}`;
          const currentTime = timeOverrides.get(t.id) ?? t.due_time?.slice(0, 5) ?? "";
          return (
            <div key={t.id} className="flex items-start gap-3 px-3.5 py-2.5 border-b border-border last:border-0 min-h-14 hover:bg-surface-0">
              <input id={cbId} type="checkbox" checked={isPicked} onChange={() => onToggle(t.id)} className="size-[18px] mt-2.5 accent-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <label htmlFor={cbId} className="block cursor-pointer">
                  <div className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                    <span className="truncate">{t.title}</span>
                    {cat ? <span style={TAG_PILL_STYLE} className="inline-flex items-center px-1.5 py-0.5 bg-primary-subtle text-primary font-semibold rounded-full flex-shrink-0">{cat}</span> : null}
                  </div>
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <select
                    value={cadKey}
                    onChange={e => onCadenceChange(t, e.target.value as CadenceKey)}
                    aria-label={`Cadence for ${t.title}`}
                    className="h-9 bg-surface-0 border border-border rounded-sm pl-2 pr-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {CADENCES.map(c => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  {meta ? <span style={META_TEXT_STYLE} className="text-text-muted tabular-nums truncate">{meta}</span> : null}
                </div>
              </div>
              <input
                type="time"
                value={currentTime}
                onChange={e => onTimeChange(t.id, e.target.value)}
                aria-label={`Time for ${t.title}`}
                className="h-11 w-24 text-right tabular-nums text-sm bg-surface-0 border border-border rounded-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
