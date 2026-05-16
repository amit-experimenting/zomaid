"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRecipe, updateRecipe } from "@/app/recipes/actions";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
type Diet = "vegan" | "vegetarian" | "eggitarian" | "non_vegetarian";

export type RecipeFormProps = {
  mode: "create" | "edit";
  recipeId?: string;
  initial?: {
    name: string;
    slot: Slot;
    diet: Diet;
    prepTimeMinutes: number | null;
    defaultServings: number;
    notes: string | null;
    ingredients: { item_name: string; quantity: number | null; unit: string | null }[];
    steps: { instruction: string }[];
    youtubeUrl?: string | null;
  };
};

export function RecipeForm({ mode, recipeId, initial }: RecipeFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [slot, setSlot] = useState<Slot>(initial?.slot ?? "lunch");
  const [diet, setDiet] = useState<Diet>(initial?.diet ?? "non_vegetarian");
  const [prep, setPrep] = useState<string>(initial?.prepTimeMinutes?.toString() ?? "");
  const [servings, setServings] = useState<string>((initial?.defaultServings ?? 4).toString());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [ingredients, setIngredients] = useState(initial?.ingredients ?? [{ item_name: "", quantity: null, unit: null }]);
  const [steps, setSteps] = useState(initial?.steps ?? [{ instruction: "" }]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState(initial?.youtubeUrl ?? "");

  async function compressAndSet(file: File) {
    const out = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
    setPhotoFile(out);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const fd = new FormData();
      if (mode === "edit" && recipeId) fd.append("recipeId", recipeId);
      fd.append("name", name);
      fd.append("slot", slot);
      fd.append("diet", diet);
      if (prep) fd.append("prepTimeMinutes", prep);
      if (servings) fd.append("defaultServings", servings);
      fd.append("notes", notes);
      fd.append("ingredients", JSON.stringify(ingredients.filter((i) => i.item_name.trim().length > 0)));
      fd.append("steps", JSON.stringify(steps.filter((s) => s.instruction.trim().length > 0)));
      fd.append("youtubeUrl", youtubeUrl.trim());
      if (photoFile) fd.append("photoFile", photoFile);
      const res = await (mode === "create" ? createRecipe(fd) : updateRecipe(fd));
      if (!res.ok) { setError(res.error.message); return; }
      router.push(`/recipes/${res.data.recipeId}`);
    });
  }

  return (
    <form className="space-y-4 p-4" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="photo">Photo</Label>
        <input id="photo" type="file" accept="image/jpeg,image/png,image/webp"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void compressAndSet(f); }} />
      </div>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="slot">Slot</Label>
        <select id="slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="breakfast">Breakfast</option>
          <option value="lunch">Lunch</option>
          <option value="snacks">Snacks</option>
          <option value="dinner">Dinner</option>
        </select>
      </div>
      <div>
        <Label htmlFor="diet">Diet</Label>
        <select id="diet" value={diet} onChange={(e) => setDiet(e.target.value as Diet)}
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="vegan">Vegan</option>
          <option value="vegetarian">Vegetarian</option>
          <option value="eggitarian">Eggitarian</option>
          <option value="non_vegetarian">Non-vegetarian</option>
        </select>
      </div>
      <div>
        <Label htmlFor="prep">Prep time (minutes)</Label>
        <Input id="prep" type="number" min={1} value={prep} onChange={(e) => setPrep(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="servings">Serves (people)</Label>
        <Input id="servings" type="number" min={1} max={20} value={servings} onChange={(e) => setServings(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="youtubeUrl">Video URL</Label>
        <Input id="youtubeUrl" type="url" value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="Paste a YouTube link" />
        {youtubeUrl.trim() && (
          <a
            href={youtubeUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block break-all text-xs text-primary underline"
          >
            Watch video ↗
          </a>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ingredients</legend>
        {ingredients.map((ing, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2">
            <Input placeholder="Item" value={ing.item_name}
              onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, item_name: e.target.value } : x))} />
            <Input placeholder="Qty" type="number" value={ing.quantity ?? ""}
              onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, quantity: e.target.value ? Number(e.target.value) : null } : x))} />
            <Input placeholder="Unit" value={ing.unit ?? ""}
              onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, unit: e.target.value || null } : x))} />
            <Button type="button" variant="ghost" onClick={() => setIngredients(ingredients.filter((_, idx) => idx !== i))}>×</Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setIngredients([...ingredients, { item_name: "", quantity: null, unit: null }])}>+ Add ingredient</Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Steps</legend>
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea placeholder={`Step ${i + 1}`} value={s.instruction}
              onChange={(e) => setSteps(steps.map((x, idx) => idx === i ? { instruction: e.target.value } : x))} />
            <Button type="button" variant="ghost" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}>×</Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setSteps([...steps, { instruction: "" }])}>+ Add step</Button>
      </fieldset>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <PendingButton type="submit" pending={pending}>{mode === "create" ? "Create recipe" : "Save changes"}</PendingButton>
    </form>
  );
}
