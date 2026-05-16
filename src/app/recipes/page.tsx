import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { MainNav } from "@/components/site/main-nav";
import { DayStrip } from "@/components/site/day-strip";
import { SlotRow } from "@/components/plan/slot-row";
import { SlotActionSheet } from "@/components/plan/slot-action-sheet";
import type { Recipe } from "@/components/plan/recipe-picker";
import type { Warning } from "@/components/plan/slot-warning-badge";

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
        "slot, recipe_id, set_by_profile_id, people_eating, deduction_warnings, recipes(name, photo_path, household_id)",
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
    photoUrl: string | null;
    setBySystem: boolean;
    rowExists: boolean;
    peopleEating: number | null;
    locked: boolean;
    deductionWarnings: Warning[];
  };

  const slots: SlotRowData[] = [];
  for (const s of ALL_SLOTS) {
    const r = rawMealRows?.find((x) => x.slot === s);
    const recipeRaw = r?.recipes as unknown as
      | { name: string; photo_path: string | null; household_id: string | null }
      | { name: string; photo_path: string | null; household_id: string | null }[]
      | null;
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
      <MainNav active="recipes" />
      <div className="px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Planned meals</h1>
          <Link href="/recipes?view=library">
            <Button variant="outline">Recipes</Button>
          </Link>
        </div>
      </div>
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
  const filtered = (effective ?? [])
    .filter((r: any) => !slot || r.slot === slot)
    .filter((r: any) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
    .filter((r: any) => r.archived_at === null);

  const role = ctx.membership.role;
  const priv = ctx.membership.privilege;
  const canAddToPlan =
    role === "owner" || role === "maid" || (role === "family_member" && priv === "meal_modify");

  // Compute photo URL per row. Each row is independently try/catch'd so a bad
  // photo_path on one recipe (missing file, malformed key, etc.) can never
  // crash the whole index — the SVG placeholder takes over for that card.
  const cards = await Promise.all(filtered.map(async (r: any) => {
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
      canAddToPlan,
    };
  }));

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="recipes" />
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Recipes</h1>
          <div className="flex items-center gap-2">
            <Link href="/recipes">
              <Button variant="outline">Planned meals</Button>
            </Link>
            <Link href="/recipes/new"><Button>+ Add</Button></Link>
          </div>
        </div>
        <form className="mt-4 flex gap-2" action="/recipes" method="get">
          <input type="hidden" name="view" value="library" />
          <Input name="q" placeholder="Search" defaultValue={q ?? ""} />
          <select name="slot" defaultValue={slot ?? ""} className="rounded-md border bg-background px-3 text-sm">
            <option value="">All</option>
            {ALL_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
          </select>
          <Button type="submit" variant="outline">Filter</Button>
        </form>
        <div className="mt-4 grid gap-2">
          {cards.length === 0 && <p className="py-8 text-center text-muted-foreground">No recipes match.</p>}
          {cards.map((c) => <RecipeCard key={c.id} {...c} />)}
        </div>
      </div>
    </main>
  );
}
