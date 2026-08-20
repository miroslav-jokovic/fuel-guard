-- 0219 — what a PSP transaction cost, and what a PSP record says about itself.
--
-- Two hardening changes to code that shipped in P9 and has never yet run against a live order.
-- Both are cheap now for the same reason: `psp_requests` is empty and there are zero `psp_report`
-- qualification records in production. Neither would be cheap after the first order.
--
-- ── 1. THE PRICE BELONGS ON THE ROW, NOT ONLY IN THE ENVIRONMENT ───────────────────────────────
-- `PSP_UNIT_PRICE_USD` is deployment configuration: one value, correct only right now. A vendor
-- price changes, and when it does every past row silently re-prices itself to whatever the variable
-- says today. `billed` already records WHETHER PSP charged (§8 — on Success, Partial and Failure);
-- this records WHAT the rate was when the request was made, which is the other half of the only
-- question anyone asks of this table: does the invoice match what we bought?
--
-- Stamped at INSERT, before the vendor call, not at settle: the rate in effect at the moment we
-- decided to spend is the honest figure, and it survives a settle that never completes. Nullable,
-- because the price is genuinely unknown until PSP tells us (PSP-PLAN Q2) — and a null here reads
-- as "we were not told", which is exactly true and is what the confirmation screen also says.
alter table public.psp_requests add column if not exists unit_price_usd numeric(10,2);

comment on column public.psp_requests.unit_price_usd is
  'Rate in USD in effect when the request was made, from PSP_UNIT_PRICE_USD. NULL = the price was not configured (Q2). Amount charged = unit_price_usd when billed, else 0.';

-- ── 2. THE SOURCE OF A PSP RECORD IS A CLOSED SET ──────────────────────────────────────────────
-- P9 made provenance a written field rather than a heuristic: the ordered path writes `psp_api`, the
-- import writes `portal_import`, and `pspRecordSource` answers `unknown` for anything else. That
-- reader stays defensive on purpose — a row written before this constraint genuinely does not say
-- where it came from — but there is no reason to keep ACCEPTING new rows that do not say.
--
-- The failure this closes is a typo. `detail` is jsonb, so `psp_api ` with a trailing space, or
-- `psp-api`, writes successfully and then reads as `unknown` forever, in a column that decides
-- whether a UI may render inspection counts. A CHECK makes that a write error at the moment
-- somebody can still fix it.
--
-- Scoped to the one kind: `detail` is shared by every qualification record kind and constraining
-- the others would be inventing rules for evidence this migration knows nothing about.
-- `coalesce(..., '')` rather than a bare `in`, and the reason is three-valued logic: a CHECK passes
-- when its expression evaluates to NULL, so `detail ->> 'source' in (...)` on a `detail` with no
-- `source` key is NULL, which is UNKNOWN, which ACCEPTS — the constraint would have caught the typo
-- and waved through the omission, which is the more likely mistake of the two. Written the wrong way
-- first; the behavioural matrix is what caught it ("a PSP record with NO source is refused").
alter table public.qualification_records drop constraint if exists qualification_records_psp_source_check;
alter table public.qualification_records add constraint qualification_records_psp_source_check check (
  kind <> 'psp_report'
  or coalesce(detail ->> 'source', '') in ('psp_api', 'portal_import')
);
