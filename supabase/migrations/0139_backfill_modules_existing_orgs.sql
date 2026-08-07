-- FuelGuard — 0139 grant every module to the orgs that exist today (single-tenant pilot backfill)
--
-- WHY. `0088` deliberately backfills only `dispatch` + `navigation`, and its `seed_default_org_modules()`
-- trigger gives new orgs the same two. That default is correct and stays: a customer onboarded
-- tomorrow must not silently receive HazmatGuard, Messages or Notifications — those are sold, and the
-- platform console is where they get granted (D-PM6).
--
-- But it is wrong for TODAY. There is exactly one organization in this deployment — ours — and it is
-- the org every feature is being built and tested against. Under the shipped default it reads as a
-- customer who bought nothing: the hazmat entry, the messages button and the notification bell all
-- resolve OFF and the driver app looks empty, while the dashboard shows those rows greyed out with
-- "Not in your plan" and no way to enable them (entitlements are intentionally not tenant-writable).
--
-- WHAT THIS DOES. Grants every catalog module to organizations that exist AT THE MOMENT THIS
-- MIGRATION RUNS. It does not touch the trigger, so the multi-tenant default is completely intact:
-- any org created after this point still starts with dispatch + navigation only.
--
-- Idempotent: `on conflict do nothing` leaves an existing row (including a deliberate `enabled=false`
-- revoke) exactly as it is. Re-running this migration cannot silently re-grant something a human
-- turned off.
--
-- WHEN TO REVERSE. The first time a real second customer is onboarded, nothing needs undoing — this
-- only ever touched the orgs present today. If our own org should later lose a module, revoke it from
-- the platform console like any other customer.

insert into org_modules (org_id, module_key, enabled)
select o.id, k.module_key, true
  from organizations o
 cross join (values
   ('hazmatguard'),
   ('training'),
   ('messages'),
   ('notifications'),
   ('dispatch'),
   ('navigation')
 ) as k(module_key)
on conflict (org_id, module_key) do nothing;
