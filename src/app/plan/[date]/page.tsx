import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { TodayList } from "@/components/plan/today-list";
import { WeekStrip } from "@/components/plan/week-strip";
import { Button } from "@/components/ui/button";
import type { Recipe } from "@/components/plan/recipe-picker";
import { MainNav } from "@/components/site/main-nav";
import type { Warning } from "@/components/plan/slot-warning-badge";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

export default async function PlanForDate({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <main className="p-4">Invalid date.</main>;
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();
  // Owner/maid have privilege 'full' by default; family_member is gated by privilege.
  // Mirrors the can_modify_meal_plan() DB helper used by meal_plans RLS.
  const readOnly =
    ctx.membership.role === "family_member" && ctx.membership.privilege === "view_only";

  // Auto-fill empty slots when the date is today or future and the caller can write.
  // The RPC is idempotent — already-filled slots are not overwritten.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!readOnly && date >= todayIso) {
    const { error: autofillError } = await supabase.rpc("mealplan_autofill_date", { p_date: date });
    if (autofillError) {
      // Non-fatal: log and continue rendering whatever rows do exist.
      console.error("mealplan_autofill_date failed:", autofillError.message);
    }
  }

  const { data: rawRows } = await supabase
    .from("meal_plans")
    .select("slot, recipe_id, set_by_profile_id, people_eating, deduction_warnings, recipes(name, photo_path, household_id)")
    .eq("household_id", ctx.household.id)
    .eq("plan_date", date);

  const { data: mealTimes } = await supabase
    .from("household_meal_times")
    .select("slot,meal_time")
    .eq("household_id", ctx.household.id);
  const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));
  const nowMs = Date.now();

  function isLocked(slot: string): boolean {
    const t = timeBySlot[slot];
    if (!t) return false;
    const [hh, mm] = (t as string).split(":").map(Number);
    const slotDt = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);
    return nowMs >= slotDt.getTime() - 60 * 60 * 1000;
  }

  const { count: rosterCount } = await supabase
    .from("household_memberships")
    .select("id", { count: "exact", head: true })
    .eq("household_id", ctx.household.id)
    .eq("status", "active");
  const rosterSize = rosterCount ?? 1;

  // Sequential awaits via for-of because Supabase signed URLs are async.
  const rows = {} as TodayListProps["rows"];
  for (const s of ALL_SLOTS) {
    const r = rawRows?.find((x: any) => x.slot === s);
    const recipeRaw = r?.recipes as unknown as { name: string; photo_path: string | null; household_id: string | null } | { name: string; photo_path: string | null; household_id: string | null }[] | null;
    const recipe = Array.isArray(recipeRaw) ? recipeRaw[0] ?? null : recipeRaw;
    let photoUrl: string | null = null;
    if (recipe?.photo_path) {
      if (recipe.household_id === null) {
        photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(recipe.photo_path).data.publicUrl;
      } else {
        const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(recipe.photo_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
    }
    rows[s] = {
      recipeId: r?.recipe_id ?? null,
      recipeName: recipe?.name ?? null,
      photoUrl,
      setBySystem: r != null && r.set_by_profile_id === null,
      rowExists: r != null,
      peopleEating: r?.people_eating ?? null,
      locked: isLocked(s),
      deductionWarnings: (r?.deduction_warnings ?? []) as Warning[],
    };
  }

  const { data: effectiveRecipes } = await supabase
    .rpc("effective_recipes", { p_household: ctx.household.id });
  const recipes: Recipe[] = (effectiveRecipes ?? []).map((r: any) => ({
    id: r.id, name: r.name, slot: r.slot, photo_url: null,
  }));

  const libraryEmpty = recipes.length === 0;

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="plan" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">{date === new Date().toISOString().slice(0, 10) ? "Today" : "Plan"} · {date}</h1>
      </header>
      {libraryEmpty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">Your recipe library is empty.</p>
          {!readOnly && (
            <Button nativeButton={false} render={<Link href="/recipes/new" />}>Add your first recipe →</Button>
          )}
        </div>
      ) : (
        <>
          <TodayList planDate={date} rows={rows} recipes={recipes} readOnly={readOnly} rosterSize={rosterSize} />
        </>
      )}
      <WeekStrip activeDate={date} />
    </main>
  );
}

type TodayListProps = React.ComponentProps<typeof TodayList>;
