-- 0580 — the outcome feed may carry the three stages a recruiter's act records (ADS-LEAD-INTAKE-PLAN.md LQ5b2;
-- Q-AD64 (a) and Q-AD65 (a), ruled 2026-11-09). Ships IN THE SAME MERGE as the shared list it mirrors
-- (`LEAD_OUTCOME_STAGES`, packages/shared/src/ads/leadOutcomes.ts), its recruiting reader
-- (`recruiting/leads/leadOutcomes.ts`, which now reads `recruiting_lead_closures`), the brief and the
-- settings screen — because `adsSchemaParity.test.ts` holds this CHECK equal to that list in both directions
-- (0570's rule, Q-AD39), and LQ5a's first CI run showed what a CHECK ahead of its list costs.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────────────────────────
-- 0570 named the five stages a row recorded: contacted, converted, applied, hired, lost_after_conversion.
-- `qualified` and `lost_before_conversion` were deliberately absent — nothing wrote them, and a stage with no
-- writer is `not_recorded`, never 0. 0578 (LQ5a) gave them a writer, `recruiting_lead_closures`, and added a
-- third, `not_qualified` (a close for a named requirement, which also writes a verified verdict). So:
--   qualified               a recruiter's positive verdict after a reached call (`qualify_lead`)
--   not_qualified           closed for one of `LEAD_REQUIREMENTS` (`close_lead`, status `not_qualified`)
--   lost_before_conversion  closed for any other reason (`close_lead`, status `lost`)
-- Meta's Conversion Leads optimisation learns from the whole funnel; a feed with no negative stage teaches it
-- that every unconverted lead is still pending (audit F-LA1). Whether EMPLOYMENT accepts each stage is an L4
-- reading (Q-AD17); a refused stage is a `skipped` row and the brief says so — nothing assumes it works.
--
-- The order below is the shared list's order. `lost` (0537's old word) stays out: it was never a stage a row
-- recorded under that name.
--
-- ⚠ DEPLOY WINDOW: a CHECK widened. A wider CHECK refuses nothing old code writes; old code sends only the
-- five stages it knows. New code behind this is in the same merge, and `lint:migration-ordering` reads
-- columns, not CHECKs — the coupling is the parity test's, and it is why this merge carries both sides.

alter table public.ads_outcome_events drop constraint if exists ads_outcome_events_stage_check;
alter table public.ads_outcome_events add constraint ads_outcome_events_stage_check
  check (stage in ('contacted', 'qualified', 'not_qualified', 'converted', 'applied', 'hired',
                   'lost_before_conversion', 'lost_after_conversion'));
