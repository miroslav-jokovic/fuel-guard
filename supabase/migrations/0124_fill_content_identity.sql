-- 0124: fill content-identity uniqueness (2026-08 duplication incident, fuel_transactions class).
--
-- Companion to 0123 (identity uniqueness): the same card billing the same gallons at the same
-- INSTANT into the same tank is ONE physical dispense, regardless of which delivery channel wrote
-- it or what external_ref it carries. The store-derive repair path historically minted a
-- different-ref twin of every fill whose file report carried `TransactionId` but not
-- `Stable Transaction ID` — external_ref dedup can never catch that, and the twins doubled the
-- rolling-window gallons that feed cumulative_overfuel (the 2026-08 false-alert flood).
--
-- Scope (precision-first, mirrors resolveContentIdentitySplit):
--   • instant-precision rows only — date-only rows share the noon sentinel, and two legitimate
--     same-day fills with equal gallons must not collide;
--   • card-carrying rows only — manual/card-less entries have no content identity.
--
-- ⚠ ORDER: run scripts/dedupe-fill-twins.sql first. This index refuses to build over existing
-- twins — deliberately, same as 0123.

create unique index if not exists uq_ftxn_content_identity
  on fuel_transactions (org_id, card_ref, fueled_at, gallons, coalesce(tank_type, 'tractor'))
  where card_ref is not null and fueled_at_precision = 'instant';
