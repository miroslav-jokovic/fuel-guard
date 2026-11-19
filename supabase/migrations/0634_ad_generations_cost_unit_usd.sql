-- 0634 — a generation's cost may be written in US dollars (ADS-PLATFORM-V2-PLAN Q-APX16, ruled (a) by the owner
-- 2026-11-18: "proceed as recommended and proposed").
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- 0537 let `ad_generations.cost_unit` be `tokens` (Claude) or `credits` (Higgsfield). Higgsfield's API has no
-- credits: its pricing, billing and usage pages (read 2026-11-17) price in dollars a second, the account holds
-- dollars, the usage report answers `"currency":"USD"`, and `POST /estimate/<model>` answers `{"usd":"0.094"}` —
-- "the authoritative amount" for the account. Credits are the unit of Higgsfield's consumer plans, which is where
-- the name came from. So the picture and video budget becomes US cents a month, each render's price is asked from
-- `/estimate` before its row is written, and the row records it in `usd`.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────────────────────────────
-- The check only. `usd` joins the list; `credits` stays, because the ledger is append-only (AX010/AX011) and a
-- row a simulator render wrote in credits on staging can be neither rewritten nor dropped. Nothing writes
-- `credits` once the render reads `/estimate`. `cost_units` keeps 0537's numeric(14, 4): four decimals of a
-- dollar is a hundredth of a cent, finer than any price the estimate page shows; the writer rounds UP to it, so
-- a month's sum can only overstate what was spent, never understate it.
--
-- ── ORDER ────────────────────────────────────────────────────────────────────────────────────────────
-- Widened one merge before its writer (MIGRATION-DISCIPLINE §the-deploy-window), like 0631 before its
-- certification: until the render writes `usd`, old code never meets it, so this is safe on either side of a
-- deploy. Constraint only, no data change. `ads-foundation.test.mjs` holds the list.

alter table public.ad_generations drop constraint if exists ad_generations_cost_unit_check;
alter table public.ad_generations add constraint ad_generations_cost_unit_check
  check (cost_unit is null or cost_unit in ('tokens', 'credits', 'usd'));
