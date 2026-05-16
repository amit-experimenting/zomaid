"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DayStrip } from "@/components/site/day-strip";
import { OccurrenceRow, type OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { OccurrenceActionSheet } from "@/components/tasks/occurrence-action-sheet";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";

const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
};

/**
 * Subset of the old MealSlotRow that the merged Home feed needs. Only meals
 * with a recipe assigned are rendered, and tap-through routes to /recipes
 * (the Meal landing page) rather than mutating in place.
 */
export type MealFeedItem = {
  slot: Slot;
  recipeName: string;
  /** Slot start time projected onto the selected date, ISO string. */
  slotTimeIso: string;
};

export type DayViewProps = {
  /** Selected date in YYYY-MM-DD (SG). */
  selectedYmd: string;
  /** Today's date in YYYY-MM-DD (SG). */
  todayYmd: string;
  /** Overdue occurrences. Only populated when selectedYmd === todayYmd. */
  overdue: OccurrenceRowItem[];
  /** Task occurrences on the selected date. */
  tasks: OccurrenceRowItem[];
  /** Planned meals for the selected date (already filtered to recipe!=null). */
  meals: MealFeedItem[];
  /** Can the caller mark tasks done / skip / hide? owner+maid only. */
  taskActionsEnabled: boolean;
  /** Can the caller see the "+ New task" button? owner/maid/family_member. */
  canAddTasks: boolean;
};

type FeedItem =
  | { kind: "task"; item: OccurrenceRowItem; sortKey: number }
  | { kind: "meal"; item: MealFeedItem; sortKey: number };

export function DayView(props: DayViewProps) {
  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);

  // Build the merged chronological feed. Tasks anchor on `due_at`; meals on
  // the configured slot time projected onto the selected date. Meals sort
  // before tasks at exactly equal times — slots are user-facing anchors and
  // any task at the same minute is subordinate.
  const merged: FeedItem[] = [
    ...props.tasks.map<FeedItem>((t) => ({
      kind: "task",
      item: t,
      sortKey: new Date(t.dueAt).getTime(),
    })),
    ...props.meals.map<FeedItem>((m) => ({
      kind: "meal",
      item: m,
      sortKey: new Date(m.slotTimeIso).getTime(),
    })),
  ].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    // Meals before tasks at equal times.
    if (a.kind !== b.kind) return a.kind === "meal" ? -1 : 1;
    if (a.kind === "task" && b.kind === "task") return a.item.title.localeCompare(b.item.title);
    if (a.kind === "meal" && b.kind === "meal") return a.item.slot.localeCompare(b.item.slot);
    return 0;
  });

  const empty = merged.length === 0 && props.overdue.length === 0;

  return (
    <section>
      <DayStrip activeYmd={props.selectedYmd} />

      <nav
        className="flex items-center justify-end gap-3 border-b border-border px-2 py-1.5"
        aria-label="Day actions"
      >
        {props.canAddTasks && (
          <Link href="/tasks/new">
            <Button size="sm">+ New task</Button>
          </Link>
        )}
      </nav>

      <div>
        {props.overdue.length > 0 && (
          <section className="border-l-4 border-destructive bg-destructive/5">
            <h3 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-destructive">
              Overdue
              <span className="ml-2 text-xs font-normal normal-case opacity-80">
                {props.overdue.length} item{props.overdue.length === 1 ? "" : "s"}
              </span>
            </h3>
            {props.overdue.map((it) => (
              <OccurrenceRow
                key={it.occurrenceId}
                item={it}
                readOnly={!props.taskActionsEnabled}
                onTap={() => props.taskActionsEnabled && setTarget(it)}
              />
            ))}
          </section>
        )}

        {merged.map((f) =>
          f.kind === "task" ? (
            <OccurrenceRow
              key={`t:${f.item.occurrenceId}`}
              item={f.item}
              readOnly={!props.taskActionsEnabled}
              onTap={() => props.taskActionsEnabled && setTarget(f.item)}
            />
          ) : (
            <MealInlineRow key={`m:${f.item.slot}`} item={f.item} />
          ),
        )}

        {empty && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing planned for this day.
          </p>
        )}
      </div>

      {target && (
        <OccurrenceActionSheet
          occurrenceId={target.occurrenceId}
          taskId={target.taskId}
          title={target.title}
          isStandard={target.isStandard}
          open={target !== null}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      )}
    </section>
  );
}

function MealInlineRow({ item }: { item: MealFeedItem }) {
  return (
    <Link
      href="/recipes"
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left",
        "bg-primary/5 hover:bg-primary/10",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.recipeName}</div>
        <div className="text-xs text-primary/80">{SLOT_LABEL[item.slot]}</div>
      </div>
      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
        Meal
      </span>
    </Link>
  );
}
