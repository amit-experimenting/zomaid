"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DayStrip } from "@/components/site/day-strip";
import { OccurrenceRow, type OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { OccurrenceActionSheet } from "@/components/tasks/occurrence-action-sheet";
import { NotificationToggle } from "@/components/tasks/notification-toggle";
import { SlotRow } from "@/components/plan/slot-row";
import { SlotActionSheet } from "@/components/plan/slot-action-sheet";
import type { Recipe } from "@/components/plan/recipe-picker";
import type { Warning } from "@/components/plan/slot-warning-badge";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const SLOT_ORDER: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];
const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
};

export type MealSlotRow = {
  slot: Slot;
  recipeId: string | null;
  recipeName: string | null;
  photoUrl: string | null;
  setBySystem: boolean;
  rowExists: boolean;
  peopleEating: number | null;
  locked: boolean;
  deductionWarnings: Warning[];
};

export type DayViewProps = {
  /** Selected date in YYYY-MM-DD (SG). */
  selectedYmd: string;
  /** Today's date in YYYY-MM-DD (SG) — used to label "Today" / "Yesterday" etc. */
  todayYmd: string;
  /** Long human label for the heading. */
  headingLabel: string;
  /** Overdue occurrences. Only populated when selectedYmd === todayYmd. */
  overdue: OccurrenceRowItem[];
  /** Task occurrences on the selected date. */
  tasks: OccurrenceRowItem[];
  /** Meal-plan rows for the selected date (always 4 in slot order). */
  meals: MealSlotRow[];
  /** Recipes for the slot picker (from effective_recipes RPC). */
  recipes: Recipe[];
  rosterSize: number;
  /** Can the caller mark tasks done / skip / hide? owner+maid only. */
  taskActionsEnabled: boolean;
  /** Can the caller see the "+ New task" button? owner/maid/family_member. */
  canAddTasks: boolean;
  /** Can the caller see / use the NotificationToggle? owner/maid only. */
  showNotificationToggle: boolean;
  /** Can the caller edit meal slots? (mirrors can_modify_meal_plan helper). */
  mealPlanReadOnly: boolean;
  /** True if the household has no recipes — meal tab shows empty state. */
  recipeLibraryEmpty: boolean;
};

type View = "tasks" | "meal";

export function DayView(props: DayViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "meal" ? "meal" : "tasks";

  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);

  function setView(next: View) {
    const sp = new URLSearchParams(params);
    if (next === "tasks") sp.delete("view");
    else sp.set("view", "meal");
    const qs = sp.toString();
    router.replace(`/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function gotoMealForDay() {
    // Tap a meal row inside the Tasks tab → switch to Meal tab on same date.
    const sp = new URLSearchParams(params);
    sp.set("view", "meal");
    const qs = sp.toString();
    router.replace(`/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3 border-b border-border px-1 pb-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {props.headingLabel}
        </h2>
        <div className="flex items-center gap-2">
          {props.canAddTasks && (
            <Link href="/tasks/new">
              <Button size="sm">+ New task</Button>
            </Link>
          )}
        </div>
      </div>
      {props.showNotificationToggle && (
        <div className="px-1 pt-2">
          <NotificationToggle />
        </div>
      )}

      <DayStrip activeYmd={props.selectedYmd} view={view} />

      <nav className="flex gap-1 border-b border-border px-2" aria-label="Day view">
        <TabButton active={view === "tasks"} onClick={() => setView("tasks")}>
          Tasks
        </TabButton>
        <TabButton active={view === "meal"} onClick={() => setView("meal")}>
          Meal plan
        </TabButton>
      </nav>

      {view === "tasks" ? (
        <TasksTab
          overdue={props.overdue}
          tasks={props.tasks}
          meals={props.meals}
          readOnly={!props.taskActionsEnabled}
          onTapTask={(it) => props.taskActionsEnabled && setTarget(it)}
          onTapMeal={gotoMealForDay}
        />
      ) : (
        <MealTab
          planDate={props.selectedYmd}
          meals={props.meals}
          recipes={props.recipes}
          readOnly={props.mealPlanReadOnly}
          rosterSize={props.rosterSize}
          libraryEmpty={props.recipeLibraryEmpty}
        />
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-b-2 px-3 py-2 text-sm",
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TasksTab({
  overdue,
  tasks,
  meals,
  readOnly,
  onTapTask,
  onTapMeal,
}: {
  overdue: OccurrenceRowItem[];
  tasks: OccurrenceRowItem[];
  meals: MealSlotRow[];
  readOnly: boolean;
  onTapTask: (it: OccurrenceRowItem) => void;
  onTapMeal: () => void;
}) {
  const empty =
    tasks.length === 0 && overdue.length === 0 && meals.every((m) => m.recipeId === null);
  return (
    <div>
      {overdue.length > 0 && (
        <section className="border-l-4 border-destructive bg-destructive/5">
          <h3 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-destructive">
            Overdue
            <span className="ml-2 text-xs font-normal normal-case opacity-80">
              {overdue.length} item{overdue.length === 1 ? "" : "s"}
            </span>
          </h3>
          {overdue.map((it) => (
            <OccurrenceRow
              key={it.occurrenceId}
              item={it}
              readOnly={readOnly}
              onTap={() => onTapTask(it)}
            />
          ))}
        </section>
      )}

      {meals.map((m) => (
        <MealInlineRow key={m.slot} item={m} onTap={onTapMeal} />
      ))}

      {tasks.map((t) => (
        <OccurrenceRow
          key={t.occurrenceId}
          item={t}
          readOnly={readOnly}
          onTap={() => onTapTask(t)}
        />
      ))}

      {empty && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing planned for this day.
        </p>
      )}
    </div>
  );
}

function MealInlineRow({
  item,
  onTap,
}: {
  item: MealSlotRow;
  onTap: () => void;
}) {
  const text = item.recipeName ?? "Not planned";
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left",
        "bg-primary/5 hover:bg-primary/10",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-medium",
            item.recipeId === null && "italic text-muted-foreground",
          )}
        >
          {text}
        </div>
        <div className="text-xs text-primary/80">{SLOT_LABEL[item.slot]}</div>
      </div>
      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
        Meal
      </span>
    </button>
  );
}

function MealTab({
  planDate,
  meals,
  recipes,
  readOnly,
  rosterSize,
  libraryEmpty,
}: {
  planDate: string;
  meals: MealSlotRow[];
  recipes: Recipe[];
  readOnly: boolean;
  rosterSize: number;
  libraryEmpty: boolean;
}) {
  if (libraryEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">Your recipe library is empty.</p>
        {!readOnly && (
          <Button nativeButton={false} render={<Link href="/recipes/new" />}>
            Add your first recipe →
          </Button>
        )}
      </div>
    );
  }
  // Order is guaranteed by the server fetch, but be defensive in case a slot
  // is missing from the input (shouldn't happen — we always emit 4 rows).
  const bySlot = new Map(meals.map((m) => [m.slot, m]));
  return (
    <div className="flex flex-col">
      {SLOT_ORDER.map((s) => {
        const row = bySlot.get(s);
        if (!row) return null;
        return (
          <SlotActionSheet
            key={s}
            planDate={planDate}
            slot={s}
            currentRecipeId={row.recipeId}
            currentRecipeName={row.recipeName}
            recipes={recipes}
            readOnly={readOnly}
            trigger={
              <SlotRow
                slot={s}
                recipeId={row.recipeId}
                recipeName={row.recipeName}
                photoUrl={row.photoUrl}
                setBySystem={row.setBySystem}
                rowExists={row.rowExists}
                readOnly={readOnly}
                planDate={planDate}
                peopleEating={row.peopleEating}
                rosterSize={rosterSize}
                locked={row.locked}
                deductionWarnings={row.deductionWarnings}
              />
            }
          />
        );
      })}
    </div>
  );
}
