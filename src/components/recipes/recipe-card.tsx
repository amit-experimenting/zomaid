import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { RecipePhoto } from "@/components/recipes/recipe-photo";
import { AddToTodayButton } from "@/components/recipes/add-to-today-button";

export type RecipeCardProps = {
  id: string;
  name: string;
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  prepTimeMinutes: number | null;
  photoUrl: string | null;
  isFork: boolean;
  youtubeUrl: string | null;
  /** Per-serving calories. null hides the pill. */
  kcalPerServing: number | null;
  canAddToPlan: boolean;
};

const SLOT: Record<RecipeCardProps["slot"], string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
};

export function RecipeCard({
  id, name, slot, prepTimeMinutes, photoUrl, isFork, youtubeUrl, kcalPerServing, canAddToPlan,
}: RecipeCardProps) {
  return (
    <Card className="hover:bg-muted/50">
      <CardContent className="flex items-center gap-3 p-3">
        <Link href={`/recipes/${id}`} className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
          <RecipePhoto src={photoUrl} alt={name} width={64} height={64} className="size-16 object-cover" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/recipes/${id}`} className="block">
            <div className="truncate font-medium">{name}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                {SLOT[slot]}{prepTimeMinutes ? ` · ${prepTimeMinutes}m` : ""}
              </span>
              {kcalPerServing != null && (
                <span
                  className="rounded-full bg-muted px-1.5 py-0.5 tabular-nums"
                  style={{ fontSize: 10 }}
                >
                  {Math.round(kcalPerServing)} kcal
                </span>
              )}
            </div>
            {isFork && (
              <div
                className="mt-1 inline-block rounded-sm bg-secondary px-1.5 py-0.5 uppercase"
                style={{ fontSize: 10 }}
              >
                Customized
              </div>
            )}
          </Link>
          {(youtubeUrl || canAddToPlan) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {youtubeUrl && (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-red-600 hover:bg-muted"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 fill-current">
                    <path d="M4 3.5v9l8-4.5-8-4.5z" />
                  </svg>
                  Watch
                </a>
              )}
              {canAddToPlan && (
                <AddToTodayButton recipeId={id} slotLabel={SLOT[slot]} />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
