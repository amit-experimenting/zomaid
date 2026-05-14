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
    .select("id,name,slot,prep_time_minutes,notes,youtube_url").eq("id", id).maybeSingle();
  if (!r) notFound();
  const { data: ingredients } = await supabase.from("recipe_ingredients")
    .select("item_name,quantity,unit").eq("recipe_id", id).order("position");
  const { data: steps } = await supabase.from("recipe_steps")
    .select("instruction").eq("recipe_id", id).order("position");

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="recipes" />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Edit recipe</h1>
      </header>
      <RecipeForm
        mode="edit"
        recipeId={id}
        initial={{
          name: r.name, slot: r.slot as any, prepTimeMinutes: r.prep_time_minutes, notes: r.notes,
          youtubeUrl: r.youtube_url,
          ingredients: (ingredients ?? []).map((i: any) => ({ item_name: i.item_name, quantity: i.quantity ?? null, unit: i.unit ?? null })),
          steps: (steps ?? []).map((s: any) => ({ instruction: s.instruction })),
        }}
      />
    </main>
  );
}
