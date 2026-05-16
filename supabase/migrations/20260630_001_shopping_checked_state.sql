-- Shopping list lifecycle redesign:
--
--   pending  : checked_at IS NULL AND bought_at IS NULL   (renders on main list)
--   checked  : checked_at IS NOT NULL AND bought_at IS NULL (main list + strikethrough)
--   bought   : bought_at IS NOT NULL                       (moves to "Show bought" history)
--
-- A user tap on the checkbox now sets checked_at only. Items move to "bought"
-- via either: (a) the daily end-of-day cron sweep, or (b) a matching bill
-- upload. Either path commits to inventory via shopping_commit_to_inventory.

alter table public.shopping_list_items
  add column checked_at timestamptz;

-- Useful for the sweep: find rows that are checked but not yet committed.
create index if not exists sli_household_checked_idx
  on public.shopping_list_items (household_id, checked_at)
  where checked_at is not null and bought_at is null;

-- ── Backfill: apply ingredient_aliases to existing rows ───────────────────
-- Some "boiled potato" rows landed before 20260622 introduced the alias.
-- Safely rename them to the shoppable_name. If a row with the target name +
-- unit + bought-status already exists, drop the alias row to avoid
-- accidental aggregation conflicts.

with conflicts as (
  select s.id
    from public.shopping_list_items s
    join public.ingredient_aliases ia on lower(s.item_name) = ia.processed_name
   where exists (
     select 1 from public.shopping_list_items t
      where t.id <> s.id
        and t.household_id = s.household_id
        and lower(t.item_name) = ia.shoppable_name
        and coalesce(t.unit, '') = coalesce(s.unit, '')
        and (t.bought_at is null) = (s.bought_at is null)
   )
)
delete from public.shopping_list_items where id in (select id from conflicts);

update public.shopping_list_items s
   set item_name = ia.shoppable_name
  from public.ingredient_aliases ia
 where lower(s.item_name) = ia.processed_name;

-- ── shopping_auto_add_from_plans: never insert NULL quantity ─────────────
-- A recipe ingredient without a quantity now contributes 1 to the sum. The
-- shopping row always carries a usable number; users can edit if needed.

create or replace function public.shopping_auto_add_from_plans()
  returns setof public.shopping_list_items
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid := public.current_household_id_for_caller();
    v_profile   uuid := public.current_profile_id();
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;

    return query
    with resolved as (
      select
        coalesce(ia.shoppable_name, ri.item_name) as item_name,
        coalesce(ri.quantity, 1)                  as quantity,
        ri.unit                                   as unit
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
        lower(r.item_name)   as key_name,
        r.unit               as unit,
        min(r.item_name)     as display_name,
        sum(r.quantity)      as qty_sum
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
      t.qty_sum,
      t.unit,
      v_profile,
      null
    from to_insert t
    returning *;
  end;
  $$;

-- ── shopping_commit_to_inventory ─────────────────────────────────────────
-- Idempotent merge: if an inventory row exists for (household, lower(name),
-- unit) — increment its quantity. Otherwise insert a new row. Then mark the
-- shopping row as bought. Returns the inventory_items.id (existing or new).
--
-- Reused by both the sweep cron and the bill-match path. security definer
-- so the cron worker (no caller JWT) can run it; the function does its own
-- household scoping by reading the shopping row's household_id.

create or replace function public.shopping_commit_to_inventory(
  p_shopping_id uuid,
  p_actor       uuid
) returns uuid
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_shop public.shopping_list_items;
    v_inv  public.inventory_items;
    v_inv_id uuid;
    v_qty numeric;
  begin
    select * into v_shop from public.shopping_list_items where id = p_shopping_id;
    if not found then
      return null;
    end if;
    if v_shop.bought_at is not null then
      -- Already committed; no-op. Returning null is fine — caller doesn't
      -- need the id for already-processed rows.
      return null;
    end if;

    v_qty := coalesce(v_shop.quantity, 1);
    v_inv := public.inventory_lookup(v_shop.household_id, v_shop.item_name, v_shop.unit);

    if v_inv.id is null then
      insert into public.inventory_items
        (household_id, item_name, quantity, unit, created_by_profile_id)
      values
        (v_shop.household_id, v_shop.item_name, v_qty, v_shop.unit, p_actor)
      returning id into v_inv_id;
    else
      update public.inventory_items
         set quantity = quantity + v_qty
       where id = v_inv.id;
      v_inv_id := v_inv.id;
    end if;

    update public.shopping_list_items
       set bought_at = now(),
           bought_by_profile_id = coalesce(bought_by_profile_id, p_actor),
           checked_at = coalesce(checked_at, now())
     where id = p_shopping_id;

    return v_inv_id;
  end;
  $$;

revoke execute on function public.shopping_commit_to_inventory(uuid, uuid) from public;
grant  execute on function public.shopping_commit_to_inventory(uuid, uuid) to authenticated, postgres;

-- ── shopping_sweep_checked: end-of-day worker ────────────────────────────
-- Picks every household's checked-not-bought rows and commits them. Caller
-- is the cron route (service-role); each row's household_id flows through
-- shopping_commit_to_inventory so cross-household leakage is impossible.
-- Returns the number of rows committed.

create or replace function public.shopping_sweep_checked()
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_count int := 0;
    v_row record;
  begin
    for v_row in
      select id, created_by_profile_id
        from public.shopping_list_items
       where checked_at is not null and bought_at is null
    loop
      perform public.shopping_commit_to_inventory(v_row.id, v_row.created_by_profile_id);
      v_count := v_count + 1;
    end loop;
    return v_count;
  end;
  $$;

revoke execute on function public.shopping_sweep_checked() from public;
grant  execute on function public.shopping_sweep_checked() to postgres;
