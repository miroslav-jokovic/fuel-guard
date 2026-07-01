-- FuelGuard — 0005 storage (receipt photos)
-- docs/01-ARCHITECTURE.md §6, docs/02 §10.9. Private bucket; objects keyed org_id/vehicle_id/{uuid}.
-- Tenant isolation mirrors the DB: a user may only touch objects under their own org_id prefix.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_read on storage.objects
  for select
  using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);

create policy receipts_insert on storage.objects
  for insert
  with check (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);

create policy receipts_delete on storage.objects
  for delete
  using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);
