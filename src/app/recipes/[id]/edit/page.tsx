import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireHousehold();
  const supabase = await createClient();
  const { data: r } = await supabase.from("recipes")
    .select("id,name,slot,diet,prep_time_minutes,default_servings,notes,youtube_url,kcal_per_serving,carbs_g_per_serving,fat_g_per_serving,protein_g_per_serving").eq("id", id).maybeSingle();
  if (!r) notFound();
  const { data: ingredients } = await supabase.from("recipe_ingredients")
    .select("item_name,quantity,unit").eq("recipe_id", id).order("position");
  const { data: steps } = await supabase.from("recipe_steps")
    .select("instruction").eq("recipe_id", id).order("position");

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="recipes" />
      <div className="px-4 pt-3">
        <Link href={`/recipes/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
          ← Recipe
        </Link>
      </div>
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Edit recipe</h1>
      </header>
      <RecipeForm
        mode="edit"
        recipeId={id}
        initial={{
          name: r.name, slot: r.slot, diet: r.diet, prepTimeMinutes: r.prep_time_minutes,
          defaultServings: r.default_servings, notes: r.notes,
          youtubeUrl: r.youtube_url,
          kcalPerServing: r.kcal_per_serving == null ? null : Number(r.kcal_per_serving),
          carbsGPerServing: r.carbs_g_per_serving == null ? null : Number(r.carbs_g_per_serving),
          fatGPerServing: r.fat_g_per_serving == null ? null : Number(r.fat_g_per_serving),
          proteinGPerServing: r.protein_g_per_serving == null ? null : Number(r.protein_g_per_serving),
          ingredients: (ingredients ?? []).map((i) => ({
            item_name: i.item_name,
            quantity: i.quantity === null ? null : Number(i.quantity),
            unit: i.unit ?? null,
          })),
          steps: (steps ?? []).map((s) => ({ instruction: s.instruction })),
        }}
      />
    </main>
  );
}
