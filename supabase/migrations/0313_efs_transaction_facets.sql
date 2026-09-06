-- 0313: the Source-records filter lists come from the data they filter (FUEL-P1, D-FUI16).
--
-- raw-access-waiver: `efs_transactions` is the efs collector's raw table and this function reads it,
-- with that collector's consent, for one purpose only — the DISTINCT values of four columns, which is
-- exactly what the browser already reads the table for today (`useEfsFacets` is a grandfathered raw
-- reader in check-table-access.mjs). Nothing here interprets a line; the alternative was a second
-- capped scan in a second place, which is what this replaces.
--
-- ── THE DEFECT, MEASURED IN PRODUCTION ON 2026-09-04 ────────────────────────────────────────────
-- `useEfsFacets` builds four filter menus by selecting rows and deduplicating them in the browser,
-- with `.limit(10_000)` on the read. That limit is a fiction. **The hosted PostgREST caps every
-- response at 1,000 rows** — checked against the live project, not inferred: a
-- `select=id&limit=5000` on this table returns exactly 1,000. So four menus over 28,638 transaction
-- lines are built from 1,000 of them, and this is what that costs:
--
--     units    133 of 190      drivers  133 of 249
--     items      9 of  13      states    42 of  47
--
-- A filter list narrower than the data behind it is worse than a missing filter: the rows are on
-- screen, the value that would isolate them is absent from the menu, and nothing says why. P1's
-- Done-when is exactly this sentence — "no filter list is narrower than the data behind it".
--
-- ── WHY SQL AND NOT A BIGGER LIMIT ──────────────────────────────────────────────────────────────
-- There is no limit that makes a client-side dedupe correct: a row cap is a server setting this code
-- does not control (the A4 finding, and the reason 0289 exists), and 28,638 rows of five columns is a
-- payload nobody wants for a dropdown. DISTINCT is the operation, and it belongs where the rows are —
-- D-FUI13, applied to a facet instead of a tile.
--
-- ── THE UNIT FACET IS THE POINT ─────────────────────────────────────────────────────────────────
-- D-FUI16: the Unit menu is built from `vehicles.unit_number`, so a unit EFS printed that the fleet
-- has no row for cannot be selected while its lines sit in the list. Measured 2026-09-04: **4 such
-- units — 696 (43 lines), T005 (6), T001 (5), T004 (2)** — 56 lines that are visible and
-- unfilterable. The browser unions this facet with the fleet's own units, so the menu covers both the
-- trucks that exist and the units that appear.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────────────────────────
-- One long-form table — `(facet, value, label)` — rather than four functions or four array columns.
-- One round trip, one place to add the fifth facet, and `label` carries the only menu text that is
-- not the value itself (it stays null here; the declines' error codes are where it earns its keep).
-- Ordering is deliberately NOT done here: the browser sorts with a numeric-aware collation so that
-- unit 9 comes before unit 10, which no SQL collation available to us reproduces.

create or replace function efs_transaction_facets(p_org uuid default null)
returns table (facet text, value text, label text)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select t.item, t.state, t.driver_name, t.unit
      from efs_transactions t
     where t.org_id = coalesce(p_org, auth_org_id())
  ),
  -- `nullif(btrim(...), '')` in one place: EFS pads its fixed-width columns, so " " and "" and null
  -- are three spellings of "this line named nothing" and all three must land outside every menu.
  cleaned as (
    select nullif(btrim(s.item), '')        as item,
           nullif(btrim(s.state), '')       as state,
           nullif(btrim(s.driver_name), '') as driver_name,
           nullif(btrim(s.unit), '')        as unit
      from scoped s
  )
  select 'item'::text,   d.item,        null::text from (select distinct item        from cleaned where item        is not null) d
  union all
  select 'state'::text,  d.state,       null::text from (select distinct state       from cleaned where state       is not null) d
  union all
  select 'driver'::text, d.driver_name, null::text from (select distinct driver_name from cleaned where driver_name is not null) d
  union all
  select 'unit'::text,   d.unit,        null::text from (select distinct unit        from cleaned where unit        is not null) d
$$;

comment on function efs_transaction_facets is
  'FUEL-P1 / D-FUI16 — the DISTINCT values behind the Source-records filter menus (item, state, '
  'driver, unit). Replaces a browser-side dedupe over a capped read: the hosted PostgREST returns at '
  'most 1,000 rows, so those menus covered 1,000 of 28,638 lines and offered 133 of 190 units '
  '(measured 2026-09-04). Returns values only — the browser sorts them, because unit 9 must precede '
  'unit 10.';
