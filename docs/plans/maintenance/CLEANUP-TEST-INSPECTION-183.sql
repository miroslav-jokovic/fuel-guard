-- Remove the test annual inspection on unit "183 - SOLD" — owner request, 2026-09-01.
--
-- Paste into the Supabase SQL editor (this session cannot make destructive production writes).
-- Run it whole: it is one transaction, so it either all happens or none of it does.
--
-- ── WHAT THIS ROW IS ─────────────────────────────────────────────────────────────────────────────
-- The only annual inspection ever filed. Certified 2026-09-01 04:02 UTC on a tractor the fleet has
-- already sold, and drawn by renderer 1.0.0 — thirty minutes before the drawing that restored the
-- form's section bands, OK column headings and legend marks landed. It is the report whose printed
-- copy did not match its preview, because a certified report serves the bytes it was filed with and
-- is never re-rendered (D-AVI4).
--
-- ── WHY DELETING IS THE RIGHT ACT HERE, AND WHY THERE IS NO BUTTON FOR IT ───────────────────────
-- `certifications` and `documents` are append-only (RETENTION_FORBIDDEN): corrections are new rows,
-- and a deletion is an explicit, audited, service-role act — never a side effect and never a feature.
-- That is exactly this. Building a "delete a certified inspection" button would put a hole in the
-- evidence model to serve a one-off cleanup of test data.
--
-- The audit entry is INSERTED FIRST and is not deleted afterwards: what remains in the record is
-- that this report existed and was removed on purpose, by whom, and why. A silent delete is the
-- thing the append-only rule exists to prevent.
--
-- ── AFTERWARDS ───────────────────────────────────────────────────────────────────────────────────
-- One orphan is left on purpose because SQL cannot reach it — the rendered PDF in storage:
--
--   documents/86d6b3ea-4361-4f71-877f-e8373615769b/tractor/94523b51-ec57-4605-a14c-feb130684003/
--            3c556560-7d0a-5ca5-89fe-f06d72ad2343.pdf
--
-- Delete it from Storage → documents in the dashboard, or leave it: with its row gone nothing can
-- reach it, and the bucket is private.
--
-- `identity_source` goes back to 'samsara' rather than staying 'manual'. Finalize sets 'manual' so a
-- later TMS sweep cannot overwrite an office-entered expiry (D-ARC3). Leaving it would make this the
-- one vehicle of 198 that the Samsara sweep skips forever — measured before writing this: 197 rows
-- are 'samsara' and exactly one, this vehicle, is 'manual'.

begin;

insert into audit_logs (org_id, actor_id, action, entity, entity_id, meta)
values (
  '86d6b3ea-4361-4f71-877f-e8373615769b',
  null,
  'maintenance.inspection_deleted',
  'vehicle_inspections',
  'fbd3273b-10a9-4100-878b-e7f410292b66',
  jsonb_build_object(
    'reason',           'Test data on unit "183 - SOLD", removed at the owner request 2026-09-01. Filed under renderer 1.0.0, before the template artwork was restored.',
    'inspected_on',     '2026-08-30',
    'document_id',      '3c556560-7d0a-5ca5-89fe-f06d72ad2343',
    'certification_id', '22bc8660-a6f5-5f73-88f0-4194ea795751',
    'storage_path',     '86d6b3ea-4361-4f71-877f-e8373615769b/tractor/94523b51-ec57-4605-a14c-feb130684003/3c556560-7d0a-5ca5-89fe-f06d72ad2343.pdf',
    'items_deleted',    56
  )
);

-- Children first. Every FK between these tables is ON DELETE SET NULL or CASCADE, so the order is
-- not forced — it is child-first anyway so a partial failure cannot leave a report pointing at a
-- certification that no longer exists.
delete from vehicle_inspection_items where inspection_id = 'fbd3273b-10a9-4100-878b-e7f410292b66';
delete from vehicle_inspections      where id            = 'fbd3273b-10a9-4100-878b-e7f410292b66';
delete from certifications           where id            = '22bc8660-a6f5-5f73-88f0-4194ea795751';
delete from documents                where id            = '3c556560-7d0a-5ca5-89fe-f06d72ad2343';

-- The projection finalize wrote onto the truck (D-AVI9). Both halves have to go back: the date, and
-- the ownership claim that came with it.
update vehicles
   set dot_annual_inspection_expires_at = null,
       identity_source                  = 'samsara'
 where id = '94523b51-ec57-4605-a14c-feb130684003';

commit;

-- ── VERIFY (run after) ───────────────────────────────────────────────────────────────────────────
-- Expect: 0, 0, 0, 0, then one vehicle row with a null expiry and identity_source 'samsara',
-- and exactly one audit row recording the removal.
--
-- select count(*) from vehicle_inspections;
-- select count(*) from vehicle_inspection_items;
-- select count(*) from certifications  where id = '22bc8660-a6f5-5f73-88f0-4194ea795751';
-- select count(*) from documents       where id = '3c556560-7d0a-5ca5-89fe-f06d72ad2343';
-- select unit_number, dot_annual_inspection_expires_at, identity_source
--   from vehicles where id = '94523b51-ec57-4605-a14c-feb130684003';
-- select action, created_at from audit_logs
--   where entity_id = 'fbd3273b-10a9-4100-878b-e7f410292b66' order by created_at;
