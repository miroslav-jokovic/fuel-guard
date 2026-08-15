-- FuelGuard — 0194 the credential-identity binding is REQUIRED (execution plan Step 2.6)
--
-- 0187 wrote this rule down as prose, in its own column comment:
--
--   "no org with write_entitlement = 'confirmed' may still have a null probed_identity_hash"
--
-- and then enforced nothing. On 2026-08-15 the only org with card control was violating it — QA,
-- `write_entitlement = 'confirmed'`, `probed_identity_hash` null, probed 2026-08-11, before 0187's
-- columns existed. The application read that null and took a grandfather branch: one warning, write
-- allowed. So the guard that stops an entitlement confirmed against ONE EFS credential being
-- exercised against whatever credential the row points at today had never run, on 100% of the orgs
-- it governed, for four days. A rule stated in a comment is a rule nobody enforces.
--
-- ── The order this migration depends on, and it is load-bearing ─────────────────────────────────
-- This constraint is VALIDATED, not `not valid`. That is deliberate and it is the whole point: a
-- `not valid` constraint would grandfather exactly the row this step exists to eliminate, which is
-- how the state survived 0187. It therefore REFUSES TO APPLY while any violating row exists.
--
-- So the sequence is: ① re-probe every confirmed org through POST /api/fuel-cards/write-check, which
-- is the only writer that sets 'confirmed' and always records `probed_identity_hash` in the same
-- upsert (writeProbe.ts); ② then apply this. Applying it first does not "fail safe" — it fails the
-- migration, which on this repo blocks every later migration behind it.
--
-- Run `node scripts/card-control-binding-check.mjs` first. It reports exactly the rows that would
-- make this migration fail, and exits non-zero when there are any.
--
-- ── Why a constraint when only one code path can write the column ───────────────────────────────
-- Today `writeProbe.ts` is the sole writer of 'confirmed' and it always writes the hash alongside,
-- so in application terms the violating state is already unreachable. That was equally true the day
-- 0187 shipped, and the row still exists — it predates the writer. A constraint is what makes the
-- claim survive the next backfill, the next hotfix, and the next person who has not read this file.
-- It also converts the application's own null-check into what it should be: defence in depth against
-- a state the database forbids, rather than the only thing standing between a stale entitlement and
-- a live card.

alter table efs_card_control_settings
  add constraint efs_card_control_settings_confirmed_requires_identity
  check (write_entitlement <> 'confirmed' or probed_identity_hash is not null);

comment on constraint efs_card_control_settings_confirmed_requires_identity
  on efs_card_control_settings is
  'Step 2.6: a confirmed write entitlement must name the credential identity it was confirmed against. Enforces what 0187 only stated in a column comment. Re-probe the org (POST /api/fuel-cards/write-check) rather than nulling the entitlement to satisfy this.';

-- 0187's column comment described the null as "temporarily grandfathered". It is not, any more.
comment on column efs_card_control_settings.probed_identity_hash is
  'Keyed hash of the probed EFS endpoint host, SOAP username and account id, written by writeProbe.ts in the same upsert that sets write_entitlement. Null is permitted ONLY while the entitlement is not ''confirmed'' — constraint efs_card_control_settings_confirmed_requires_identity (migration 0194) enforces it. A mismatch against the current credentials refuses card control with `endpoint_changed`.';
