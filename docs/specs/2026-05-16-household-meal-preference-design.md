# Household-level meal preference (overrides per-member)

> **Superseded as the living architecture doc for the dashboard area by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

Date: 2026-05-16

## Problem

The per-member diet preference shipped on 2026-05-16
([`docs/specs/2026-05-16-diet-preferences-design.md`](2026-05-16-diet-preferences-design.md))
filters recipes by the **strictest non-maid member** preference. That works
for households where every member has a personal preference, but leaves no
way for an owner to say "this is a vegetarian household, period" — even if
no individual member has marked themselves vegetarian, or if members hold
mixed preferences that don't aggregate to the household's intent.

The owner wants:

- A household-level meal preference distinct from any one member. When set,
  it is the *only* thing that drives plan / library / picker / auto-fill
  visibility. Per-member preferences are recorded but ignored for planning.
- When the household-level preference is left blank, behavior reverts to
  today's strictest-non-maid-member aggregation.
- Owner and maid can edit it.
- The dashboard shows what the effective preference is, and where it comes
  from (household-level vs members).
- A safety prompt before applying a household-level preference that is
  strictly stricter than what members currently imply, naming the members
  whose plan would shrink.

## Scope

In scope:

- New column `households.diet_preference public.diet`, nullable
  (`null` = "no household-level override; use member preferences as today").
  Reuses the existing `public.diet` enum.
- Rename SQL helper `household_strictest_diet(uuid)` →
  `household_effective_diet(uuid)`. Body short-circuits on the household
  column; falls back to the existing strictest-non-maid-member aggregation;
  finally defaults to `non_vegetarian`.
- `effective_recipes(p_household)` body unchanged except the helper call name.
- New server action `updateHouseholdDiet` in
  [src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts).
  Owner and maid only. Empty string clears the override.
- Settings page UI:
  - New **Meal preference** card above the Members card. Editable for owner
    and maid; read-only display for family members.
  - When `households.diet_preference !== null`, each per-member row in the
    Members card shows a small note `household preference active — this is
    ignored for planning`. Selector stays enabled.
  - Stricter-than-implied confirmation (`window.confirm`) wrapping the form
    submit. See "Stricter-than-implied confirmation" below.
- Dashboard chip: one compact line at the top of
  [src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) showing the
  effective preference and its source. Hidden when no filter is active.
  Tappable, links to `/household/settings`.
- Type updates in [src/lib/db/types.ts](../../src/lib/db/types.ts):
  `households` Row/Insert gains `diet_preference`; `Functions` map rename
  `household_strictest_diet` → `household_effective_diet`.

Out of scope (deferred):

- A per-recipe escape hatch ("show me this anyway" against the household
  filter — e.g., a vegan household browsing a non-veg recipe for a guest).
- Migrating the household-level value at deploy time from the existing
  strictest-member result. Owners should opt in explicitly.
- Auto-classifying ingredients when a new custom recipe is added.
- Promoting the confirmation prompt from `window.confirm` to a styled Dialog.

## Interaction model

| household column | members | effective diet (used by `effective_recipes`) |
|---|---|---|
| set to `X` | any | `X` |
| `null` | at least one non-maid member has a pref | strictest non-maid member pref |
| `null` | no non-maid member has a pref | `non_vegetarian` (no filter) |

Strictness order (unchanged): `vegan > vegetarian > eggitarian > non_vegetarian`.

The household column **overrides**; it does not aggregate with member prefs.
A non-vegetarian member in a `vegetarian` household sees only vegan +
vegetarian recipes in the library, picker, auto-fill, and suggestion engine
— because every consumer routes through `effective_recipes`, which routes
through `household_effective_diet`.

A household with **only a maid** behaves as today: maid prefs are ignored
in the member aggregation, so if the household column is also `null`, the
default `non_vegetarian` applies.

## Changes

### Migration `20260706_001_household_diet_preference.sql`

```sql
alter table public.households
  add column diet_preference public.diet;

-- Replace the old helper with the new override-aware one.
drop function if exists public.household_strictest_diet(uuid);

create or replace function public.household_effective_diet(p_household uuid)
  returns public.diet
  language sql stable security definer
  set search_path = public
  as $$
    select coalesce(
      (select diet_preference from public.households where id = p_household),
      (select case
        when bool_or(hm.diet_preference = 'vegan')      then 'vegan'::public.diet
        when bool_or(hm.diet_preference = 'vegetarian') then 'vegetarian'::public.diet
        when bool_or(hm.diet_preference = 'eggitarian') then 'eggitarian'::public.diet
        else 'non_vegetarian'::public.diet
       end
       from public.household_memberships hm
       where hm.household_id = p_household
         and hm.status = 'active'
         and hm.role <> 'maid'
         and hm.diet_preference is not null),
      'non_vegetarian'::public.diet
    );
  $$;

-- Re-create effective_recipes calling the renamed helper. Body is identical
-- to the 20260624_001 version except for the helper name.
create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    with strictest as (select public.household_effective_diet(p_household) as d)
    select * from (
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

No data backfill: every existing household starts with
`diet_preference = null`, which preserves today's behavior exactly.

### Server action: `updateHouseholdDiet`
([src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts))

```ts
const householdDietSchema = z.object({
  diet: z
    .union([z.literal(""), z.enum(["vegan", "vegetarian", "eggitarian", "non_vegetarian"])])
    .optional(),
});

export async function updateHouseholdDiet(input: unknown) {
  const data = householdDietSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    throw new Error("forbidden");
  }
  const value = data.diet && data.diet.length > 0 ? data.diet : null;
  const svc = createServiceClient();
  const { error } = await svc
    .from("households")
    .update({ diet_preference: value })
    .eq("id", ctx.household.id);
  if (error) throw new Error(error.message);

  revalidatePath("/household/settings");
  revalidatePath("/dashboard");
  revalidatePath("/plan");
  revalidatePath("/recipes");
}
```

Owner / maid only. Empty-string sentinel clears the override.

### Settings page UI
([src/app/household/settings/page.tsx](../../src/app/household/settings/page.tsx))

1. **New Meal preference card**, placed between the Notifications card and
   the Members card.

   ```
   ┌─ Meal preference ─────────────────────────────┐
   │ Sets what shows up in your meal plan and      │
   │ recipes for the whole household.              │
   │                                                │
   │ [ No household preference  ▾ ]  [ Save ]      │
   │                                                │
   │ ⓘ When set, this overrides each member's      │
   │   personal preference for planning.           │
   └────────────────────────────────────────────────┘
   ```

   - Dropdown options: `No household preference` (sentinel → `""`), Vegan,
     Vegetarian, Eggitarian, Non-vegetarian.
   - Default value: `households.diet_preference ?? ""`.
   - Owner and maid see the form; family members see the current value as
     plain text with no Save button.

2. **Members card change**: when `households.diet_preference !== null`,
   each row renders an extra `<p>` beneath the existing role line:
   `household preference active — this is ignored for planning`. Per-member
   diet selector stays enabled (a member may still record their preference
   for their own reference / future use). The existing maid note
   `diet noted but plan ignores it` is untouched.

3. **HouseholdDietForm client component**
   ([src/components/household/household-diet-form.tsx](../../src/components/household/household-diet-form.tsx),
   new).
   - Props: `currentValue: Diet | null`, `members: { displayName, dietPreference }[]`
     (active non-maid members only), `action: (fd: FormData) => Promise<void>`.
   - Computes `memberImplied: Diet` in JS using the same strictness ranking
     as the SQL helper. `null` members are skipped; an empty list yields
     `non_vegetarian`.
   - On submit, if the chosen value is `!== ""` and *strictly stricter*
     than `memberImplied`, intercept with:

     ```
     Setting household preference to {Chosen} will hide recipes that
     {Alice (eggitarian), Bob (non-vegetarian)} currently see. Continue?
     ```

     Up to 3 member names; "and N more" when longer. List only the members
     whose own preference is *less strict* than the chosen value (those are
     the ones who actually lose visibility). If the chosen value is `≤
     memberImplied`, submit without prompting. Clearing the override never
     prompts.
   - Uses native `window.confirm`. Cancel → no submit; OK → submit.

### Dashboard chip
([src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx))

- Fetch the effective diet from the new RPC alongside existing dashboard
  queries:

  ```ts
  const { data: effective } = await svc
    .rpc("household_effective_diet", { p_household: ctx.household.id });
  ```

- Decide what to render using two inputs:
  1. `ctx.household.diet_preference` (already on the loaded household row
     once the type change lands).
  2. `hasMemberPref` — a count query against `household_memberships`:
     `status = 'active' AND role <> 'maid' AND diet_preference IS NOT NULL`,
     limited 1. Runs alongside the RPC.

  Source resolution:
  | condition | rendered |
  |---|---|
  | `ctx.household.diet_preference !== null` | `Meal preference: {Label(effective)} · household` |
  | column is null AND `hasMemberPref` | `Meal preference: {Label(effective)} · members` |
  | column is null AND `!hasMemberPref` | chip hidden (no filter active) |

  Note: in the "members" row, `effective` may equal `non_vegetarian` — that
  is still surfaced because at least one member did record a preference,
  even if the strictest of them is non-veg. The chip's purpose is "show me
  what's filtering my plan and where it came from", not "show me only
  restrictive filters".

- Render as a `<Link>` styled as a compact muted line, placed first inside
  `<div className="px-4 py-6">`:

  ```tsx
  {chip ? (
    <Link
      href="/household/settings"
      className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      Meal preference: {dietLabel(effective)} · {source}
    </Link>
  ) : null}
  ```

  `dietLabel` maps the enum to display strings (`Vegan`, `Vegetarian`,
  `Eggitarian`, `Non-vegetarian`); `source` is the literal word `household`
  or `members`. No icon, no card chrome.

### Database types
([src/lib/db/types.ts](../../src/lib/db/types.ts))

- `households.Row` gains `diet_preference: Diet | null`.
- `households.Insert` gains `diet_preference?: Diet | null`.
- `Functions` map: rename `household_strictest_diet` →
  `household_effective_diet`. Same `Args: { p_household: string }` and
  `Returns: Diet` shape.

## Stricter-than-implied confirmation — semantics

Strictness ranking (matches SQL helper):

```
rank(vegan)          = 3
rank(vegetarian)     = 2
rank(eggitarian)     = 1
rank(non_vegetarian) = 0
```

Let:
- `chosen` = enum value selected in the form (excludes the empty-string
  sentinel — clearing the override never prompts).
- `memberImplied` = `case when any member has 'vegan' then 'vegan' …`
  computed in JS, exactly as the SQL helper computes the strictest-member
  fallback. Members are the active non-maid members already loaded on the
  page. `null` members are skipped. Empty set → `non_vegetarian`.

**Prompt iff** `rank(chosen) > rank(memberImplied)`.

Names listed in the prompt are members where
`rank(member.diet_preference ?? 'non_vegetarian') < rank(chosen)` — i.e.,
the members who would now have recipes hidden.

The server action does **not** re-check the comparison. It is a UX guard,
not an authorization check.

## Validation

- DB: `diet_preference` is a typed enum nullable column, validated at write.
- Migration: pure schema change + helper rewrite + helper rename. No data
  backfill; existing households start at `null` and behave as today.
- Action: zod rejects unknown enum values. Authorization enforces
  owner-or-maid.
- Helper: `security definer` (same pattern as the existing helper) so RLS
  on `household_memberships` doesn't truncate the aggregation when called
  from a caller with limited visibility.
- Client: `HouseholdDietForm` confirmation is pure UX; the server action
  accepts any valid enum value regardless of how it compares to members.

## Testing

- `pnpm test` stays green.
- Local SQL: apply migration in a transaction; assert
  - `households.diet_preference` column exists, nullable, type `public.diet`.
  - `household_strictest_diet` no longer exists.
  - `household_effective_diet(h)` returns:
    - the household column when set (regardless of members),
    - the strictest non-maid member pref when household column is null and
      at least one member has a pref,
    - `non_vegetarian` when household column is null and no member has a pref,
    - `non_vegetarian` when only a maid has a pref (household null).
  - `effective_recipes(h)` filters identically under each case above.
- Manual browser flow:
  1. Owner with no household pref and no member prefs → `/recipes` shows
     all recipes; dashboard chip hidden.
  2. Owner sets one family member to `non_vegetarian` → still all recipes;
     chip shows `Meal preference: Non-vegetarian · members`.
  3. Owner sets one family member to `vegetarian` → vegan + vegetarian
     only; chip shows `Meal preference: Vegetarian · members`.
  4. Owner sets **household pref** to `vegan`. Because chosen
     (`vegan`, rank 3) > memberImplied (`vegetarian`, rank 2), a
     `window.confirm` lists the vegetarian member by name. Confirm.
     `/recipes` and `/plan` now show vegan only. Members card shows the
     override note on every row. Chip shows `… · household`.
  5. Owner lowers household pref to `eggitarian` → no confirmation (less
     strict than current). `/recipes` shows vegan + vegetarian +
     eggitarian. Chip updates to `Eggitarian · household`.
  6. Owner clears household pref → no confirmation. Behavior reverts to
     strictest member (vegetarian). Chip flips back to `… · members`.
  7. Maid (logged in as maid) can set/clear household pref. Family member
     sees the card as read-only text and no Save button.

## Risks / open questions

- **`window.confirm` is ugly.** Acceptable for a low-frequency action; can
  be replaced with the existing Dialog primitive later without changing
  the action or the data model.
- **Dashboard chip surfaces preference origin in plain words** ("household"
  vs "members"). For a non-technical user this may read as jargon. If
  feedback flags it, swap to "set by you" vs "from members".
- **No backfill of `households.diet_preference` from existing strictest
  member.** A vegetarian household that today is vegetarian *only* because
  the owner marked themselves vegetarian will continue to be vegetarian —
  but the dashboard chip will read `… · members`, not `… · household`,
  until the owner explicitly sets the household-level value. This is the
  correct behavior; an automatic backfill would mis-attribute a personal
  preference to the household.
- **Renaming the helper is a breaking change** to anything that calls
  `household_strictest_diet` directly. The only in-tree caller is
  `effective_recipes`, which is rewritten in the same migration; the
  TypeScript `Functions` map is updated in the same change. No external
  consumers exist today.
- **Confirmation logic lives in JS, not SQL.** A motivated user can
  bypass it by submitting the form via curl. Acceptable — this is a UX
  guard, not a permission check.
