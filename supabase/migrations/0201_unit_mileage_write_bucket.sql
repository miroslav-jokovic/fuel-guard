-- FuelGuard — 0201 admit the `unit_mileage` write bucket (docs/37 §6 E′)
--
-- ── The failure this prevents, which is not obvious from the API side ───────────────────────────
-- `card_write_counters.bucket` (0178) carries a CHECK enumerating the three buckets that existed
-- when it was written. `CARD_WRITE_LIMITS` gained a fourth — `unit_mileage`, the odometer baseline
-- correction — and the daily cap is enforced by `bump_card_write_counter`, which INSERTs the bucket
-- name. Without this migration that insert violates the CHECK, the RPC returns an error, and
-- `checkDailyCap` takes its failure path.
--
-- That path is `onCounterFailure: 'closed'` for this bucket, chosen because there is no safe
-- direction for a wrong odometer baseline. So the symptom would not be an unmetered write — it would
-- be **every** mileage correction answering 503 "the usage counter is unavailable", permanently, on
-- a counter that is perfectly healthy and simply refuses a word it has never heard. The message
-- names a transient outage, so the first operator to hit it would wait, retry, and wait again.
--
-- Fixed here rather than by softening the constraint or by failing open. The constraint is doing its
-- job: an unrecognised bucket IS a bug, and the counter is right to refuse it. What was missing is
-- that the bucket is no longer unrecognised.
--
-- ── Why this bucket exists at all, given the write is not card-keyed ────────────────────────────
-- `overrideLastMileage` targets a UNIT, not a card, and is deliberately not routed through the card
-- mutation ledger (docs/37 §4, §6 — a plain audited write with a verifying re-read). The rate limit
-- is therefore the only durable bound on it, which argues for tightening rather than skipping it:
-- 3/minute and 20/day, the tightest of the four, against `card_override`'s 5 and 25.
--
-- No data migration. Nothing has ever written this bucket, because nothing could.

alter table public.card_write_counters
  drop constraint if exists card_write_counters_bucket_check;

alter table public.card_write_counters
  add constraint card_write_counters_bucket_check
  check (bucket in ('card_status', 'card_override', 'card_prompts', 'unit_mileage'));

comment on column public.card_write_counters.bucket is
  'Which CARD_WRITE_LIMITS bucket this row counts. Kept in step with CARD_WRITE_BUCKETS in packages/shared/src/cardWriteLimits.ts — a bucket the API meters but this CHECK does not admit makes bump_card_write_counter error, which fail-closed buckets turn into a permanent 503 that reports itself as a transient outage.';
