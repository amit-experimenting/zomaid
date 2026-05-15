# Shopping: ingredient aliases (processed → shoppable)

Date: 2026-05-16

## Problem

When the user taps "+ Auto-add 7d" on the shopping page, the SQL function
[`shopping_auto_add_from_plans`](../../supabase/migrations/20260527_001_shopping_auto_add_fn.sql)
copies recipe ingredient names verbatim onto the shopping list. Some recipe
ingredients are named after their *prepared* form ("Boiled potato", "Cooked
rice", "Roasted peanuts"), so the shopping list ends up with items the user
can't actually buy at a store — they need to buy the raw form ("Potato",
"Rice", "Peanuts").

The fix needs to:

1. Map processed names → shoppable names.
2. Apply the mapping only when ingredients are auto-added from plans, never
   when the user types something into `QuickAdd`. (If the user types "boiled
   potato" on purpose, that's what they get.)
3. Aggregate correctly: "Boiled potato 2 pcs" from one recipe and "Potato 1
   pc" from another should collapse into a single "Potato 3 pc" row.

## Scope

In scope:

- New table `public.ingredient_aliases` (global, no `household_id`).
- Update `shopping_auto_add_from_plans` to apply the alias before grouping.
- Seed the initial mappings derived from a review of every ingredient name
  currently in the starter-pack recipes.

Out of scope (deferred):

- Per-household alias overrides.
- Any admin UI for editing aliases at runtime — new mappings ship as
  migrations.
- Regex-based prefix stripping ("chopped X" → "X" without an explicit row).
  Aliases are explicit pairs only.
- Splitting one alias into multiple shoppables (e.g., "ginger-garlic paste"
  → ginger + garlic). One-to-one only.
- Unit conversion. Quantities pass through unchanged; "200g boiled potato"
  becomes "200g potato".
- Mapping pre-made shoppable products (`coconut milk`, `tomato puree`, `mint
  chutney`, `ginger-garlic paste`, `chicken broth`, `dosa batter`, `chili
  paste`, `laksa paste`, etc.) — you buy these at a store, so they belong on
  the shopping list as-is.

## Changes

### New table: `public.ingredient_aliases`

```sql
create table public.ingredient_aliases (
  processed_name text primary key
    check (length(processed_name) between 1 and 120),
  shoppable_name text not null
    check (length(shoppable_name) between 1 and 120),
  created_at     timestamptz not null default now()
);

alter table public.ingredient_aliases enable row level security;

-- Anyone authenticated can read. No INSERT/UPDATE/DELETE policy → only
-- migrations (running as service_role / postgres) can write.
create policy ingredient_aliases_read_authenticated
  on public.ingredient_aliases for select
  to authenticated
  using (true);
```

**Conventions:**

- `processed_name` is stored **lowercased** to match how
  `shopping_auto_add_from_plans` already keys ingredients (`lower(item_name)`).
  The check constraint enforces length but not casing — the migration is
  responsible for inserting lowercased values.
- `shoppable_name` is stored in the casing it should appear on the shopping
  list (the existing function takes `min(ri.item_name)` as the display name,
  so we control casing here).

### Initial seed (same migration)

Confirmed in the prior conversation turn. Each row maps a current starter-pack
recipe ingredient to its shoppable equivalent:

| processed_name      | shoppable_name  |
|---------------------|-----------------|
| boiled potato       | potato          |
| boiled chickpeas    | chickpeas       |
| cooked rice         | rice            |
| roasted peanuts     | peanuts         |
| minced chicken      | chicken thighs  |
| minced pork         | pork shoulder   |
| grated coconut      | coconut         |

Notes:

- `chickpeas`, `peanuts`, `rice` already appear elsewhere in
  `recipe_ingredients`, so the aliased rows will aggregate with the raw form
  when both appear in the same week.
- `chicken thighs` and `pork shoulder` are the existing raw forms in the
  starter pack; minced versions become those.
- `coconut` is not a raw form currently in the starter pack; aliasing
  introduces it as the shopping-list display name.

### Update `shopping_auto_add_from_plans()`

The current function builds `candidates` by grouping on `lower(ri.item_name)`
+ `ri.unit`. New version inserts a CTE that resolves the alias first, then
the existing aggregation runs on the resolved names so duplicates collapse
correctly.

```sql
return query
with resolved as (
  select
    coalesce(ia.shoppable_name, ri.item_name) as item_name,
    ri.quantity,
    ri.unit
  from public.meal_plans mp
  join public.recipe_ingredients ri on ri.recipe_id = mp.recipe_id
  left join public.ingredient_aliases ia
    on ia.processed_name = lower(ri.item_name)
  where mp.household_id = v_household
    and mp.plan_date between current_date and current_date + 6
    and mp.recipe_id is not null
),
candidates as (
  select
    lower(r.item_name)                                      as key_name,
    r.unit                                                  as unit,
    min(r.item_name)                                        as display_name,
    bool_or(r.quantity is null)                             as has_null_qty,
    sum(r.quantity) filter (where r.quantity is not null)   as qty_sum
  from resolved r
  group by lower(r.item_name), r.unit
),
to_insert as (
  select c.*
  from candidates c
  where not exists (
    select 1 from public.shopping_list_items s
    where s.household_id = v_household
      and s.bought_at is null
      and lower(s.item_name) = c.key_name
      and coalesce(s.unit, '') = coalesce(c.unit, '')
  )
)
insert into public.shopping_list_items
  (household_id, item_name, quantity, unit, created_by_profile_id, bought_at)
select
  v_household,
  t.display_name,
  case when t.has_null_qty then null else t.qty_sum end,
  t.unit,
  v_profile,
  null
from to_insert t
returning *;
```

The function signature, security model (`security invoker`), and
`search_path` are unchanged. Only the inner query changes.

### Manual `addShoppingItem` path

**No change.** The alias lookup lives entirely inside the SQL function. A
user typing "boiled potato" into `QuickAdd` still gets a "boiled potato" row.

### Database types

[src/lib/db/types.ts](../../src/lib/db/types.ts) is hand-maintained (or
generated and committed). After the migration runs we add the new table to
that file:

```ts
ingredient_aliases: {
  Row:    { processed_name: string; shoppable_name: string; created_at: string };
  Insert: { processed_name: string; shoppable_name: string; created_at?: string };
  Update: { processed_name?: string; shoppable_name?: string; created_at?: string };
  Relationships: [];
};
```

No application code reads or writes this table directly in v1; the type entry
is just to keep `Database["public"]["Tables"]` honest.

## Data flow

```
Tap "+ Auto-add 7d"
        │
        ▼
shopping_auto_add_from_plans()
   1. read this week's meal plans
   2. read recipe_ingredients
   3. left-join ingredient_aliases     ◄── new
   4. group by mapped name + unit, sum
   5. dedupe vs current shopping list
   6. insert
```

`QuickAdd` → `addShoppingItem` is untouched.

## Validation

- DB: the new table has length checks on both columns. The migration inserts
  only lowercased `processed_name` values.
- DB: `processed_name` is `PRIMARY KEY`, so the seed is idempotent — the
  migration uses `on conflict (processed_name) do nothing` (or `do update set
  shoppable_name = excluded.shoppable_name` so re-running picks up fixes).
- Function: the existing aggregation semantics are preserved — same `null`
  handling, same dedupe-by-unit logic — only the source names are remapped.

## Testing

- `pnpm test`: existing suite must stay green. No tests cover
  `shopping_auto_add_from_plans` today, so no new failures expected.
- Manual browser check (per AGENTS.md):
  1. Plan a recipe containing "Boiled potato" (e.g., the Chaat recipe at line
     733 of [the starter-pack migration](../../supabase/migrations/20260606_001_recipes_starter_pack_data_fill.sql))
     for a date in the next 7 days.
  2. Tap "+ Auto-add 7d" on `/shopping`.
  3. Confirm the new row is named "potato", not "boiled potato".
  4. Type "boiled potato" into QuickAdd → it's accepted verbatim (no
     rewrite).
- Optional SQL spot-check after migration apply:
  ```sql
  select processed_name, shoppable_name from public.ingredient_aliases
   order by processed_name;
  ```

## Risks / open questions

- **Multiple aliases pointing to the same shoppable but different units.** If
  a recipe lists `boiled potato (2 piece)` and another lists `potato (300 g)`,
  they don't aggregate — the grouping is `(name, unit)`. The shopping list
  gets two "Potato" rows, one in pieces and one in grams. That's the
  behavior today and we don't change it; unit conversion is explicitly out
  of scope.
- **Future entries.** Adding a new alias is a one-line migration. If the
  pattern gets noisy we can later switch to a regex-based prefix rule, but
  YAGNI for now.
- **Alias coverage drift.** If a new starter recipe uses "Steamed broccoli"
  and we forget to add an alias, the user gets "Steamed broccoli" on
  shopping. Mitigation: when this happens, add a row via migration. We'll
  notice in normal use.
