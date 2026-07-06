-- 0032: not every trailer is a reefer. Add an explicit is_reefer flag (default FALSE) so the Samsara
-- trailer sync no longer implies every trailer is refrigerated. Only is_reefer trailers drive the reefer
-- tank-capacity checks; the fleet manager marks the real reefers. reefer_tank_capacity_gal is only
-- meaningful when is_reefer = true.
alter table trailers add column if not exists is_reefer boolean not null default false;
create index if not exists idx_trailers_org_reefer on trailers (org_id, is_reefer);
