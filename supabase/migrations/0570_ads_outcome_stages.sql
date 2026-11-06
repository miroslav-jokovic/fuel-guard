-- 0570 — the outcome ledger stores the stages a lead is recorded to reach, under their true names
-- (Track W, B6-pre; ADS-AGENT-PLAN.md §9 Q-AD39, ruled (a) by the orchestrator 2026-11-06).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0537 created `ads_outcome_events` (what we told a platform about a lead's progress, D-AD14) with
-- `stage in ('contacted', 'qualified', 'applied', 'hired', 'lost')`, which are D-AD14's first words. Q-AD37
-- (ruled 2026-11-05) then found that nothing records a recruiter's "qualified" or a lead lost before it
-- became an applicant. It ruled that a stage is counted only under the name of the row that records it.
-- The feed's one input, recruiting's `LeadOutcomes` (`packages/shared/src/ads/leadOutcomes.ts`), reports
-- `contacted`, `converted`, `applied`, `hired` and `lost_after_conversion`. Under 0537's list `converted`
-- could only be written as `qualified`, the name Q-AD37 refused. `lost_after_conversion` would become the
-- broader `lost`, and the ledger would stop saying which "lost" it was. This is an append-only evidence table
-- (`RETENTION_FORBIDDEN`), so a wrong name written there could never be corrected in place.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────────────────────────────
-- The CHECK becomes exactly `LEAD_OUTCOME_STAGES`. The shared `OUTCOME_STAGES` is now derived from that list,
-- and `adsSchemaParity.test.ts` holds the two together. That test now reads this
-- `alter table … add constraint … check` form too, so it pins the newest CHECK rather than 0537's.
-- `qualified` and `lost_before_conversion` (`UNRECORDED_LEAD_STAGES`) are deliberately absent: a stage with
-- no writer is never sent. They join through a later migration when Q-AD37 (a) gives them a record.
--
-- ── SAFE IN THE DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────
-- The table has had no writer since 0537. On 2026-11-06 a read-only `select count(*)` gave 0 rows on both
-- staging and production, so dropping and re-adding the CHECK rejects no existing row. Old code never
-- writes the table, so it meets either schema. The writer (B6) ships as the next merge
-- (`lint:migration-ordering`). The constraint name is 0537's generated one, read from both catalogs
-- (`ads_outcome_events_stage_check`). `if exists` keeps a re-run harmless.
--
-- Rejected: (b) storing `converted` as `qualified` (the false name, frozen into evidence); (c) sending only
-- the three stages that fit (drops the stage Q-AD37 chose for Meta's 1–40 % eligibility rule).

alter table public.ads_outcome_events drop constraint if exists ads_outcome_events_stage_check;
alter table public.ads_outcome_events add constraint ads_outcome_events_stage_check
  check (stage in ('contacted', 'converted', 'applied', 'hired', 'lost_after_conversion'));
