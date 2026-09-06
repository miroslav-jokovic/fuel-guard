-- 0314: the Declines filter lists come from the data they filter (FUEL-P1, D-FUI16).
--
-- raw-access-waiver: `declined_transactions` is the fuel module's raw table and this function reads
-- it, with that module's consent, for the DISTINCT values of five columns — the same read
-- `useEfsFacets` already makes from the browser (a grandfathered raw reader in
-- check-table-access.mjs). It interprets nothing and returns no line.
--
-- The argument is 0313's and is not repeated: the hosted PostgREST caps a response at 1,000 rows, so
-- a menu deduplicated in the browser describes 1,000 of 3,479 declines. Measured 2026-09-04, that
-- costs 2 of the 19 error codes outright, and the unit menu never came from this table at all — it
-- was the fleet's roster, which is D-FUI16.
--
-- ── ONE FACET CARRIES A LABEL, AND IT IS NOT DECORATION ─────────────────────────────────────────
-- An error code is a number: "51" means nothing in a dropdown and "51 — INVALID DRIVER ID" means
-- something. The browser used to build that label from "the first non-empty description seen", which
-- depends on which 1,000 rows arrived; `min()` over the non-empty descriptions is the same idea made
-- deterministic. The 40-character truncation stays in the browser, where the menu width lives.
--
-- ── WHY THIS IS A SECOND MIGRATION RATHER THAN 0313's SECOND FUNCTION ───────────────────────────
-- The two tables belong to two different collectors (`efs_transactions` → efs,
-- `declined_transactions` → fuel, per scripts/table-modules.json). One migration touching both would
-- need a `cross-module-waiver` line and would put two collectors' consent behind one signature.
-- Splitting them costs a migration number and keeps each waiver naming exactly one owner (D-SEP1).

create or replace function decline_facets(p_org uuid default null)
returns table (facet text, value text, label text)
language sql
stable
security invoker
set search_path = public
as $$
  with cleaned as (
    select nullif(btrim(d.error_code), '')        as error_code,
           nullif(btrim(d.error_description), '') as error_description,
           nullif(btrim(d.state), '')             as state,
           nullif(btrim(d.driver_name), '')       as driver_name,
           nullif(btrim(d.policy_name), '')       as policy_name,
           nullif(btrim(d.unit), '')              as unit
      from declined_transactions d
     where d.org_id = coalesce(p_org, auth_org_id())
  )
  select 'error_code'::text, c.error_code, min(c.error_description)
    from cleaned c where c.error_code is not null group by c.error_code
  union all
  select 'state'::text,  d.state,       null::text from (select distinct state       from cleaned where state       is not null) d
  union all
  select 'driver'::text, d.driver_name, null::text from (select distinct driver_name from cleaned where driver_name is not null) d
  union all
  select 'policy'::text, d.policy_name, null::text from (select distinct policy_name from cleaned where policy_name is not null) d
  union all
  select 'unit'::text,   d.unit,        null::text from (select distinct unit        from cleaned where unit        is not null) d
$$;

comment on function decline_facets is
  'FUEL-P1 / D-FUI16 — the DISTINCT values behind the Declines filter menus (error code with its '
  'description, state, driver, policy, unit). Replaces a browser-side dedupe over a read the hosted '
  'PostgREST caps at 1,000 rows, and gives the unit menu a source that is the declines themselves '
  'rather than the fleet roster.';
