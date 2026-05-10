-- redeem_invite(token) — only path to bypass RLS for invite consumption.
-- SECURITY DEFINER + locked search_path. Caller must be authenticated with
-- a profiles row (lazy-upserted by app helper before calling).

create or replace function public.redeem_invite(p_token text)
  returns public.household_memberships
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $$
declare
  v_caller_clerk text := auth.jwt() ->> 'sub';
  v_profile      public.profiles%rowtype;
  v_invite       public.invites%rowtype;
  v_membership   public.household_memberships%rowtype;
begin
  if v_caller_clerk is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where clerk_user_id = v_caller_clerk;
  if not found then
    raise exception 'profile missing — sign in again to provision' using errcode = 'P0001';
  end if;

  select * into v_invite from public.invites where token = p_token for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v_invite.consumed_at is not null then
    raise exception 'invite already consumed' using errcode = 'P0003';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'P0004';
  end if;

  -- Capacity invariants
  if v_invite.intended_role = 'maid' and exists (
    select 1 from public.household_memberships
    where household_id = v_invite.household_id
      and role = 'maid' and status = 'active'
  ) then
    raise exception 'household already has an active maid' using errcode = 'P0005';
  end if;

  if v_invite.intended_role = 'owner' and exists (
    select 1 from public.household_memberships
    where household_id = v_invite.household_id
      and role = 'owner' and status = 'active'
  ) then
    raise exception 'household already has an active owner' using errcode = 'P0006';
  end if;

  insert into public.household_memberships
    (household_id, profile_id, role, privilege, status)
  values
    (v_invite.household_id,
     v_profile.id,
     v_invite.intended_role,
     coalesce(v_invite.intended_privilege, 'full'),
     'active')
  returning * into v_membership;

  update public.invites
     set consumed_at = now(),
         consumed_by_profile_id = v_profile.id
   where id = v_invite.id;

  return v_membership;
end;
$$;

grant execute on function public.redeem_invite(text) to authenticated;
