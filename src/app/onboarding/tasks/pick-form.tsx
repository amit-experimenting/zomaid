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

const FREQ_LABEL_ORDER: { label: string; predicate: (t: TaskRow) => boolean }[] = [
  { label: "Daily", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 1 },
  { label: "Every 2 days", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 2 },
  { label: "Every 3 days", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 3 },
  { label: "Weekly", predicate: t => t.recurrence_frequency === "weekly" && t.recurrence_interval === 1 },
  { label: "Bi-weekly", predicate: t => t.recurrence_frequency === "weekly" && t.recurrence_interval === 2 },
  { label: "Monthly", predicate: t => t.recurrence_frequency === "monthly" },
];

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

function fmtMeta(t: TaskRow): string {
  const time = t.due_time?.slice(0, 5) ?? "";
  if (t.recurrence_frequency === "weekly") {
    const days = (t.recurrence_byweekday ?? []).map(d => DAY_NAMES[d]).join(", ");
    return `${days} ${time}`.trim();
  }
  if (t.recurrence_frequency === "monthly") {
    return `Day ${t.recurrence_bymonthday} ${time}`.trim();
  }
  if (t.recurrence_interval === 1) return `${time} daily`;
  return `${time} every ${t.recurrence_interval} days`;
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

  function toggle(id: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      void saveDraftAction(Array.from(next));
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await finalizePicksAction(Array.from(picked));
      if (result?.error) {
        console.error(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  const matchedSections = FREQ_LABEL_ORDER.map(({ label, predicate }) => ({
    label,
    items: matched.filter(predicate),
  })).filter(s => s.items.length > 0);

  const unmatchedSections = FREQ_LABEL_ORDER.map(({ label, predicate }) => ({
    label,
    items: unmatched.filter(predicate),
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

      {matchedSections.map(({ label, items }) => (
        <Section key={label} label={label} items={items} picked={picked} onToggle={toggle} />
      ))}

      {unmatched.length > 0 && !showAll ? (
        <div className="mx-4 mt-5 bg-surface-1 border border-dashed border-border-strong rounded-md p-3.5 text-center cursor-pointer" onClick={() => setShowAll(true)}>
          <div style={SHOW_MORE_TITLE_STYLE} className="text-primary font-semibold">Show {unmatched.length} more tasks (not matched to your profile)</div>
          <div style={SHOW_MORE_HINT_STYLE} className="text-text-muted mt-0.5">Tasks for pets/school/features you said no to</div>
        </div>
      ) : null}

      {showAll && unmatchedSections.map(({ label, items }) => (
        <Section key={`u-${label}`} label={label} items={items} picked={picked} onToggle={toggle} dimmed />
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
  dimmed = false,
}: {
  label: string;
  items: TaskRow[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  dimmed?: boolean;
}) {
  return (
    <div className="px-4 mt-4">
      <div style={SECTION_LABEL_STYLE} className={`uppercase tracking-wider font-semibold mb-1.5 ${dimmed ? "text-text-disabled" : "text-text-muted"}`}>{label}</div>
      <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
        {items.map(t => {
          const isPicked = picked.has(t.id);
          const cat = tagCategory(t.relevance_tags);
          return (
            <label key={t.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border last:border-0 min-h-14 cursor-pointer hover:bg-surface-0">
              <input type="checkbox" checked={isPicked} onChange={() => onToggle(t.id)} className="size-[18px] accent-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                  <span className="truncate">{t.title}</span>
                  {cat ? <span style={TAG_PILL_STYLE} className="inline-flex items-center px-1.5 py-0.5 bg-primary-subtle text-primary font-semibold rounded-full flex-shrink-0">{cat}</span> : null}
                </div>
                <div style={META_TEXT_STYLE} className="text-text-muted tabular-nums">{fmtMeta(t)}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
