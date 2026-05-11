import { requireHousehold } from "@/lib/auth/require";
import { MainNav } from "@/components/site/main-nav";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function NewRecipePage() {
  await requireHousehold();
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="recipes" />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">New recipe</h1>
      </header>
      <RecipeForm mode="create" />
    </main>
  );
}
