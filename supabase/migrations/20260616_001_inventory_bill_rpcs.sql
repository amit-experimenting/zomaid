-- Slice 2 inventory — bill_line_item → inventory ingest RPCs.

-- Confirm a single bill_line_item into inventory.
create or replace function public.inventory_bill_ingest(
  p_line_item_id   uuid,
  p_inventory_id   uuid,   -- nullable: NULL = create new
  p_quantity       numeric,
  p_unit           text,
  p_new_item_name  text    -- required when p_inventory_id IS NULL
) returns public.inventory_items
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_household uuid;
    v_inv       public.inventory_items;
    v_delta     numeric;
    v_profile   uuid := public.current_profile_id();
  begin
    select b.household_id into v_household
      from public.bill_line_items bli
      join public.bills b on b.id = bli.bill_id
      where bli.id = p_line_item_id;
    if v_household is null then
      raise exception 'bill line item not found' using errcode = 'P0001';
    end if;
    if not public.is_active_owner_or_maid(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;

    if p_inventory_id is null then
      if p_new_item_name is null then
        raise exception 'p_new_item_name required when p_inventory_id is null' using errcode = 'P0001';
      end if;
      insert into public.inventory_items
        (household_id, item_name, quantity, unit, created_by_profile_id)
        values
        (v_household, p_new_item_name, p_quantity, p_unit, v_profile)
        on conflict (household_id, lower(item_name), unit)
          do update set quantity = inventory_items.quantity + excluded.quantity
        returning * into v_inv;
      v_delta := p_quantity;
    else
      select * into v_inv from public.inventory_items where id = p_inventory_id and household_id = v_household for update;
      if v_inv.id is null then
        raise exception 'inventory item not found' using errcode = 'P0001';
      end if;

      v_delta := p_quantity;
      if lower(v_inv.unit) <> lower(p_unit) then
        v_delta := public.inventory_convert(v_household, v_inv.item_name, p_unit, v_inv.unit, p_quantity);
        if v_delta is null then
          raise exception 'INV_NO_CONVERSION' using errcode = 'P0001';
        end if;
      end if;

      update public.inventory_items
        set quantity = quantity + v_delta
        where id = v_inv.id
        returning * into v_inv;
    end if;

    insert into public.inventory_transactions
      (household_id, inventory_item_id, delta, unit, reason, bill_line_item_id, actor_profile_id)
      values
      (v_household, v_inv.id, v_delta, v_inv.unit, 'bill_ingest', p_line_item_id, v_profile);

    update public.bill_line_items
      set inventory_ingested_at = now(),
          matched_inventory_item_id = v_inv.id,
          inventory_ingestion_skipped = false
      where id = p_line_item_id;

    return v_inv;
  end;
  $$;

grant execute on function public.inventory_bill_ingest(uuid, uuid, numeric, text, text) to authenticated;

-- Mark a bill line as not-for-inventory.
create or replace function public.inventory_bill_skip(p_line_item_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_household uuid;
  begin
    select b.household_id into v_household
      from public.bill_line_items bli
      join public.bills b on b.id = bli.bill_id
      where bli.id = p_line_item_id;
    if v_household is null then
      raise exception 'bill line item not found' using errcode = 'P0001';
    end if;
    if not public.is_active_owner_or_maid(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;

    update public.bill_line_items
      set inventory_ingestion_skipped = true
      where id = p_line_item_id;
  end;
  $$;

grant execute on function public.inventory_bill_skip(uuid) to authenticated;

-- Reverse the skip flag.
create or replace function public.inventory_bill_unskip(p_line_item_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_household uuid;
  begin
    select b.household_id into v_household
      from public.bill_line_items bli
      join public.bills b on b.id = bli.bill_id
      where bli.id = p_line_item_id;
    if v_household is null then
      raise exception 'bill line item not found' using errcode = 'P0001';
    end if;
    if not public.is_active_owner_or_maid(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;

    update public.bill_line_items
      set inventory_ingestion_skipped = false
      where id = p_line_item_id;
  end;
  $$;

grant execute on function public.inventory_bill_unskip(uuid) to authenticated;
