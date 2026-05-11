import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { cn } from "@/lib/utils";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: recipe } = await supabase.from("recipes")
    .select("id,name,slot,photo_path,prep_time_minutes,notes,household_id,parent_recipe_id,archived_at")
    .eq("id", id).maybeSingle();
  if (!recipe) notFound();
  const { data: ingredients } = await supabase.from("recipe_ingredients")
    .select("position,item_name,quantity,unit").eq("recipe_id", id).order("position");
  const { data: steps } = await supabase.from("recipe_steps")
    .select("position,instruction").eq("recipe_id", id).order("position");

  let photoUrl: string | null = null;
  if (recipe.photo_path) {
    if (recipe.household_id === null) {
      photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(recipe.photo_path).data.publicUrl;
    } else {
      const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(recipe.photo_path, 3600);
      photoUrl = data?.signedUrl ?? null;
    }
  }

  const canEdit = ctx.membership.role === "owner" || ctx.membership.role === "maid";

  return (
    <>
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <Link href="/recipes" className="text-sm">← Back</Link>
        {canEdit && (
          <Link href={`/recipes/${id}/edit`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Edit</Link>
        )}
      </header>
      <RecipeDetail
        name={recipe.name}
        slot={recipe.slot as any}
        prepTimeMinutes={recipe.prep_time_minutes}
        photoUrl={photoUrl}
        notes={recipe.notes}
        ingredients={(ingredients ?? []).map((i: any) => ({ ...i, quantity: i.quantity?.toString() ?? null }))}
        steps={steps ?? []}
      />
    </>
  );
}
