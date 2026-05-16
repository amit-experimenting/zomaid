-- Tighten households_sync_maid_mode_on_join trigger guard.
--
-- Before: the trigger flipped maid_mode to 'invited' whenever an active maid
--         membership was inserted, as long as maid_mode was not already
--         'invited'. This silently overrode the owner's explicit 'family_run'
--         choice if a late maid invite was redeemed.
--
-- After:  the trigger only fires when maid_mode is still 'unset' (the initial
--         post-household-creation state). Owners who picked 'family_run' keep
--         that choice; they must explicitly switch off 'family_run' before
--         re-adding a maid.

create or replace function public.households_sync_maid_mode_on_join()
  returns trigger language plpgsql security definer
  set search_path = public
  as $$
  begin
    if new.role = 'maid' and new.status = 'active' then
      update public.households
        set maid_mode = 'invited'
        where id = new.household_id
          and maid_mode = 'unset';
    end if;
    return new;
  end;
  $$;
