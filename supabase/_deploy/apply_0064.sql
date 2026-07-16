-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — 0064 price_kind on fuel_prices_posted (cash vs posted quotes, Road Ranger)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- ────────────────────────────────────────────────────────────────────
alter table fuel_prices_posted add column if not exists price_kind text not null default 'posted';
