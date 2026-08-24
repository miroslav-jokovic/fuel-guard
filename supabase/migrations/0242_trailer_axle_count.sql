-- 0242: the four fields the recon actually found (MCLEOD-FIELD-GAP-PLAN §7c)
--
-- The 2026-08-24 reconnaissance asked 23 questions of the carrier's LoadMaster and the answer was
-- mostly negative: `cdl_class`, `irp_code`, `fuel_type_code`, `axle_number_code`, the tractor weight
-- columns, `door_type_code` and the trailer volume/weight columns are NULL on every active row, and
-- `trailer.tag_expire_date` is populated on zero of 235.
--
-- **That is a source-routing answer, not a gap.** Five systems feed this database — Samsara, McLeod,
-- FleetPal, EFS and PSP — and "McLeod holds nothing here" means the column belongs to one of the
-- others. `tank_capacity_gal` is the clearest case: it is set locally today and FleetPal owns it
-- next, so `tractor.fuel_capacity` being empty on 190 of 190 costs us nothing at all.
--
-- What McLeod DOES hold, measured:
--   tractor.purchase_date    190/190, all past  → vehicles.purchased_at
--   trailer.purchase_date    224/235, all past  → trailers.purchased_at
--   trailer.inspection_date  228/235, all past  → trailers.dot_annual_inspection_expires_at (+1y)
--   trailer.axles            193/235, every one '2' → trailers.axle_count, added here
--
-- `axle_count` is the only new column. `vehicles` has had one since 0119; `trailers` never did,
-- which is why the trailer half of every axle-dependent question has been unanswerable.
alter table trailers add column if not exists axle_count integer;

comment on column trailers.axle_count is
  'Number of axles. Sourced from McLeod dbo.trailer.axles (193 of 235 populated at Silvicom, every one
   a 2). Nullable on purpose — a trailer whose axle count nobody recorded is a trailer with an unknown
   axle count, not a two-axle trailer.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE CLAIM TRIGGERS HAVE TO LEARN THE NEW FIELDS
--
-- 0241 protects an office edit by flipping `identity_source` to 'manual' when a human changes a
-- column the sync owns, and the claimable list is passed to the trigger as arguments. Three columns
-- join that list here because the sync now writes them.
--
-- This is not optional bookkeeping. `rosterFields.claimParity.test.ts` asserts the trigger's argument
-- list equals the set `vehiclePatch`/`trailerPatch` actually emit, and it fails the build if they
-- drift — precisely because the failure is silent in both directions: a column the sync writes but
-- the trigger omits gets the office's correction reverted on the next sweep, and a column the trigger
-- claims but the sync never writes freezes a row nobody asked to freeze.
--
-- `drivers` is untouched: the recon found nothing new McLeod holds for a driver that D-MR6 has not
-- already decided about, and `driver.type_of`'s C/O codes are undocumented (D-FG12).
drop trigger if exists trg_claim_vehicle_identity on public.vehicles;
create trigger trg_claim_vehicle_identity
  before insert or update on public.vehicles
  for each row
  execute function public.claim_identity_for_office(
    'vin', 'make', 'model', 'year', 'plate', 'plate_state',
    'registration_expires_at', 'dot_annual_inspection_expires_at', 'purchased_at');

drop trigger if exists trg_claim_trailer_identity on public.trailers;
create trigger trg_claim_trailer_identity
  before insert or update on public.trailers
  for each row
  execute function public.claim_identity_for_office(
    'vin', 'make', 'year', 'plate', 'plate_state', 'is_reefer',
    'purchased_at', 'dot_annual_inspection_expires_at', 'axle_count');
