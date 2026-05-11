-- Slice 2a — Recipe image storage buckets + RLS.

insert into storage.buckets (id, name, public)
  values ('recipe-images-public', 'recipe-images-public', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('recipe-images-household', 'recipe-images-household', false)
  on conflict (id) do nothing;

-- Public bucket: anyone may read; only service_role writes.
drop policy if exists storage_recipe_public_read on storage.objects;
create policy storage_recipe_public_read
  on storage.objects for select to public
  using (bucket_id = 'recipe-images-public');

drop policy if exists storage_recipe_public_write on storage.objects;
create policy storage_recipe_public_write
  on storage.objects for insert to public
  with check (
    bucket_id = 'recipe-images-public'
    and auth.role() = 'service_role'
  );

drop policy if exists storage_recipe_public_modify on storage.objects;
create policy storage_recipe_public_modify
  on storage.objects for update to public
  using (bucket_id = 'recipe-images-public' and auth.role() = 'service_role')
  with check (bucket_id = 'recipe-images-public' and auth.role() = 'service_role');

drop policy if exists storage_recipe_public_delete on storage.objects;
create policy storage_recipe_public_delete
  on storage.objects for delete to public
  using (bucket_id = 'recipe-images-public' and auth.role() = 'service_role');

-- Household bucket: path is "<household_id>/<recipe_id>.<ext>".
-- Read = any active member; Write = active owner or maid.
drop policy if exists storage_recipe_hh_read on storage.objects;
create policy storage_recipe_hh_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'recipe-images-household'
    and public.has_active_membership((split_part(name, '/', 1))::uuid)
  );

drop policy if exists storage_recipe_hh_insert on storage.objects;
create policy storage_recipe_hh_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recipe-images-household'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );

drop policy if exists storage_recipe_hh_update on storage.objects;
create policy storage_recipe_hh_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'recipe-images-household'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'recipe-images-household'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );

drop policy if exists storage_recipe_hh_delete on storage.objects;
create policy storage_recipe_hh_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'recipe-images-household'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );
