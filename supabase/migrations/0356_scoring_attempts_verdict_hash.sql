-- `result_hash` is a clock, so "did this fill's VERDICT change?" has no answer in this table.
--
-- ── THE DEFECT (measured 2026-09-22, DATA-LIFECYCLE-PLAN Q6/Q6d) ────────────────────────────────
-- `scoringResultHash({ txnId, engineVersion, caseFired, outcome })` hashes the whole persistence
-- payload, exactly as its docstring says it does. `buildTxnOutcomePatch` puts
-- `samsara_recon_checked_at` in that payload, and `resolveReconciliation` sets that field to
-- `new Date().toISOString()` on every pass that is not `skipRecon` — whether the live refresh
-- succeeded, returned no data, or failed.
--
-- So two attempts on ONE fill under ONE engine version cannot share a `result_hash` unless both ran
-- under `skipRecon`. The column reports how often we re-asked Samsara. It cannot report whether the
-- judgement about the fill moved, and it never could.
--
-- That is not a theoretical complaint. Q6 was analysed three times off this number and reached a
-- wrong answer each time. The third revision built an age-band table from it — "18.70% of fills
-- older than 120 days change under an unchanged engine, against 0.10–0.13% at 15–120 days" — and
-- used it to RULE OUT bounding the scoring cascade, which is the fix worth ~99% of the work. Split
-- by whether a fill belonged to three stuck imports, the same 24 hours reads 62.37% inside them
-- (20,507 pairs) and 0.34% outside (28,290). The imports were entirely older than 120 days and were
-- the only fills getting a live reconciliation. The age band was the clock, and a real fix was
-- rejected on the strength of it.
--
-- ── WHY A SECOND COLUMN RATHER THAN CHANGING THE FIRST ──────────────────────────────────────────
-- Dropping the recon metadata out of `result_hash` is a one-line change, and it would silently
-- redefine 2,427,180 hashes already stored: every historical row would keep a value computed under
-- the old definition while new rows carried the new one, and nothing in the table would say which is
-- which. A comparison across that boundary would be meaningless and would LOOK fine.
--
-- `result_hash` keeps its meaning — the payload identity its docstring claims, which is the right
-- answer to "would this write have changed the row". `verdict_hash` answers the other question. Two
-- questions, two columns, both honest.
--
-- ── WHAT GOES IN IT ─────────────────────────────────────────────────────────────────────────────
-- The judgement and the measurements it rests on: case level/score/signals, severity, the fired
-- rule, computed MPG, miles since last, the attribution verdict, and `case_gates` (which records why
-- detection was limited — a verdict about the verdict). NOT the Samsara evidence fields, the recon
-- status/timestamps/version, or the station pin: those are provenance. When evidence changes and the
-- verdict does not, that is precisely the case this column exists to make visible.
--
-- ── ORDERING ────────────────────────────────────────────────────────────────────────────────────
-- Column first, reader second, in two merges (`lint:migration-ordering`, D-MIG). A merge is SERVED
-- about three minutes in while `migrate.yml` waits for CI green, so the writer cannot ship here: for
-- that window it would insert a column the database does not have and every scoring attempt in the
-- fleet would fail. Nullable with no default and no backfill — a null means "written before the
-- verdict hash existed", which is true and is the only honest value for the 2.4M rows already here.

alter table public.scoring_attempts
  add column if not exists verdict_hash text;

comment on column public.scoring_attempts.verdict_hash is
  'Digest of the VERDICT half of the scoring outcome only — case level/score/signals, severity, fired rule, computed_mpg, miles_since_last, attribution_verdict, case_gates. Excludes Samsara evidence, recon status/timestamps and the station pin. Unlike result_hash, which contains samsara_recon_checked_at (a wall clock) and therefore changes on every live reconciliation, two attempts on one fill under one engine_version share this value when and only when the judgement is the same. Null on rows written before migration 0356. See DATA-LIFECYCLE-PLAN Q6d.';

-- Answering "did the verdict move for this fill?" means walking ONE transaction's attempts in order,
-- which is exactly the access path `idx_scoring_attempts_transaction_started` already serves. No new
-- index here: adding one before a query exists to use it is how this table reached 2.4M rows and
-- three indexes, and D-LIFE8 says an unused index is a finding, not a fact of life. (L5's timings on
-- 2026-09-22 were for `idx_scoring_attempts_org_started`, a different index and a different query —
-- not evidence about this path, and not borrowed as though it were.)
