-- FuelGuard — 0441 run the detection reset for Silvicom (D-CF9, Q-CF1 (a), Q-F9 (a); F02-F04 PLAN.md
-- chunk 7c). The act itself; 0439 (chunk 7a) is the function, and #1353 (chunk 7b) is what keeps it done.
--
-- WHAT IT DOES. Calls `reset_fill_detection` once, for Silvicom, with the owner as the actor and the
-- moment this migration runs as the start date. That one call, in one transaction:
--   • sets `organizations.detection_epoch`;
--   • closes every OPEN fill alert before it as dismissed, disposition `retired_reset_2026_10`, with
--     the owner as who and one history row each (82 on production, measured read-only 2026-10-08:
--     54 critical, 5 high, 23 medium, fills 01-01 → 09-30; none investigated, none dispositioned);
--   • writes one `audit_logs` row, `anomalies.detection_reset`, naming the owner, the date and the counts.
-- The Fuel Log's red markers on those fills clear on the next nightly flag sweep (`reconcileAnomalyFlags`,
-- which reads the start date since #1353).
--
-- WHY A MIGRATION. It is the house pattern for a one-off audited data act (0359, 0400): the owner
-- approves the release that carries it, the release train runs it at 01:07 CT, and it writes its own
-- audit row. D-CF9 asks for "an explicit, audited service-role act, never a side effect of a deploy";
-- this file IS the act, reviewed and approved as one, not a by-product of other code.
--
-- ⚠ ORDER. This must reach production in a release AFTER the one that carried #1353. A release runs its
-- migrations first and its code second; were the reset and #1353 in one release, the old code would
-- score for a few minutes after the reset, and an import in that window re-scores up to 48 h of earlier
-- fills, re-opening their alerts (0158: a closed case does not block a new one). The PR that carries
-- this file is merged only once production serves #1353.
--
-- WHO. The owner, user 2607d9c1-9e12-47f4-ad53-aa5a5bde4713 (miki@silvicominc.com, admin of Silvicom, the
-- queue's owner under Q-F1, 410 recorded alert actions; looked up read-only 2026-10-08).
--
-- ANY OTHER DATABASE. Staging and the PGlite matrices may not hold this org or this user, and an org
-- that was already reset is left alone: each case skips with a notice and changes nothing. A skip is
-- not an error, so a staging database shaped differently can never block the train.
--
-- cross-module-waiver: the only tables touched are through `reset_fill_detection` (0439, which carries
-- its own waiver); this file reads `organizations` and `auth.users` only to decide whether to call it.
--
-- Proven in supabase/tests/detection-reset-run.test.mjs.
--
-- Rollback: none by design. A wrong reset is corrected by a person reopening a case (closed cases can
-- be moved back to investigating), never by deleting rows; the audit row records what was done.

do $$
declare
  v_org    constant uuid := '86d6b3ea-4361-4f71-877f-e8373615769b';
  v_actor  constant uuid := '2607d9c1-9e12-47f4-ad53-aa5a5bde4713';
  v_epoch  timestamptz;
  r        record;
begin
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    raise notice '0441: organization % is not in this database — nothing done', v_org;
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = v_actor) then
    raise notice '0441: user % is not in this database — nothing done', v_actor;
    return;
  end if;
  select o.detection_epoch into v_epoch from public.organizations o where o.id = v_org;
  if v_epoch is not null then
    raise notice '0441: organization % was already reset at % — nothing done', v_org, v_epoch;
    return;
  end if;

  select * into r from public.reset_fill_detection(v_org, v_actor, now());
  raise notice '0441: detection reset at %: % alerts retired, % kept because they are being investigated',
    r.epoch, r.retired, r.kept_investigating;
end;
$$;
