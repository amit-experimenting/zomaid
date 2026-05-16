# Diet preferences (per member) + recipe diet classification

> **Superseded as the living architecture doc for the recipes area by [`features/recipes.md`](features/recipes.md).** This dated spec is retained for historical context.

Date: 2026-05-16

## Problem

The recipes table has no diet categorization, and `household_memberships`
has no per-member diet preference. As a result, a vegetarian household
auto-plans non-vegetarian recipes; a vegan household sees butter chicken in
the library.

The owner wants:

- A diet preference per member (`vegan` / `vegetarian` / `eggitarian` /
  `non_vegetarian`). Owners and family members can set their own; maids can
  set on behalf of any member.
- Recipes filtered by the household's strictest non-maid preference. The
  maid's preference is recorded but never drives the plan.
- A diet category on every recipe, classified for the 55 starter-pack
  recipes.

## Scope

In scope:

- New enum `public.diet`: `vegan | vegetarian | eggitarian | non_vegetarian`.
  Strictness order **vegan > vegetarian > eggitarian > non_vegetarian**.
- New column `recipes.diet public.diet not null` with starter data-fill.
  Household-owned recipes (forks/customs) backfilled to `non_vegetarian` (safe
  default; users can re-classify via the recipe edit form).
- New column `household_memberships.diet_preference public.diet`, nullable
  (`null` = no preference / eats anything).
- New SQL helper `household_strictest_diet(p_household uuid) returns
  public.diet`, which returns the strictest preference across **non-maid
  active members**, ignoring NULLs. Default `non_vegetarian`.
- Update `effective_recipes(p_household uuid)` to filter by the strictest
  diet. Cascades to library, slot-pick, auto-fill, suggestion engine — every
  consumer of the recipes pool — automatically.
- Settings page: per-member diet selector + a new `updateMembershipDiet`
  server action. Owner / maid / self can write.
- Recipe form: a diet selector input wired through `createRecipe` /
  `updateRecipe`.

Out of scope (deferred):

- Halal / kosher / allergen filters. Different problem.
- Per-recipe ingredient-driven auto-classification. The 55-recipe seed is
  the source of truth; customs and forks ship as `non_vegetarian` until
  re-classified.
- Auto-detecting that a recipe contains a non-veg ingredient ("anchovies"
  in Nasi Lemak) and warning if the diet column says `vegan`. Not enforced
  at the DB level.
- Bulk-edit UI for re-classifying many recipes at once.
- Showing the household's effective diet on the dashboard.

## Strictness semantics

| household has non-maid member at … | visible recipes |
|---|---|
| `non_vegetarian` or all NULL | every recipe (no filter) |
| at least one `eggitarian`, none stricter | `vegan ∪ vegetarian ∪ eggitarian` |
| at least one `vegetarian`, none `vegan` | `vegan ∪ vegetarian` |
| at least one `vegan` | `vegan` only |

A household with **only** a maid sees no filter (the maid's preference
doesn't count).

## Changes

### Migration `20260624_001_diet_preferences.sql`

```sql
create type public.diet as enum
  ('vegan', 'vegetarian', 'eggitarian', 'non_vegetarian');

alter table public.recipes
  add column diet public.diet;

alter table public.household_memberships
  add column diet_preference public.diet;
```

Then the starter-pack data fill (see classification table below), then a
backfill of all unclassified `recipes` rows to `non_vegetarian`, then
`alter table public.recipes alter column diet set not null`.

### Starter recipe classifications

Derived by reading each starter recipe's ingredient list. Eggs are
classified as `eggitarian` (matches user's spec). `sambal belacan`, `fish
sauce`, `oyster sauce`, `dried shrimp`, `pork floss`, and `chinese sausage`
push a recipe to `non_vegetarian` even when the surface dish looks veg
(Sambal Kangkong, Yam Cake, Stir-fried Tofu).

| Recipe | Diet |
|---|---|
| Kaya Toast with Soft-Boiled Eggs | eggitarian |
| Nasi Lemak | non_vegetarian |
| Roti Prata with Dhal | vegetarian |
| Mee Goreng | non_vegetarian |
| Idli with Sambar | vegan |
| Bee Hoon Soup | non_vegetarian |
| Congee with Pork Floss | non_vegetarian |
| Oats with Banana | vegetarian |
| Hainanese Chicken Rice | non_vegetarian |
| Char Kway Teow | non_vegetarian |
| Laksa | non_vegetarian |
| Fried Rice with Egg | eggitarian |
| Bak Kut Teh | non_vegetarian |
| Wonton Noodles | non_vegetarian |
| Vegetable Briyani | vegetarian |
| Hokkien Mee | non_vegetarian |
| Ondeh-Ondeh | vegan |
| Kueh Lapis | vegan |
| Fresh Fruit Bowl | vegetarian |
| Curry Puffs | non_vegetarian |
| Coconut Pancakes | eggitarian |
| Yam Cake | non_vegetarian |
| Sambal Kangkong with Rice | non_vegetarian |
| Steamed Fish with Ginger | non_vegetarian |
| Black Pepper Beef | non_vegetarian |
| Dhal Curry with Roti | vegetarian |
| Sweet & Sour Pork | non_vegetarian |
| Stir-fried Tofu and Vegetables | non_vegetarian |
| Chicken Curry with Rice | non_vegetarian |
| Mee Soto | non_vegetarian |
| Masala Dosa | vegetarian |
| Poha | vegan |
| Upma | vegetarian |
| Aloo Paratha | vegetarian |
| Medu Vada | vegan |
| Pongal | vegetarian |
| Rajma Chawal | vegan |
| Chole Bhature | vegetarian |
| Palak Paneer with Rice | vegetarian |
| Veg Pulao | vegetarian |
| Sambar Rice | vegetarian |
| Aloo Gobi with Roti | vegan |
| Curd Rice | vegetarian |
| Samosa | vegan |
| Pani Puri | vegan |
| Bhel Puri | vegan |
| Pakora | vegan |
| Masala Chai with Biscuits | vegetarian |
| Butter Chicken with Naan | non_vegetarian |
| Paneer Tikka Masala | vegetarian |
| Fish Curry | non_vegetarian |
| Mutton Rogan Josh | non_vegetarian |
| Baingan Bharta with Roti | vegan |
| Kadai Paneer | vegetarian |
| Egg Curry with Rice | eggitarian |

Tally: 12 vegan, 17 vegetarian, 4 eggitarian, 22 non_vegetarian.

### `household_strictest_diet` helper

```sql
create or replace function public.household_strictest_diet(p_household uuid)
  returns public.diet
  language sql stable security definer
  set search_path = public
  as $$
    select case
      when bool_or(hm.diet_preference = 'vegan'      ) then 'vegan'::public.diet
      when bool_or(hm.diet_preference = 'vegetarian' ) then 'vegetarian'::public.diet
      when bool_or(hm.diet_preference = 'eggitarian' ) then 'eggitarian'::public.diet
      else 'non_vegetarian'::public.diet
    end
    from public.household_memberships hm
    where hm.household_id = p_household
      and hm.status = 'active'
      and hm.role <> 'maid'
      and hm.diet_preference is not null;
  $$;
```

`security definer` so RLS doesn't trip the lookup when called from inside
`effective_recipes` under a caller who can see only their own membership
row. Same pattern as `is_active_owner` etc.

### Update `effective_recipes`

The current function returns starters + household rows via `union all`. New
version wraps the union and filters by diet:

```sql
create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    with strictest as (select public.household_strictest_diet(p_household) as d)
    select * from (
      -- starters not forked / not hidden (existing)
      select r.* from public.recipes r
      where r.household_id is null
        and r.archived_at is null
        and not exists (select 1 from public.recipes f
                        where f.household_id = p_household
                          and f.parent_recipe_id = r.id)
        and not exists (select 1 from public.household_recipe_hides h
                        where h.household_id = p_household
                          and h.recipe_id = r.id)
      union all
      -- household-owned (existing)
      select r.* from public.recipes r
      where r.household_id = p_household
        and r.archived_at is null
    ) all_recipes
    cross join strictest s
    where
      s.d = 'non_vegetarian'
      or (s.d = 'eggitarian' and all_recipes.diet in ('vegan','vegetarian','eggitarian'))
      or (s.d = 'vegetarian' and all_recipes.diet in ('vegan','vegetarian'))
      or (s.d = 'vegan'      and all_recipes.diet  = 'vegan');
  $$;
```

### Server action: `updateMembershipDiet`
([src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts))

```ts
const updateDietSchema = z.object({
  membershipId: z.uuid(),
  diet: z
    .union([z.literal(""), z.enum(["vegan","vegetarian","eggitarian","non_vegetarian"])])
    .optional(),
});

export async function updateMembershipDiet(input: unknown) {
  const data = updateDietSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");

  const svc = createServiceClient();
  const target = await svc
    .from("household_memberships")
    .select("household_id, profile_id, role")
    .eq("id", data.membershipId)
    .single();
  if (target.error) throw new Error(target.error.message);
  if (target.data.household_id !== ctx.household.id) throw new Error("forbidden");

  // Owner OR maid OR self may write.
  const callerRole = ctx.membership.role;
  const isSelf = target.data.profile_id === ctx.profile.id;
  if (callerRole !== "owner" && callerRole !== "maid" && !isSelf) {
    throw new Error("forbidden");
  }

  const value = data.diet && data.diet.length > 0 ? data.diet : null;
  const { error } = await svc
    .from("household_memberships")
    .update({ diet_preference: value })
    .eq("id", data.membershipId);
  if (error) throw new Error(error.message);

  revalidatePath("/household/settings");
  revalidatePath("/plan");
  revalidatePath("/recipes");
}
```

### Recipe form & actions

[src/app/recipes/actions.ts](../../src/app/recipes/actions.ts):

- `CreateRecipeSchema` and `UpdateRecipeSchema` get a `diet` zod enum
  (required on create, optional on update).
- `createRecipe` writes `diet: parsed.data.diet` into the insert.
- `updateRecipe` adds `if (parsed.data.diet !== undefined) patch.diet = …`.

[src/components/recipes/recipe-form.tsx](../../src/components/recipes/recipe-form.tsx):

- New `<select>` between Slot and Prep time. Options: vegan / vegetarian /
  eggitarian / non-vegetarian. Defaults to `non_vegetarian` on create; uses
  `initial.diet` on edit.

[src/app/recipes/[id]/edit/page.tsx](../../src/app/recipes/[id]/edit/page.tsx):

- Add `diet` to the `select(...)` and pass through `initial`.

### Settings page UI
([src/app/household/settings/page.tsx](../../src/app/household/settings/page.tsx))

Each member row gains a compact `<select>` for the diet preference (with a
"no preference" sentinel for null). The form submits to
`updateMembershipDiet`. Maid rows show their preference but a tiny note
says "(plan ignores maid preference)".

### Database types
([src/lib/db/types.ts](../../src/lib/db/types.ts))

- Add `type Diet = "vegan" | "vegetarian" | "eggitarian" | "non_vegetarian"`.
- `recipes.Row.diet: Diet`, `Insert.diet: Diet`.
- `household_memberships.Row.diet_preference: Diet | null`,
  `Insert.diet_preference?: Diet | null`.
- Add `household_strictest_diet` to `Functions`.

## Validation

- DB: `diet` is a typed enum so invalid values are rejected at write.
- Migration: every starter recipe is classified in the data-fill. Custom /
  fork recipes are backfilled to `non_vegetarian` before `set not null`.
- Action: zod rejects unknown enum values. Authorization check enforces
  owner-or-maid-or-self.
- Helper: `security definer` so RLS doesn't hide non-maid rows from a
  caller in a household they don't belong to. (The function is callable
  with any uuid; callers route only through `effective_recipes` and the
  settings page, which are scoped.)

## Testing

- `pnpm test`: existing suite stays green.
- Local SQL: apply the migration inside a transaction and verify (a) the
  enum exists, (b) all 55 starters have a diet, (c) helper returns
  expected values, (d) `effective_recipes` filters correctly for each
  preference setting.
- Manual browser flow:
  1. As owner, set own preference to `vegan` in /household/settings.
  2. Visit /recipes — confirm only vegan recipes show.
  3. Add a family member with preference `eggitarian` — confirm /recipes
     now shows vegan + vegetarian + eggitarian.
  4. Add a maid with preference `non_vegetarian` — confirm the recipes
     pool is **unchanged** (maid prefs ignored).
  5. Edit a household custom recipe via the recipe form, set diet to
     `vegan` — confirm it appears in a vegan household's library.

## Risks / open questions

- **Oyster sauce / belacan classification.** I treated default oyster
  sauce and sambal belacan as non-veg. There are vegetarian versions of
  both; if your household uses them, you can re-classify those recipes
  via the form.
- **Honey in Fresh Fruit Bowl pushed it from vegan → vegetarian.** Some
  vegan diets accept honey, most don't. Conservative choice; easy to
  flip via the form.
- **All household-owned recipes default to non_vegetarian.** If your
  household has many custom veg recipes today, they show up in a
  non-veg household correctly but a veg household won't see them until
  you reclassify. Trade-off: safest backfill vs friction.
- **Filter at `effective_recipes` is system-wide.** A vegan owner who
  *wants* to browse a non-veg recipe (e.g., to cook for a guest) can't
  via the library — they'd have to temporarily change their preference.
  Acceptable trade-off for v1; could add a "show all" toggle later.
