-- 0204: identity_source learns to say 'efs' (DQF-EXECUTION-PLAN A6, decision D-DQ12)
--
-- The gap: two code paths (efsIngest.ts, driverAttribution.ts) provision a driver row for every EFS
-- fuel-card name that matches nobody, so a fill always has somebody to point at. That is legitimate —
-- an unattributed fill is worse than a stub. What was wrong is that the stub was indistinguishable
-- from an employee: 0098's CHECK admits only 'samsara' and 'manual', so the column fell to its
-- default and every stub CLAIMED telematics provenance. Measured 2026-08-19 (A2c): 81 of Silvicom's
-- 248 "active" drivers were these stubs — a third of the qualification queue owed files for people
-- the carrier never employed, and per-driver-priced monitoring (Phase E) would have billed for them.
--
-- Why this shape: a third enum value plus a backfill, rather than a status change — every
-- `status='active'` query in the product keeps its meaning (option (b) was rejected in the plan for
-- exactly that blast radius).
--
-- The backfill predicate: a row claiming 'samsara' provenance with NO samsara_driver_id is
-- definitionally a mislabeled stub. The Samsara sync writes samsara_driver_id on every insert;
-- manual creation writes 'manual'; merge_driver never nulls the canonical's link. The only writers
-- that ever produced samsara-labeled, link-less rows are the two EFS provisioning paths — which from
-- this migration on say 'efs' explicitly.

alter table drivers drop constraint if exists drivers_identity_source_check;
alter table drivers add constraint drivers_identity_source_check
  check (identity_source in ('samsara', 'manual', 'efs'));

update drivers
   set identity_source = 'efs'
 where identity_source = 'samsara'
   and samsara_driver_id is null;

comment on column drivers.identity_source is
  'Provenance: ''samsara'' (telematics sync), ''manual'' (office-created or office-claimed), ''efs'' (auto-provisioned from a fuel-card name — a payment identity, not necessarily an employee). EFS rows are excluded from qualification surfaces and from SambaSafety enrollment.';
