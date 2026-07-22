-- 0075: Driver Control ID from EFS. EFS stopped printing full card numbers, so `card_ref` is now the last 4
-- only — which collides across drivers and made the "one card, multiple trucks" rule either mis-fire or (with
-- the isReliableCardRef guard) go silent entirely. The Control ID is a stable per-driver identifier printed on
-- the reports; we capture it on both the faithful store and the derived fuel events and key the card rule on it
-- so two different drivers who share the same last 4 are no longer conflated.
alter table fuel_transactions add column if not exists control_id text;
alter table efs_transactions  add column if not exists control_id text;

-- Supports the card-on-multiple-trucks lookup: fills sharing one control_id within the rolling window.
create index if not exists idx_fuel_transactions_org_control
  on fuel_transactions (org_id, control_id)
  where control_id is not null;
