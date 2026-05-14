// src/app/household/meal-times/page.tsx
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { Button } from "@/components/ui/button";
import { updateMealTime } from "./actions";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];
const LABEL: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner" };

export default async function MealTimesPage() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("household_meal_times")
    .select("slot,meal_time")
    .eq("household_id", ctx.household.id);

  const bySlot = Object.fromEntries((rows ?? []).map((r) => [r.slot, r.meal_time])) as Record<Slot, string>;

  async function save(formData: FormData) {
    "use server";
    const slot = String(formData.get("slot") ?? "") as Slot;
    const meal_time = String(formData.get("meal_time") ?? "");
    if (!SLOTS.includes(slot) || !/^\d{2}:\d{2}$/.test(meal_time)) return;
    await updateMealTime({ slot, meal_time });
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="plan" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">Meal times</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Used to decide when cooked meals deduct from inventory and when each slot locks for edits (1 hour before its start).
        </p>
      </header>
      <div className="flex flex-col gap-3 px-4 py-2">
        {SLOTS.map((s) => (
          <form key={s} action={save} className="flex items-center justify-between rounded border p-3">
            <input type="hidden" name="slot" value={s} />
            <span className="text-sm font-medium">{LABEL[s]}</span>
            <div className="flex items-center gap-2">
              <input
                type="time"
                name="meal_time"
                defaultValue={(bySlot[s] ?? "").slice(0, 5)}
                required
                className="rounded border px-2 py-1 text-sm"
              />
              <Button type="submit" size="sm" variant="outline">Save</Button>
            </div>
          </form>
        ))}
      </div>
    </main>
  );
}
