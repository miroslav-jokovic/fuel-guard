-- 0415 — receipts are readable and deletable by the people who own them, not by every member of the
-- organisation (database audit 2026-10-03, finding 2).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- 0005's three policies on the `receipts` bucket test the bucket and the first path segment (the
-- organisation) and nothing else — no role, no section, no driver, no ownership. Production's live
-- definitions are identical to 0005's (read 2026-10-03). So any signed-in user of an organisation,
-- DRIVERS INCLUDED, can read every receipt in it, upload into any vehicle's folder and delete any
-- receipt. The audit reproduced a driver reading and deleting another driver's receipt on a replay.
-- The fuel rows are driver-scoped (`ftxn_driver_select`); their receipts were not. A private bucket
-- isolates tenants, not people inside one.
--
-- ── WHAT IS AT RISK TODAY: NOTHING YET, AND THAT IS WHY NOW ─────────────────────────────────────
-- Measured 2026-10-03: the bucket holds 0 objects and 0 of 18,153 fuel rows carry a `receipt_path`.
-- Nothing in the repository reads receipts; the one writer is the office fill-up form
-- (`useCreateFillUp.ts`), which uploads `{org}/{vehicle}/{fillUp}.webp` BEFORE it inserts the row.
-- The exposure is real and unused. Closing it before the first receipt exists costs no migration of
-- data and breaks no reader; closing it afterwards means deciding what to do with objects somebody
-- already uploaded under the open rules.
--
-- ── THE RULES, AND WHY EACH ONE ─────────────────────────────────────────────────────────────────
--   READ    a role that can view the fuel section (the section answer, so an org's override reaches
--           it), OR a driver reading an object THEY uploaded. A driver otherwise reads none.
--   INSERT  a role that can manage the fuel section, OR a driver uploading into the folder of a
--           vehicle assigned to them — the same test `ftxn_driver_insert` applies to the fuel row the
--           receipt belongs to. The folder is path segment 2.
--   DELETE  fuel `manage` only, never a driver. A receipt is evidence in a fuel-fraud case; "the
--           person who is being checked can erase the proof" is the shape this product exists to
--           catch. A mistaken upload is a manager's correction (and the repository's rule for
--           evidence applies: corrections are new rows, deletions are audited acts). This is the
--           recommended answer to the open question put to the owner; the alternative, letting an
--           uploader delete their own, is a one-clause change.
-- The default role lists in the policies are not typed from memory: they are
-- `rolesThatCanView("fuel")` and `rolesThatManage("fuel")` from SECTION_ACCESS, and
-- `lint:section-policies` fails if they drift.
--
-- ── WHY `owner_id` AND WHAT IT CANNOT DO ────────────────────────────────────────────────────────
-- Storage stamps `owner_id` with the uploader's user id when a browser uploads with a user token.
-- That is the only ownership fact the object carries before a fuel row exists, and the upload comes
-- first. It is NULL for objects the API writes with the service role (all 70 objects in the other
-- buckets, measured), so it is used here ONLY for the driver's own-object read, where a NULL
-- correctly means "nobody's" and denies. It is not used for anything a manager needs.
-- Linking read access to the fuel row instead (`receipt_path = name`) was rejected: the row does not
-- exist when the upload happens, and an orphaned upload would be unreadable even by its uploader.
--
-- ── ALSO: THE BUCKET ACCEPTS ANY FILE OF ANY SIZE ───────────────────────────────────────────────
-- `receipts` had no size limit and no type restriction (the audit's finding F); a driver could fill the
-- bucket. Capped at 10 MiB, images only — the figures `inventory-photos` already uses, and the form
-- compresses to WebP before uploading. JPEG and PNG are allowed so a future capture path is not
-- refused for its format.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────────
-- · It does not make the fuel rows' own SELECT section-aware (finding 1). A `fuel: none` user is still
--   refused here, which is stricter than the table beside it until finding 1 lands.
-- · It does not stop a stale token (finding 3): the section and role come from the JWT.
-- · It does not touch `load-photos` or any other bucket.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- Order-independent: policies on one bucket, no column, no function, and no reader in served code.
-- The one writer (the office form) is a fuel manager, which the new INSERT rule admits.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Re-create the three 0005 policies; `update storage.buckets set file_size_limit = null,
-- allowed_mime_types = null where id = 'receipts'`.
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'receipts_%' order by 1;                     -- expect read, insert, delete
--   select file_size_limit, allowed_mime_types from storage.buckets where id = 'receipts';

drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;

-- section-policy-waiver(receipts_read): `storage.objects` is shared by every bucket, so the gate has no table-to-section
-- mapping to check against. The lists below ARE the derived sets (`rolesThatCanView("fuel")` /
-- `rolesThatManage("fuel")`), and supabase/tests/receipts-ownership.test.mjs asserts the policy's answer for
-- every role in USER_ROLES against the shared SECTION_ACCESS matrix, so drift fails there instead.
create policy receipts_read on storage.objects
  for select
  using (
    bucket_id = 'receipts'
    and split_part(name, '/', 1) = auth_org_id()::text
    and (
      auth_section_or_default('fuel', 'view',
        auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
      or (auth_role() = 'driver' and owner_id = auth_user_id()::text)
    )
  );

-- section-policy-waiver(receipts_insert): `storage.objects` is shared by every bucket, so the gate has no table-to-section
-- mapping to check against. The lists below ARE the derived sets (`rolesThatCanView("fuel")` /
-- `rolesThatManage("fuel")`), and supabase/tests/receipts-ownership.test.mjs asserts the policy's answer for
-- every role in USER_ROLES against the shared SECTION_ACCESS matrix, so drift fails there instead.
create policy receipts_insert on storage.objects
  for insert
  with check (
    bucket_id = 'receipts'
    and split_part(name, '/', 1) = auth_org_id()::text
    and (
      auth_section_or_default('fuel', 'manage', auth_role() in ('admin', 'fleet_manager'))
      or (
        auth_role() = 'driver'
        and exists (
          select 1 from public.vehicles v
           where v.id::text = split_part(name, '/', 2)
             and v.org_id = auth_org_id()
             and v.assigned_driver_id = auth_driver_id()
        )
      )
    )
  );

-- section-policy-waiver(receipts_delete): `storage.objects` is shared by every bucket, so the gate has no table-to-section
-- mapping to check against. The lists below ARE the derived sets (`rolesThatCanView("fuel")` /
-- `rolesThatManage("fuel")`), and supabase/tests/receipts-ownership.test.mjs asserts the policy's answer for
-- every role in USER_ROLES against the shared SECTION_ACCESS matrix, so drift fails there instead.
create policy receipts_delete on storage.objects
  for delete
  using (
    bucket_id = 'receipts'
    and split_part(name, '/', 1) = auth_org_id()::text
    and auth_section_or_default('fuel', 'manage', auth_role() in ('admin', 'fleet_manager'))
  );

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'receipts';
