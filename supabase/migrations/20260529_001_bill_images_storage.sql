-- Slice 3 — Storage bucket for bill images. Mirrors recipe-images-household RLS.

insert into storage.buckets (id, name, public)
  values ('bill-images', 'bill-images', false)
  on conflict (id) do nothing;

create policy storage_bills_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'bill-images'
    and public.has_active_membership((split_part(name, '/', 1))::uuid)
  );

create policy storage_bills_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'bill-images'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );

create policy storage_bills_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'bill-images'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'bill-images'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );

create policy storage_bills_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'bill-images'
    and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  );
