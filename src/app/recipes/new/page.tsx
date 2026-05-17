import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireHousehold } from "@/lib/auth/require";
import { IconButton } from "@/components/ui/icon-button";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function NewRecipePage() {
  await requireHousehold();
  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="New recipe"
        leading={
          <IconButton variant="ghost" aria-label="Back" render={<Link href="/recipes?view=library" />}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <RecipeForm mode="create" />
    </main>
  );
}
