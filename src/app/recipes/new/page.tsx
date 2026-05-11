import { requireHousehold } from "@/lib/auth/require";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function NewRecipePage() {
  await requireHousehold();
  return <RecipeForm mode="create" />;
}
