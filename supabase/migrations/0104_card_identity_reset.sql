-- FuelGuard — 0104 card-identity reset (WP3c)
--
-- WHY
-- EFS stopped printing full card numbers on the transaction reports. The identity layer had two
-- defects that made the masked refs conflate different physical cards, which is what produced the
-- false "this card fueled N different vehicles" alerts:
--
--   1. `cardIdentityKey` treated ANY ref with >= 8 digits as a full PAN. A masked ref of the form
--      `708305XXXXXX1234` yields 10 digits once the mask characters are stripped, so it was read as a
--      PAN, the control number was never consulted, and every card sharing that BIN + last-4 collapsed
--      into ONE identity.
--   2. `sameCardFill` short-circuited to "same card" whenever either side had >= 8 digits, so a full
--      PAN matched a bare last-4 by suffix — a suffix shared by every card ending in those digits.
--
-- The code fix changes the SHAPE of the learned key for masked cards from `<all-digits>|<control>` to
-- `<last4>|<control>`, and stops minting PAN-shaped keys for masked refs entirely. Existing rows in
-- `fuel_cards` were written under the old shapes, so they are stale: they no longer match any lookup
-- and, worse, a row minted from a conflated identity may point at the wrong truck.
--
-- WHAT THIS DOES
-- Deletes the LEARNED rows only. They are derived data — `syncCardAssignments` rebuilds them from the
-- trailing 60 days of attributed fills on the next nightly reconcile, or immediately via
-- POST /api/transactions/rescore-declined. MANUAL rows (a human declared this card belongs to that
-- truck) are ground truth and are never touched; the SELECT at the bottom lists any whose ref no
-- longer parses as a full card number so an admin can re-enter them against the new key shape.
--
-- Idempotent. Safe to re-run.
--
-- Rollback: none needed — this only removes regenerable rows.

begin;

delete from fuel_cards
 where assignment_source is distinct from 'manual';

commit;

-- ── Post-migration review list (run separately; returns rows, changes nothing) ───────────────────
-- Manual assignments whose card_ref is NOT an unmasked full card number. Under the corrected identity
-- rule these only match a fill when the ref is exactly `<last4>|<control number>`. Anything else here
-- should be re-entered in Settings → Fuel cards.
--
--   select org_id, card_ref, card_last4, vehicle_id, updated_at
--     from fuel_cards
--    where assignment_source = 'manual'
--      and card_ref !~ '^[0-9]{8,}$'
--      and card_ref !~ '^[0-9]{4}\|.+$'
--    order by updated_at desc;
