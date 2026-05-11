import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { TodayList } from "@/components/plan/today-list";
import { WeekStrip } from "@/components/plan/week-strip";
import type { Recipe } from "@/components/plan/recipe-picker";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

export default async function PlanForDate({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <main className="p-4">Invalid date.</main>;
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const readOnly = ctx.membership.role === "family_member";

  const { data: rawRows } = await supabase
    .from("meal_plans")
    .select("slot, recipe_id, set_by_profile_id, recipes(name, photo_path, household_id)")
    .eq("household_id", ctx.household.id)
    .eq("plan_date", date);

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
      setBySystem: r?.set_by_profile_id === null,
    };
  }

  const { data: effectiveRecipes } = await supabase
    .rpc("effective_recipes", { p_household: ctx.household.id });
  const recipes: Recipe[] = (effectiveRecipes ?? []).map((r: any) => ({
    id: r.id, name: r.name, slot: r.slot, photo_url: null,
  }));

  return (
    <main className="mx-auto max-w-md">
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">{date === new Date().toISOString().slice(0, 10) ? "Today" : "Plan"} · {date}</h1>
      </header>
      <TodayList planDate={date} rows={rows} recipes={recipes} readOnly={readOnly} />
      <WeekStrip activeDate={date} />
    </main>
  );
}

type TodayListProps = React.ComponentProps<typeof TodayList>;
