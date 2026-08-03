-- FuelGuard — 0100 trailers master data (Master Data & Identity, M1 · plan §2.4)
--
-- `trailers` arrived in 0030 as a reefer-fuel bookkeeping row and grew pairing metadata in 0041 and
-- a physical `length_in` in 0058. It has never carried a VIN, a type, a registration expiry or a
-- capacity — so a trailer cannot today be dispatched on its specs or audited on its paperwork.
--
-- ONE NAMING TRAP, called out because it will otherwise be relearned the hard way:
--   length_in  (0058) = the PHYSICAL dimension in INCHES, used by routing/clearance math.
--   length_ft  (here) = the NOMINAL CLASS the office speaks in — 28 / 40 / 48 / 53.
-- They are not conversions of one another and neither should be derived from the other.
--
-- Same `identity_source` provenance flag as drivers/vehicles: defaults to 'samsara' so every synced
-- row keeps today's behavior; flips to 'manual' on admin edit, after which samsaraTrailerSync stops
-- overwriting make/model/year/plate (plan §4).
--
-- Additive + idempotent.

-- ── provenance ────────────────────────────────────────────────────────────────
alter table trailers add column if not exists identity_source text not null default 'samsara';
alter table trailers drop constraint if exists trailers_identity_source_check;
alter table trailers add constraint trailers_identity_source_check
  check (identity_source in ('samsara', 'manual'));

-- ── identity + spec ───────────────────────────────────────────────────────────
alter table trailers add column if not exists vin text;
alter table trailers add column if not exists trailer_type text;
alter table trailers drop constraint if exists trailers_trailer_type_check;
alter table trailers add constraint trailers_trailer_type_check
  check (trailer_type is null or trailer_type in ('dry_van', 'reefer', 'flatbed', 'tanker', 'hopper', 'other'));
/** Nominal length CLASS in feet (28/40/48/53) — NOT a unit conversion of length_in (0058, physical inches). */
alter table trailers add column if not exists length_ft int;
alter table trailers add column if not exists capacity_cube_ft numeric;
alter table trailers add column if not exists capacity_weight_lb numeric;
alter table trailers add column if not exists door_type text;
alter table trailers add column if not exists suspension text;
alter table trailers add column if not exists tare_weight_lb numeric;

-- ── ownership + registration (compliance engine source columns, 0101) ─────────
alter table trailers add column if not exists plate_state text;
alter table trailers add column if not exists ownership_type text;
alter table trailers drop constraint if exists trailers_ownership_type_check;
alter table trailers add constraint trailers_ownership_type_check
  check (ownership_type is null or ownership_type in ('owned', 'leased', 'owner_operator'));
alter table trailers add column if not exists purchased_at date;
alter table trailers add column if not exists lienholder text;
alter table trailers add column if not exists registration_expires_at date;
alter table trailers add column if not exists dot_annual_inspection_expires_at date;
alter table trailers add column if not exists insurance_expires_at date;

-- ── assignment ────────────────────────────────────────────────────────────────
alter table trailers add column if not exists home_terminal_id uuid references terminals(id) on delete set null;

comment on column trailers.length_ft is
  'Nominal trailer length CLASS in feet (28/40/48/53) as the office speaks it. Distinct from
   length_in (0058), which is the physical dimension in inches used by clearance/routing math.';
comment on column trailers.identity_source is
  'samsara = telematics-created (sync may overwrite make/model/year/plate); manual = admin-owned
   (sync writes only samsara_asset_id + pairing). Read by samsaraTrailerSync — plan §4.';
