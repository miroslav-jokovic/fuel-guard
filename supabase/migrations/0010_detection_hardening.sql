-- FuelGuard — 0010 detection hardening (docs/09-DETECTION-REVIEW.md)
-- Adds: card identity on transactions, idempotent-anomaly index (race backstop),
-- and the new tuning thresholds for cross-source odometer tolerance, daily-mileage cap,
-- and the cumulative-overfuel / card-multi-vehicle rolling window.

-- Card identity carried onto each transaction (EFS "Card #" / fuel_cards.card_ref).
alter table fuel_transactions add column card_ref text;
create index idx_ftxn_card on fuel_transactions (org_id, card_ref, fueled_at desc);

-- Idempotency backstop: at most one *active* anomaly per (transaction, rule) — defeats the
-- read-then-insert race in the scoring service under concurrency (docs/09 P0.2).
create unique index idx_anomaly_active_rule
  on anomalies (transaction_id, rule_id)
  where status <> 'superseded';

-- New engine thresholds (defaults match the engine's built-in fallbacks).
alter table anomaly_thresholds
  add column odometer_tolerance_miles numeric(6,1) not null default 5,   -- the ±5 cross-source check
  add column max_daily_miles          int          not null default 1000, -- date-only (EFS) jump cap
  add column cumulative_window_hours  int          not null default 48;   -- overfuel / card window
