-- Which version of the scoring logic last judged this fill.
--
-- The problem it exists to end, measured 2026-09-05. A derivation change (a corrected MPG numerator,
-- the anomaly window-span fix, a new gate) applies only to fills that get re-scored, and nothing
-- recorded WHICH fills had been judged under which rules. That left two options and no third:
-- `nightlyReconcile` re-scores a trailing `RECENT_REBUILD_DAYS` (14) window, so anything older than a
-- fortnight silently keeps its old verdict forever (Q-FUI9); or re-score all of history, which took
-- **three hours for 15,972 fills** and had to be cancelled at 14,400 to get the day back.
--
-- With a version stamp the choice disappears: the nightly pass takes a bounded batch of the fills whose
-- stamp is below the current version, oldest first, and history converges over a few nights on its own.
-- The backlog stops being invisible and becomes a number — `count(*) where scoring_version < current` —
-- which is the same shape `samsara_recon_status` already uses to drain the telematics hole, so this is a
-- proven pattern here rather than a new invention.
--
-- NULL means "scored before this column existed", which sorts naturally as the oldest work and needs no
-- backfill: every fill is due exactly once, and the first sweeps simply have the most to do.
--
-- Ships ALONE, ahead of its first reader (lint:migration-ordering). Railway serves a merge before
-- migrate.yml applies it, so a reader landing in this merge would spend that window asking PostgREST
-- for a column the database does not have — measured at 9m10s of 500s on #430.

alter table public.fuel_transactions
  add column if not exists scoring_version integer;

comment on column public.fuel_transactions.scoring_version is
  'Version of the scoring logic that last judged this fill; NULL = scored before the stamp existed. The nightly re-score claims the lowest versions first, so a derivation change converges over several passes instead of one full-history sweep.';

-- Partial index on the claim order. `nulls first` matches the sweep's `order by scoring_version asc
-- nulls first`, so the oldest-judged fills are found without scanning the fills already current — which
-- is the whole point, since on a healthy fleet nearly every row is current and only a slice is due.
create index if not exists idx_fuel_transactions_scoring_version
  on public.fuel_transactions (org_id, scoring_version nulls first, fueled_at);
