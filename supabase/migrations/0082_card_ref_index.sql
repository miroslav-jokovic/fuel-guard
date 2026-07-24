-- FuelGuard — 0082 (WP3b): index for the per-fill card-window scans (as-of assignment + misuse count).
-- resolveCardContext queries fuel_transactions by (org_id, card_ref) and (org_id, control_id) over a
-- trailing 60-day range; control_id is indexed since 0075 — this adds the card_ref twin.
create index if not exists idx_fuel_transactions_org_card
  on fuel_transactions (org_id, card_ref)
  where card_ref is not null;
