import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { DayStrip } from "@/components/site/day-strip";
import { SlotRow } from "@/components/plan/slot-row";
import { SlotActionSheet } from "@/components/plan/slot-action-sheet";
import type { Recipe } from "@/components/plan/recipe-picker";
import type { Warning } from "@/components/plan/slot-warning-badge";
import type { Database } from "@/lib/db/types";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];
const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
};

const TZ = "Asia/Singapore";
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function resolveSelectedYmd(raw: string | undefined, todayYmd: string): string {
  if (!raw || !YMD_RE.test(raw)) return todayYmd;
  const probe = new Date(`${raw}T12:00:00+08:00`);
  if (Number.isNaN(probe.getTime()) || sgYmd(probe) !== raw) return todayYmd;
  return raw;
}

export default async function RecipesIndex({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; slot?: string; view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  // Each branch resolves its own ctx + supabase client. React Server
  // Components serialise props across function boundaries, and the
  // Supabase client carries non-serialisable methods (auth.toJSON,
  // storage callbacks). Passing it as a prop crashes the render with
  // "Unknown Value: React could not send it from the server".
  if (sp.view === "library") {
    return <LibraryView q={sp.q} slot={sp.slot} />;
  }
  return <PlannedView ctxDate={sp.date} />;
}

// ---------------------------------------------------------------------------
// Default view: per-day meal plan with the 4 slot rows. This is what `/recipes`
// (no params) lands on and what the old `MealTab` on `/dashboard` rendered.
// ---------------------------------------------------------------------------

async function PlannedView({ ctxDate }: { ctxDate: string | undefined }) {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const now = new Date();
  const todayYmd = sgYmd(now);
  const selectedYmd = resolveSelectedYmd(ctxDate, todayYmd);

  // Mirrors the old MealTab gating: can_modify_meal_plan() is NOT (family_member
  // ∧ view_only).
  const mealPlanReadOnly =
    ctx.membership.role === "family_member" && ctx.membership.privilege === "view_only";

  // Autofill meal slots when viewing today/future and caller can write. Cheap
  // when slots are already filled (RPC is idempotent).
  if (!mealPlanReadOnly && selectedYmd >= todayYmd) {
    const { error: autofillError } = await supabase.rpc("mealplan_autofill_date", {
      p_date: selectedYmd,
    });
    if (autofillError) {
      console.error("mealplan_autofill_date failed:", autofillError.message);
    }
  }

  const [
    { data: rawMealRows },
    { data: mealTimes },
    { count: rosterCount },
    { data: effectiveRecipes, error: effectiveErr },
  ] = await Promise.all([
    supabase
      .from("meal_plans")
      .select(
        "slot, recipe_id, set_by_profile_id, people_eating, deduction_warnings, recipes(name, photo_path, household_id, kcal_per_serving, carbs_g_per_serving, fat_g_per_serving, protein_g_per_serving)",
      )
      .eq("household_id", ctx.household.id)
      .eq("plan_date", selectedYmd),
    supabase
      .from("household_meal_times")
      .select("slot,meal_time")
      .eq("household_id", ctx.household.id),
    supabase
      .from("household_memberships")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id)
      .eq("status", "active"),
    supabase.rpc("effective_recipes", { p_household: ctx.household.id }),
  ]);

  if (effectiveErr) {
    console.error("[/recipes] effective_recipes failed:", effectiveErr);
  }

  // Meal locks: 1 hour before each slot's configured start.
  const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));
  // Server component — Date.now() is fine here (runs once per request, not in
  // client render). The react-hooks/purity rule is targeted at client components.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  function isLocked(slot: string): boolean {
    const t = timeBySlot[slot];
    if (!t) return false;
    const [hh, mm] = (t as string).split(":").map(Number);
    const slotDt = new Date(
      `${selectedYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`,
    );
    return nowMs >= slotDt.getTime() - 60 * 60 * 1000;
  }

  type SlotRowData = {
    slot: Slot;
    recipeId: string | null;
    recipeName: string | null;
    kcalPerServing: number | null;
    carbsGPerServing: number | null;
    fatGPerServing: number | null;
    proteinGPerServing: number | null;
    photoUrl: string | null;
    setBySystem: boolean;
    rowExists: boolean;
    peopleEating: number | null;
    locked: boolean;
    deductionWarnings: Warning[];
  };

  type RecipeShape = {
    name: string;
    photo_path: string | null;
    household_id: string | null;
    kcal_per_serving: number | string | null;
    carbs_g_per_serving: number | string | null;
    fat_g_per_serving: number | string | null;
    protein_g_per_serving: number | string | null;
  };

  const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

  const slots: SlotRowData[] = [];
  for (const s of ALL_SLOTS) {
    const r = rawMealRows?.find((x) => x.slot === s);
    const recipeRaw = r?.recipes as unknown as RecipeShape | RecipeShape[] | null;
    const recipe = Array.isArray(recipeRaw) ? recipeRaw[0] ?? null : recipeRaw;
    let photoUrl: string | null = null;
    if (recipe?.photo_path) {
      if (recipe.household_id === null) {
        photoUrl = supabase.storage
          .from("recipe-images-public")
          .getPublicUrl(recipe.photo_path).data.publicUrl;
      } else {
        const { data } = await supabase.storage
          .from("recipe-images-household")
          .createSignedUrl(recipe.photo_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
    }
    slots.push({
      slot: s,
      recipeId: r?.recipe_id ?? null,
      recipeName: recipe?.name ?? null,
      kcalPerServing: num(recipe?.kcal_per_serving),
      carbsGPerServing: num(recipe?.carbs_g_per_serving),
      fatGPerServing: num(recipe?.fat_g_per_serving),
      proteinGPerServing: num(recipe?.protein_g_per_serving),
      photoUrl,
      setBySystem: r != null && r.set_by_profile_id === null,
      rowExists: r != null,
      peopleEating: r?.people_eating ?? null,
      locked: isLocked(s),
      deductionWarnings: (r?.deduction_warnings ?? []) as Warning[],
    });
  }

  const rosterSize = rosterCount ?? 1;
  const recipes: Recipe[] = (effectiveRecipes ?? []).map(
    (r: { id: string; name: string; slot: string }) => ({
      id: r.id,
      name: r.name,
      slot: r.slot,
      photo_url: null,
    }),
  );
  const libraryEmpty = recipes.length === 0;

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="Meal plan"
        trailing={
          <Link href="/recipes?view=library">
            <Button variant="secondary">Recipes</Button>
          </Link>
        }
      />
      <DayStrip activeYmd={selectedYmd} baseHref="/recipes" />
      {libraryEmpty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">Your recipe library is empty.</p>
          {!mealPlanReadOnly && (
            <Button nativeButton={false} render={<Link href="/recipes/new" />}>
              Add your first recipe →
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {slots.map((row) => (
            <SlotActionSheet
              key={row.slot}
              planDate={selectedYmd}
              slot={row.slot}
              currentRecipeId={row.recipeId}
              currentRecipeName={row.recipeName}
              recipes={recipes}
              readOnly={mealPlanReadOnly}
              trigger={
                <SlotRow
                  slot={row.slot}
                  recipeId={row.recipeId}
                  recipeName={row.recipeName}
                  kcalPerServing={row.kcalPerServing}
                  carbsGPerServing={row.carbsGPerServing}
                  fatGPerServing={row.fatGPerServing}
                  proteinGPerServing={row.proteinGPerServing}
                  photoUrl={row.photoUrl}
                  setBySystem={row.setBySystem}
                  rowExists={row.rowExists}
                  readOnly={mealPlanReadOnly}
                  planDate={selectedYmd}
                  peopleEating={row.peopleEating}
                  rosterSize={rosterSize}
                  locked={row.locked}
                  deductionWarnings={row.deductionWarnings}
                />
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Library view: the old `/recipes` grid (search/filter + RecipeCards). Lives
// at `/recipes?view=library` now.
// ---------------------------------------------------------------------------

async function LibraryView({
  q,
  slot,
}: {
  q: string | undefined;
  slot: string | undefined;
}) {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: effective, error: effectiveErr } = await supabase.rpc(
    "effective_recipes",
    { p_household: ctx.household.id },
  );
  if (effectiveErr) {
    // Logged for Vercel function logs; we degrade to empty list rather than
    // 500ing the page when the RPC chokes (e.g., schema drift mid-deploy).
    console.error("[/recipes] effective_recipes failed:", effectiveErr);
  }
  const filtered = ((effective ?? []) as RecipeRow[])
    .filter((r) => !slot || r.slot === slot)
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => r.archived_at === null);

  const role = ctx.membership.role;
  const priv = ctx.membership.privilege;
  const canAddToPlan =
    role === "owner" || role === "maid" || (role === "family_member" && priv === "meal_modify");

  // Compute photo URL per row. Each row is independently try/catch'd so a bad
  // photo_path on one recipe (missing file, malformed key, etc.) can never
  // crash the whole index — the SVG placeholder takes over for that card.
  const cards = await Promise.all(filtered.map(async (r) => {
    let photoUrl: string | null = null;
    if (r.photo_path) {
      try {
        if (r.household_id === null) {
          photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(r.photo_path).data.publicUrl;
        } else {
          const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(r.photo_path, 3600);
          photoUrl = data?.signedUrl ?? null;
        }
      } catch (err) {
        console.error(`[/recipes] photo URL failed for ${r.id}:`, err);
        photoUrl = null;
      }
    }
    return {
      id: r.id, name: r.name, slot: r.slot, prepTimeMinutes: r.prep_time_minutes,
      photoUrl, isFork: !!r.parent_recipe_id,
      youtubeUrl: r.youtube_url ?? null,
      // numeric columns come back as strings from PostgREST.
      kcalPerServing: r.kcal_per_serving == null ? null : Number(r.kcal_per_serving),
      canAddToPlan,
    };
  }));

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="Recipes"
        trailing={
          <div className="flex items-center gap-2">
            <Link href="/recipes">
              <Button variant="secondary">Planned</Button>
            </Link>
            <Link href="/recipes/new"><Button>+ Add</Button></Link>
          </div>
        }
      />
      <div className="px-4 py-4">
        <form className="flex gap-2" action="/recipes" method="get">
          <input type="hidden" name="view" value="library" />
          <Input name="q" placeholder="Search" defaultValue={q ?? ""} />
          <select name="slot" defaultValue={slot ?? ""} className="rounded-md border bg-background px-3 text-sm">
            <option value="">All</option>
            {ALL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <div className="mt-4 grid gap-2">
          {cards.length === 0 && <p className="py-8 text-center text-muted-foreground">No recipes match.</p>}
          {cards.map((c) => <RecipeCard key={c.id} {...c} />)}
        </div>
      </div>
    </main>
  );
}
