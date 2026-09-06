-- Silvicom 360 — 0305 the money store's one clock, written on the columns (D-FIN9,
-- docs/plans/financial/FINANCE-GO-LIVE-PLAN.md §1.9). COMMENTS ONLY — no data moves.
--
-- What was measured before deciding (production, 2026-09-03). Three sources kept three clocks:
-- McLeod stamps arrive as the carrier's local wall time with a `Z` label, EFS `fueled_at` is a true
-- instant, and every Finance window is `YYYY-MM-DD` compared at UTC midnight. The plan's first
-- draft was to convert everything to instants in the org's zone. Tried on the data, that would
-- have moved 890 canonical McLeod entries ($1.29M) — accrual, bill and transaction DATES, stored
-- as `…T00:00:00` — from the first of a month into the last evening of the month before. Those
-- rows were already right: a wall-time date against a wall-time window is the carrier's own
-- calendar. Only the true-instant source was wrong, by exactly the org's offset at month edges:
-- 59 EFS fills ($30k) sat in the neighbouring month.
--
-- So the convention is the one McLeod has always used, made explicit and applied to EFS on the way
-- in: `financial_entries.occurred_at` and `settled_at` hold the ORGANISATION'S LOCAL WALL-CLOCK
-- TIME, labelled UTC. The projection converts an EFS instant with `localWallClock(fueled_at,
-- organizations.operating_hours->>'tz')`; McLeod rows need nothing. Every window in the store is a
-- local calendar window by construction. A reader that wants the true instant of a fill has
-- `fuel_transactions.fueled_at`, which is untouched.
--
-- What was rejected: shifting stored McLeod stamps to instants (they are dates, not instants — the
-- shift is the bug); a per-source clock resolved at read time (one column, two meanings, every
-- reader a chance to get it wrong).
--
-- Rollback: drop the comments. Nothing else to undo.
-- raw-access-waiver: comments on the financial module's own store; no cross-module read.

comment on column financial_entries.occurred_at is
  'When the money event happened, as the ORGANISATION''S LOCAL WALL-CLOCK TIME labelled UTC (0305, D-FIN9): McLeod sends wall time; the projection converts EFS instants with localWallClock(fueled_at, operating_hours.tz). Compare with YYYY-MM-DD windows as local calendar days. The true instant of a fill is fuel_transactions.fueled_at.';
comment on column financial_entries.settled_at is
  'When the money moved, same clock as occurred_at: the organisation''s local wall-clock time labelled UTC (0305, D-FIN9).';
