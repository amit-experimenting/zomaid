-- Allow service-role and unauthenticated paths (boot tasks, direct postgres
-- connections in tests) to update is_admin. The trigger now only blocks the
-- elevation when an authenticated end-user (auth.jwt() ->> 'sub' is not null)
-- attempts to set is_admin without already being admin.
--
-- See plan doc § "morning queue" for context. Original trigger from
-- 20260510_001_profiles.sql blocked unconditionally, breaking syncAdminFlags()
-- in production.

create or replace function public.profiles_block_protected_columns()
  returns trigger language plpgsql as $$
  begin
    if new.id           is distinct from old.id           then raise exception 'id is immutable'; end if;
    if new.clerk_user_id is distinct from old.clerk_user_id then raise exception 'clerk_user_id is immutable'; end if;
    if new.email        is distinct from old.email        then new.email := old.email; end if;
    -- Only enforce is_admin protection for authenticated end-users.
    -- Service-role / unauthenticated paths (boot tasks, test pg client) skip this check.
    if new.is_admin is distinct from old.is_admin
       and (auth.jwt() ->> 'sub') is not null
       and not public.current_is_admin()
    then
      new.is_admin := old.is_admin;
    end if;
    new.updated_at := now();
    return new;
  end;
  $$;
