import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { RecipePhoto } from "@/components/recipes/recipe-photo";

export type RecipeCardProps = {
  id: string;
  name: string;
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  prepTimeMinutes: number | null;
  photoUrl: string | null;
  isFork: boolean;
};

const SLOT: Record<RecipeCardProps["slot"], string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
};

export function RecipeCard({ id, name, slot, prepTimeMinutes, photoUrl, isFork }: RecipeCardProps) {
  return (
    <Link href={`/recipes/${id}`}>
      <Card className="hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
            <RecipePhoto src={photoUrl} alt={name} width={64} height={64} className="size-16 object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{name}</div>
            <div className="text-xs text-muted-foreground">
              {SLOT[slot]}{prepTimeMinutes ? ` · ${prepTimeMinutes}m` : ""}
            </div>
            {isFork && (
              <div className="mt-1 inline-block rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] uppercase">Customized</div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
