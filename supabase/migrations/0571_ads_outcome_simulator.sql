-- 0571 — the outcome ledger accepts the simulator platform (Track W; ADS-AGENT-PLAN.md §9 Q-AD40 (2), ruled by
-- the orchestrator 2026-11-06).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0537's `ads_outcome_events.provider` allows `meta`, `tiktok` and `x`. A lead from the SIMULATOR platform
-- (FakeMeta behind `simulatorGate`, staging only) could therefore never be ledgered, and the owner's staging
-- walk could not exercise the outcome feed (B6) at all. The simulator is the platform the whole product runs
-- on before any credential exists (§4R), and its lead rows already say `simulator` (`recruiting_leads.channel`).
--
-- ── WHY THIS IS SAFE ────────────────────────────────────────────────────────────────────────────────
-- The CHECK only widens: every row it allowed before is still allowed, so no row is refused and old code meets
-- it in the deploy window. Production cannot SEND a simulator event: the feed opens a simulator connection only
-- through `simulatorGate`, which refuses a production host, so a simulator row on production would never move
-- past `queued`. The feed's target reader (Q-AD40's second merge) refuses a simulator target there first, so
-- none is even queued. The shared `OUTCOME_PROVIDERS` names the same four, and `adsSchemaParity.test.ts` pins
-- the two together (it reads this `alter table` form since 0570).
--
-- The constraint name is 0537's generated one, read from both catalogs on 2026-11-06
-- (`ads_outcome_events_provider_check`). `if exists` keeps a re-run harmless.

alter table public.ads_outcome_events drop constraint if exists ads_outcome_events_provider_check;
alter table public.ads_outcome_events add constraint ads_outcome_events_provider_check
  check (provider in ('meta', 'tiktok', 'x', 'simulator'));
