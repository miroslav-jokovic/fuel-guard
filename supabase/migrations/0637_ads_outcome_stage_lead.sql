-- 0637 — the outcome feed sends each lead itself, as `lead`, before any later stage (ADS-PLATFORM-V2-PLAN V7e).
-- Ships IN THE SAME MERGE as the shared list it mirrors (`OUTCOME_STAGES`, packages/shared/src/ads/contracts.ts)
-- and the feed that writes it (`outcomeCandidates`), because `adsSchemaParity.test.ts` holds this CHECK equal to
-- that list in both directions (0570's rule, Q-AD39; 0580 did the same).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- Meta grants the qualified-lead goal (Conversion Leads) at a "Lead Coverage" of at least 60 % — "the percentage
-- of leads that have matching events uploaded to Meta" — and asks the CRM to "upload the raw lead event that
-- represents all leads generated on Meta" (Conversions API, Conversion Leads integration, CRM integration steps 3
-- and 4, read 2026-11-20). The feed sent only the stages a recruiter's act records, so a lead nobody had reached
-- yet had no event, and a carrier's coverage could not reach 60 % however many leads it had.
--
-- ⚠ DEPLOY WINDOW: a CHECK widened. Old code writes only the eight stages it knows, which the wider CHECK still
-- takes. New code reaching the database before this migration would have its `lead` rows refused (23514) and the
-- feed run fail, to be retried the next day: the feed is off on every carrier (no dataset id saved on staging or
-- production, 2026-11-20), so no run happens in that window. `lint:migration-ordering` reads columns, not CHECKs.

alter table public.ads_outcome_events drop constraint if exists ads_outcome_events_stage_check;
alter table public.ads_outcome_events add constraint ads_outcome_events_stage_check
  check (stage in ('lead', 'contacted', 'qualified', 'not_qualified', 'converted', 'applied', 'hired',
                   'lost_before_conversion', 'lost_after_conversion'));
