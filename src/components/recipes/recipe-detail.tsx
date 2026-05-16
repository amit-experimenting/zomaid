import { RecipePhoto } from "@/components/recipes/recipe-photo";

export type RecipeDetailProps = {
  name: string;
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  prepTimeMinutes: number | null;
  defaultServings: number;
  photoUrl: string | null;
  notes: string | null;
  youtubeUrl: string | null;
  /**
   * Per-serving nutrition. `null` (or all-null fields) renders nothing.
   * We only render the row when `kcal` is present — partial macros without
   * a kcal anchor would look incomplete.
   */
  nutrition: {
    kcal: number | null;
    carbsG: number | null;
    fatG: number | null;
    proteinG: number | null;
  } | null;
  ingredients: { position: number; item_name: string; quantity: string | null; unit: string | null }[];
  steps: { position: number; instruction: string }[];
};

const SLOT: Record<RecipeDetailProps["slot"], string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
};

export function RecipeDetail(p: RecipeDetailProps) {
  return (
    <article>
      <div className="aspect-video w-full overflow-hidden bg-muted">
        <RecipePhoto src={p.photoUrl} alt={p.name} width={1280} height={720} className="size-full object-cover" />
      </div>
      <div className="px-4 py-4">
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <div className="mt-1 text-sm text-muted-foreground">
          {SLOT[p.slot]}
          {p.prepTimeMinutes ? ` · ${p.prepTimeMinutes}m prep` : ""}
          {` · serves ${p.defaultServings}`}
        </div>
        {p.nutrition?.kcal != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            {[
              `${Math.round(p.nutrition.kcal)} kcal`,
              p.nutrition.carbsG != null ? `C ${Math.round(p.nutrition.carbsG)}g` : null,
              p.nutrition.fatG != null ? `F ${Math.round(p.nutrition.fatG)}g` : null,
              p.nutrition.proteinG != null ? `P ${Math.round(p.nutrition.proteinG)}g` : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
            {" per serving"}
          </div>
        )}
        {p.youtubeUrl && (
          <a
            href={p.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm text-red-600 hover:bg-muted"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
              <path d="M4 3.5v9l8-4.5-8-4.5z" />
            </svg>
            Watch video
          </a>
        )}
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</h2>
          <ul className="mt-2 space-y-1">
            {p.ingredients.sort((a, b) => a.position - b.position).map((i) => (
              <li key={i.position}>• {i.quantity ?? ""}{i.unit ? ` ${i.unit}` : ""} {i.item_name}</li>
            ))}
          </ul>
        </section>
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {p.steps.sort((a, b) => a.position - b.position).map((s) => (
              <li key={s.position}>{s.instruction}</li>
            ))}
          </ol>
        </section>
        {p.notes && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
            <p className="mt-2 whitespace-pre-line">{p.notes}</p>
          </section>
        )}
      </div>
    </article>
  );
}
