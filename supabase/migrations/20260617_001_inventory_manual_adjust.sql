-- Slice 2 inventory — owner/maid-only adjust with clamp + ledger.

create or replace function public.inventory_manual_adjust(
  p_item_id  uuid,
  p_delta    numeric,
  p_notes    text
) returns public.inventory_items
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_household   uuid;
    v_inv         public.inventory_items;
    v_qty_before  numeric;
    v_new_qty     numeric;
    v_profile     uuid := public.current_profile_id();
  begin
    select * into v_inv from public.inventory_items where id = p_item_id for update;
    if v_inv.id is null then
      raise exception 'inventory item not found' using errcode = 'P0001';
    end if;
    v_household := v_inv.household_id;
    if not public.is_active_owner_or_maid(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;

    v_qty_before := v_inv.quantity;
    v_new_qty := greatest(v_qty_before + p_delta, 0);

    update public.inventory_items
      set quantity = v_new_qty
      where id = p_item_id
      returning * into v_inv;

    insert into public.inventory_transactions
      (household_id, inventory_item_id, delta, unit, reason, actor_profile_id, notes)
      values
      (v_household, v_inv.id, v_new_qty - v_qty_before, v_inv.unit, 'manual_adjust', v_profile, p_notes);

    return v_inv;
  end;
  $$;

grant execute on function public.inventory_manual_adjust(uuid, numeric, text) to authenticated;
