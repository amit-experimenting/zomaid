"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { OccurrenceRow, type OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { OccurrenceActionSheet } from "@/components/tasks/occurrence-action-sheet";

const SLOT_LABEL = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
} as const;

export type MealItem = {
  slot: keyof typeof SLOT_LABEL;
  recipeId: string | null;
  recipeName: string | null;
};

export type TodayViewProps = {
  /** Today's date in YYYY-MM-DD (SG). Used for /plan link. */
  dateYmd: string;
  tasks: OccurrenceRowItem[];
  meals: MealItem[];
  readOnly: boolean;
};

type View = "tasks" | "meal";

const SLOT_ORDER: MealItem["slot"][] = ["breakfast", "lunch", "snacks", "dinner"];

export function TodayView({ dateYmd, tasks, meals, readOnly }: TodayViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "meal" ? "meal" : "tasks";

  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);

  function setView(next: View) {
    const sp = new URLSearchParams(params);
    if (next === "tasks") sp.delete("view");
    else sp.set("view", next);
    const qs = sp.toString();
    router.replace(`/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const orderedMeals = SLOT_ORDER
    .map((s) => meals.find((m) => m.slot === s) ?? { slot: s, recipeId: null, recipeName: null });

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Today
        </h2>
        <button
          type="button"
          onClick={() => setView(view === "tasks" ? "meal" : "tasks")}
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          {view === "tasks" ? "Show meal plan →" : "Show tasks →"}
        </button>
      </div>

      {view === "tasks" ? (
        <TasksView
          dateYmd={dateYmd}
          tasks={tasks}
          meals={orderedMeals}
          readOnly={readOnly}
          onTap={(it) => !readOnly && setTarget(it)}
        />
      ) : (
        <MealView dateYmd={dateYmd} meals={orderedMeals} />
      )}

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

function TasksView({
  dateYmd, tasks, meals, readOnly, onTap,
}: {
  dateYmd: string;
  tasks: OccurrenceRowItem[];
  meals: MealItem[];
  readOnly: boolean;
  onTap: (it: OccurrenceRowItem) => void;
}) {
  const empty = tasks.length === 0 && meals.every((m) => m.recipeId === null);
  return (
    <div>
      {/* Meal-plan items rendered as colored rows inline with tasks. Color
          differentiates them at a glance; tap navigates to /plan for edits. */}
      {meals.map((m) => (
        <MealRow key={m.slot} dateYmd={dateYmd} item={m} compact />
      ))}
      {tasks.map((t) => (
        <OccurrenceRow
          key={t.occurrenceId}
          item={t}
          readOnly={readOnly}
          onTap={() => onTap(t)}
        />
      ))}
      {empty && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing planned for today.
        </p>
      )}
    </div>
  );
}

function MealView({ dateYmd, meals }: { dateYmd: string; meals: MealItem[] }) {
  return (
    <div>
      {meals.map((m) => (
        <MealRow key={m.slot} dateYmd={dateYmd} item={m} />
      ))}
    </div>
  );
}

function MealRow({
  dateYmd, item, compact,
}: { dateYmd: string; item: MealItem; compact?: boolean }) {
  const slotLabel = SLOT_LABEL[item.slot];
  const text = item.recipeName ?? "Not planned";
  return (
    <Link
      href={`/plan/${dateYmd}`}
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
        "bg-primary/5 hover:bg-primary/10",
        compact && "py-2.5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn(
          "truncate font-medium",
          item.recipeId === null && "italic text-muted-foreground",
        )}>
          {text}
        </div>
        <div className="text-xs text-primary/80">{slotLabel}</div>
      </div>
      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
        Meal
      </span>
    </Link>
  );
}
