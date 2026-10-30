-- 0531 — a truck's and a trailer's own QR code (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §3 DE3, D-DE5).
--
-- ── WHY A TABLE OF ITS OWN, NOT A COLUMN ON `vehicles` / `trailers` ────────────────────────────
-- `vehicles` and `trailers` are written by the Samsara and McLeod syncs, and `vehicles.status` is
-- already restated seventeen times across the code (memory `vehicles-status-is-restated-17-times`).
-- A tag is the shop's fact about a unit, not the fleet feed's, so it gets the shop's table:
-- maintenance-owned, written and read by one API file (`maintenance/inventory/unitTags.ts`, DE4). A
-- new table is also exempt from the migration-ordering split — its first reader can ride the next
-- merge without a column landing under old code.
--
-- ── ONE TAG PER UNIT, FOR GOOD ─────────────────────────────────────────────────────────────────
-- Owner 2026-10-30 (Q-DE2 (a)): the label goes INSIDE — a truck's on the driver's door jamb, a
-- trailer's on the inside of its front wall — printed on the 2"×2" direct-thermal roll we have.
-- Direct thermal fades, so labels WILL be reprinted. A reprint prints the SAME code: the unit is one
-- physical thing, and a code that changed would strand every label still stuck to it. So a unit has
-- exactly one row, its code is issued once, and no column of the row ever changes (`IV022`, the
-- same SQLSTATE `inventory_assets.tag_code` and `part_stock.tag_code` raise for the same reason).
-- There is no revoke: a sold truck keeps its row, and a scan of its label still says which truck it
-- was (`vehicles` are never deleted, hence `on delete restrict`).
--
-- ── SAME ORG, BY TRIGGER ───────────────────────────────────────────────────────────────────────
-- `vehicles` and `trailers` carry no `(id, org_id)` key (0332 notes it), and adding one to a
-- sync-written table is not this step's business, so the unit's org is checked the way
-- `inventory_assets` checks its holder: `inventory_holder_is_ours` (0524), `IV012`. Active-ness is
-- not asked (`p_active false` means nothing for a unit anyway): a label may be printed for any unit
-- of ours.
--
-- RLS on, no client policy: the API reads and writes with the service role and org-filters itself.
-- Measured 2026-10-30: production 211 active trucks; 0 rows to backfill — codes are issued when a
-- label is first printed (DE4), exactly as assets' are (I10).

create table if not exists unit_tags (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete restrict,
  trailer_id  uuid references trailers(id) on delete restrict,
  -- The six Crockford characters `formatTag('VEH' | 'TRL', …)` prints (tagContract.ts).
  tag_code    text not null check (tag_code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  issued_at   timestamptz not null default now(),
  issued_by   uuid,
  constraint unit_tags_one_unit check (num_nonnulls(vehicle_id, trailer_id) = 1)
);

alter table unit_tags enable row level security;

-- A code answers one unit per org; the resolver's lookup is this index.
create unique index if not exists idx_unit_tags_code on unit_tags (org_id, tag_code);
-- One tag per unit. The loser of two concurrent first prints gets 23505 and reads the winner's code.
create unique index if not exists idx_unit_tags_vehicle on unit_tags (vehicle_id) where vehicle_id is not null;
create unique index if not exists idx_unit_tags_trailer on unit_tags (trailer_id) where trailer_id is not null;

create or replace function guard_unit_tag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'unit tag % is issued once and never changed: reprint the same code', old.tag_code
      using errcode = 'IV022';
  end if;
  if not public.inventory_holder_is_ours(new.org_id, null, new.vehicle_id, new.trailer_id, null, false) then
    raise exception 'unit % is not this org''s', coalesce(new.vehicle_id, new.trailer_id)
      using errcode = 'IV012';
  end if;
  return new;
end;
$$;

revoke all on function guard_unit_tag() from public, anon, authenticated;

drop trigger if exists trg_unit_tags_guard on unit_tags;
create trigger trg_unit_tags_guard
  before insert or update on unit_tags
  for each row execute function guard_unit_tag();

comment on table unit_tags is
  'A truck''s or trailer''s QR code (VEH / TRL, D-DE5): one row per unit, issued at its first label print, never changed (IV022). Maintenance-owned; not a column on vehicles/trailers, which the syncs write.';
