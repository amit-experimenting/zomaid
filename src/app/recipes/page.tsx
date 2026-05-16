import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { MainNav } from "@/components/site/main-nav";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

export default async function RecipesIndex({ searchParams }: { searchParams: Promise<{ q?: string; slot?: string }> }) {
  const sp = await searchParams;
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
    .filter((r: any) => !sp.slot || r.slot === sp.slot)
    .filter((r: any) => !sp.q || r.name.toLowerCase().includes(sp.q.toLowerCase()))
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Recipes</h1>
        <Link href="/recipes/new"><Button>+ Add</Button></Link>
      </div>
      <form className="mt-4 flex gap-2" action="/recipes" method="get">
        <Input name="q" placeholder="Search" defaultValue={sp.q ?? ""} />
        <select name="slot" defaultValue={sp.slot ?? ""} className="rounded-md border bg-background px-3 text-sm">
          <option value="">All</option>
          {ALL_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
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
