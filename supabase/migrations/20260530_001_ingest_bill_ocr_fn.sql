-- Slice 3 — Atomic OCR ingest: insert line items, fuzzy-match against unbought
-- shopping_list_items, mark matches bought, and finalize the bill row.
--
-- Called only by the webhook handler via the service-role client. The function
-- is security definer so the access rules are explicit; EXECUTE is revoked from
-- public and granted only to postgres + service_role.

create or replace function public.ingest_bill_ocr(
  p_bill_id uuid,
  p_payload jsonb
) returns public.bills
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_bill         public.bills;
    v_item         jsonb;
    v_position     int := 0;
    v_norm         text;
    v_match_id     uuid;
    v_match_count  int;
    v_line_item_id uuid;
    v_bill_date    date;
    v_uploader     uuid;
  begin
    -- Idempotency: if the bill is already 'processed', return as-is.
    select * into v_bill from public.bills where id = p_bill_id for update;
    if v_bill is null then
      raise exception 'bill % not found', p_bill_id using errcode = 'P0002';
    end if;
    if v_bill.status = 'processed' then
      return v_bill;
    end if;

    v_uploader  := v_bill.uploaded_by_profile_id;

    -- 1. Update the bill header.
    v_bill_date := nullif(p_payload->>'bill_date', '')::date;

    update public.bills
      set status        = 'processed',
          processed_at  = now(),
          store_name    = nullif(p_payload->>'store_name', ''),
          bill_date     = v_bill_date,
          total_amount  = (p_payload->>'total_amount')::numeric
      where id = p_bill_id
      returning * into v_bill;

    -- 2. Insert line items + fuzzy-match.
    for v_item in
      select * from jsonb_array_elements(coalesce(p_payload->'line_items', '[]'::jsonb))
    loop
      v_position := v_position + 1;

      insert into public.bill_line_items
        (bill_id, position, item_name, quantity, unit, unit_price, line_total)
      values (
        p_bill_id,
        v_position,
        v_item->>'item_name',
        nullif(v_item->>'quantity', '')::numeric,
        nullif(v_item->>'unit', ''),
        nullif(v_item->>'unit_price', '')::numeric,
        nullif(v_item->>'line_total', '')::numeric
      )
      returning id into v_line_item_id;

      v_norm := lower(trim(v_item->>'item_name'));

      -- Bi-directional substring match against unbought shopping items.
      select count(*), min(id) into v_match_count, v_match_id
      from public.shopping_list_items
      where household_id = v_bill.household_id
        and bought_at is null
        and (
          lower(trim(item_name)) like '%' || v_norm || '%'
          or
          v_norm like '%' || lower(trim(item_name)) || '%'
        );

      if v_match_count = 1 then
        update public.shopping_list_items
          set bought_at = coalesce(v_bill_date::timestamptz, now()),
              bought_by_profile_id = v_uploader
          where id = v_match_id;

        update public.bill_line_items
          set matched_shopping_item_id = v_match_id
          where id = v_line_item_id;
      end if;
    end loop;

    return v_bill;
  end;
  $$;

revoke execute on function public.ingest_bill_ocr(uuid, jsonb) from public;
grant  execute on function public.ingest_bill_ocr(uuid, jsonb) to postgres;
grant  execute on function public.ingest_bill_ocr(uuid, jsonb) to service_role;
