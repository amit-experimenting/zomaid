"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";
import type { Database } from "@/lib/db/types";

const SlotEnum = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
const DietEnum = z.enum(["vegan", "vegetarian", "eggitarian", "non_vegetarian"]);
const IngredientSchema = z.object({
  item_name: z.string().min(1).max(120),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().min(1).max(24).optional().nullable(),
});
const StepSchema = z.object({
  instruction: z.string().min(1).max(2000),
});
const PhotoConstraints = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
};

export type RecipeActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

function validatePhoto(file: File | null): { ok: true } | { ok: false; code: "RECIPE_PHOTO_TOO_LARGE" | "RECIPE_PHOTO_BAD_TYPE"; message: string } {
  if (!file) return { ok: true };
  if (file.size > PhotoConstraints.maxBytes) return { ok: false, code: "RECIPE_PHOTO_TOO_LARGE", message: "Photo exceeds 5 MB." };
  if (!(PhotoConstraints.mimeTypes as readonly string[]).includes(file.type)) {
    return { ok: false, code: "RECIPE_PHOTO_BAD_TYPE", message: "Only JPEG, PNG, or WebP photos are allowed." };
  }
  return { ok: true };
}

async function uploadPhoto(supabase: Awaited<ReturnType<typeof createClient>>, householdId: string, recipeId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${householdId}/${recipeId}.${ext}`;
  const { error } = await supabase.storage
    .from("recipe-images-household")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

const YoutubeUrlSchema = z
  .string()
  .regex(/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]+/, {
    message: "Must be a YouTube URL (https://www.youtube.com/watch?v=... or https://youtu.be/...)",
  });

const CreateRecipeSchema = z.object({
  name: z.string().min(1).max(120),
  slot: SlotEnum,
  diet: DietEnum,
  prepTimeMinutes: z.number().int().positive().optional().nullable(),
  defaultServings: z.number().int().min(1).max(20).optional(),
  notes: z.string().max(2000).optional().nullable(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  youtubeUrl: YoutubeUrlSchema.optional().nullable(),
  kcalPerServing: z.number().nonnegative().optional().nullable(),
  carbsGPerServing: z.number().nonnegative().optional().nullable(),
  fatGPerServing: z.number().nonnegative().optional().nullable(),
  proteinGPerServing: z.number().nonnegative().optional().nullable(),
});

/** Read a nullable numeric field from a form. Empty string → null. */
function numField(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Same as numField but distinguishes "not submitted" (undefined) from "cleared" (null). */
function numFieldOptional(fd: FormData, key: string): number | null | undefined {
  const v = fd.get(key);
  if (v === null) return undefined;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createRecipe(formData: FormData): Promise<RecipeActionResult<{ recipeId: string }>> {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const photoFile = formData.get("photoFile") as File | null;
  const photoCheck = validatePhoto(photoFile);
  if (!photoCheck.ok) return { ok: false, error: { code: photoCheck.code, message: photoCheck.message } };

  const ytRaw = (formData.get("youtubeUrl") as string | null) ?? "";
  const raw = {
    name: formData.get("name"),
    slot: formData.get("slot"),
    diet: formData.get("diet"),
    prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : null,
    defaultServings: formData.get("defaultServings") ? Number(formData.get("defaultServings")) : undefined,
    notes: formData.get("notes") || null,
    ingredients: JSON.parse((formData.get("ingredients") as string) || "[]"),
    steps: JSON.parse((formData.get("steps") as string) || "[]"),
    youtubeUrl: ytRaw.trim() === "" ? null : ytRaw.trim(),
    kcalPerServing: numField(formData, "kcalPerServing"),
    carbsGPerServing: numField(formData, "carbsGPerServing"),
    fatGPerServing: numField(formData, "fatGPerServing"),
    proteinGPerServing: numField(formData, "proteinGPerServing"),
  };
  const parsed = CreateRecipeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "RECIPE_INVALID", message: "Invalid recipe input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };
  }

  const { data: recipeRow, error: rErr } = await supabase
    .from("recipes")
    .insert({
      household_id: ctx.household.id,
      name: parsed.data.name,
      slot: parsed.data.slot,
      diet: parsed.data.diet,
      prep_time_minutes: parsed.data.prepTimeMinutes ?? null,
      default_servings: parsed.data.defaultServings ?? 4,
      notes: parsed.data.notes ?? null,
      youtube_url: parsed.data.youtubeUrl ?? null,
      kcal_per_serving: parsed.data.kcalPerServing ?? null,
      carbs_g_per_serving: parsed.data.carbsGPerServing ?? null,
      fat_g_per_serving: parsed.data.fatGPerServing ?? null,
      protein_g_per_serving: parsed.data.proteinGPerServing ?? null,
      created_by_profile_id: ctx.profile.id,
    })
    .select("id")
    .single();
  if (rErr || !recipeRow) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: rErr?.message ?? "Insert failed" } };

  const ingredientRows = parsed.data.ingredients.map((ing, i) => ({
    recipe_id: recipeRow.id, position: i + 1,
    item_name: ing.item_name, quantity: ing.quantity ?? null, unit: ing.unit ?? null,
  }));
  if (ingredientRows.length > 0) {
    const { error } = await supabase.from("recipe_ingredients").insert(ingredientRows);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
  }
  const stepRows = parsed.data.steps.map((s, i) => ({
    recipe_id: recipeRow.id, position: i + 1, instruction: s.instruction,
  }));
  if (stepRows.length > 0) {
    const { error } = await supabase.from("recipe_steps").insert(stepRows);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
  }

  if (photoFile && photoFile.size > 0) {
    const path = await uploadPhoto(supabase, ctx.household.id, recipeRow.id, photoFile);
    await supabase.from("recipes").update({ photo_path: path }).eq("id", recipeRow.id);
  }

  revalidatePath("/recipes");
  revalidatePath("/dashboard");
  return { ok: true, data: { recipeId: recipeRow.id } };
}

const UpdateRecipeSchema = CreateRecipeSchema.partial().extend({
  recipeId: z.string().uuid(),
});

export async function updateRecipe(formData: FormData): Promise<RecipeActionResult<{ recipeId: string }>> {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const photoFile = formData.get("photoFile") as File | null;
  const photoCheck = validatePhoto(photoFile);
  if (!photoCheck.ok) return { ok: false, error: { code: photoCheck.code, message: photoCheck.message } };

  const ytRaw = formData.get("youtubeUrl");
  const youtubeUrl = ytRaw === null ? undefined : ((ytRaw as string).trim() === "" ? null : (ytRaw as string).trim());
  const raw = {
    recipeId: formData.get("recipeId"),
    name: formData.get("name") || undefined,
    slot: formData.get("slot") || undefined,
    diet: formData.get("diet") || undefined,
    prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : undefined,
    defaultServings: formData.get("defaultServings") ? Number(formData.get("defaultServings")) : undefined,
    notes: formData.get("notes") || undefined,
    ingredients: formData.get("ingredients") ? JSON.parse(formData.get("ingredients") as string) : undefined,
    steps: formData.get("steps") ? JSON.parse(formData.get("steps") as string) : undefined,
    youtubeUrl,
    kcalPerServing: numFieldOptional(formData, "kcalPerServing"),
    carbsGPerServing: numFieldOptional(formData, "carbsGPerServing"),
    fatGPerServing: numFieldOptional(formData, "fatGPerServing"),
    proteinGPerServing: numFieldOptional(formData, "proteinGPerServing"),
  };
  const parsed = UpdateRecipeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { code: "RECIPE_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };

  const { data: target, error: tErr } = await supabase
    .from("recipes")
    .select("id, household_id, parent_recipe_id, diet, slot, default_servings")
    .eq("id", parsed.data.recipeId)
    .single();
  if (tErr || !target) return { ok: false, error: { code: "RECIPE_NOT_FOUND", message: "Recipe not found" } };

  let effectiveRecipeId = target.id;
  // Fork-on-edit if target is a starter.
  if (target.household_id === null) {
    // Deep-copy starter -> household fork. Inherit diet + slot from the
    // starter so the NOT-NULL columns have values even when the edit
    // doesn't touch them; the patch below overrides if the form submitted
    // new values.
    const { data: forkRow, error: fErr } = await supabase
      .from("recipes")
      .insert({
        household_id: ctx.household.id,
        parent_recipe_id: target.id,
        name: parsed.data.name ?? "Forked recipe",
        slot: parsed.data.slot ?? target.slot,
        diet: parsed.data.diet ?? target.diet,
        default_servings: parsed.data.defaultServings ?? target.default_servings,
        created_by_profile_id: ctx.profile.id,
      })
      .select("id")
      .single();
    if (fErr || !forkRow) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: fErr?.message ?? "Fork failed" } };
    effectiveRecipeId = forkRow.id;
    // Deep-copy ingredients/steps from starter into fork
    const { data: srcIngs } = await supabase.from("recipe_ingredients").select("position,item_name,quantity,unit").eq("recipe_id", target.id);
    if (srcIngs && srcIngs.length > 0) {
      await supabase.from("recipe_ingredients").insert(srcIngs.map((i) => ({ ...i, recipe_id: effectiveRecipeId })));
    }
    const { data: srcSteps } = await supabase.from("recipe_steps").select("position,instruction").eq("recipe_id", target.id);
    if (srcSteps && srcSteps.length > 0) {
      await supabase.from("recipe_steps").insert(srcSteps.map((s) => ({ ...s, recipe_id: effectiveRecipeId })));
    }
  }

  // Apply scalar updates
  const patch: Database["public"]["Tables"]["recipes"]["Update"] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.slot !== undefined) patch.slot = parsed.data.slot;
  if (parsed.data.diet !== undefined) patch.diet = parsed.data.diet;
  if (parsed.data.prepTimeMinutes !== undefined) patch.prep_time_minutes = parsed.data.prepTimeMinutes;
  if (parsed.data.defaultServings !== undefined) patch.default_servings = parsed.data.defaultServings;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.youtubeUrl !== undefined) patch.youtube_url = parsed.data.youtubeUrl;
  if (parsed.data.kcalPerServing !== undefined) patch.kcal_per_serving = parsed.data.kcalPerServing;
  if (parsed.data.carbsGPerServing !== undefined) patch.carbs_g_per_serving = parsed.data.carbsGPerServing;
  if (parsed.data.fatGPerServing !== undefined) patch.fat_g_per_serving = parsed.data.fatGPerServing;
  if (parsed.data.proteinGPerServing !== undefined) patch.protein_g_per_serving = parsed.data.proteinGPerServing;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("recipes").update(patch).eq("id", effectiveRecipeId);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
  }

  // Replace ingredients / steps if arrays were provided
  if (parsed.data.ingredients !== undefined) {
    await supabase.from("recipe_ingredients").delete().eq("recipe_id", effectiveRecipeId);
    if (parsed.data.ingredients.length > 0) {
      await supabase.from("recipe_ingredients").insert(parsed.data.ingredients.map((i, idx) => ({
        recipe_id: effectiveRecipeId, position: idx + 1,
        item_name: i.item_name, quantity: i.quantity ?? null, unit: i.unit ?? null,
      })));
    }
  }
  if (parsed.data.steps !== undefined) {
    await supabase.from("recipe_steps").delete().eq("recipe_id", effectiveRecipeId);
    if (parsed.data.steps.length > 0) {
      await supabase.from("recipe_steps").insert(parsed.data.steps.map((s, idx) => ({
        recipe_id: effectiveRecipeId, position: idx + 1, instruction: s.instruction,
      })));
    }
  }

  if (photoFile && photoFile.size > 0) {
    const path = await uploadPhoto(supabase, ctx.household.id, effectiveRecipeId, photoFile);
    await supabase.from("recipes").update({ photo_path: path }).eq("id", effectiveRecipeId);
  }

  revalidatePath("/recipes");
  revalidatePath(`/recipes/${effectiveRecipeId}`);
  revalidatePath("/dashboard");
  return { ok: true, data: { recipeId: effectiveRecipeId } };
}

export async function addRecipeToTodayPlan(input: { recipeId: string }): Promise<RecipeActionResult<{ planDate: string }>> {
  const ctx = await requireHousehold();
  const supabase = await createClient();

  // Permission: owner, maid, or family_member with meal_modify privilege.
  const role = ctx.membership.role;
  const priv = ctx.membership.privilege;
  const canModify =
    role === "owner" || role === "maid" || (role === "family_member" && priv === "meal_modify");
  if (!canModify) {
    return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: "You don't have permission to modify the meal plan." } };
  }

  // Pull slot from the recipe so we know which today-slot to set.
  const { data: recipe, error: rErr } = await supabase
    .from("recipes")
    .select("id, slot")
    .eq("id", input.recipeId)
    .maybeSingle();
  if (rErr || !recipe) {
    return { ok: false, error: { code: "RECIPE_NOT_FOUND", message: "Recipe not found." } };
  }

  // Today in SG (en-CA gives ISO YYYY-MM-DD). Matches the rest of the app.
  const planDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { error: setErr } = await supabase.rpc("mealplan_set_slot", {
    p_date: planDate,
    p_slot: recipe.slot,
    p_recipe_id: recipe.id,
  });
  if (setErr) {
    return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: setErr.message } };
  }

  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return { ok: true, data: { planDate } };
}

