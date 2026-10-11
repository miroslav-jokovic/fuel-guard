-- 0418: the three figures the "Paid vs Pilot quote" tile is made of, added up in the database (Q-FSV18)
--
-- The tile on Buy discipline reads "billed against contract": net dollars over or under what the Pilot
-- quote said each fill should have cost, with "N% of this window's fuel priced" beside it. Both are sums
-- over `fuel_spend_lines`, and the page got them by downloading every row of that function — 5,852 on
-- production for 90 days, six sequential PostgREST pages, each re-running the whole function under
-- row-level security — to add them up in the browser. Q-FSV16 (0416) took the same cost off the
-- policy grades; this takes it off the tile, which is what was left (plan §4 Q-FSV18).
--
-- ── WHAT THE TILE NEEDS, AND NO MORE ────────────────────────────────────────────────────────────
-- `analyzeContractCapture` computes the tile's three numbers from four sums over in-scope fills:
--
--   measured_lines     fills that carry a quote            (the tile is "unmeasured" at zero)
--   measured_paid      what EFS billed on those fills      ┐ net variance = paid − expected
--   measured_expected  "Your Price" × gallons on them      ┘
--   unmeasured_paid    what EFS billed on in-scope fills with NO quote — the rest of the denominator
--
-- and priced share = measured_paid / (measured_paid + unmeasured_paid). The per-fill list, the weekly
-- chart and the brand/site/state rollups need the rows themselves and keep reading them, but only once
-- somebody opens the tile.
--
-- ── SQL RETURNS A MEASUREMENT, TS OWNS THE VERDICT ──────────────────────────────────────────────
-- The tolerance that separates "billed at contract" from "over" (`CONTRACT_TOLERANCE_PER_GAL`), the
-- sign convention and the wording stay in `@silvicom/shared`. This function sums dollars. It does not
-- decide a fill was over, so a tolerance change cannot make the database and the page disagree.
--
-- ── NULL IS NOT ZERO, AND IT STAYS THAT WAY ─────────────────────────────────────────────────────
-- A fill with no quote is `unmeasured`, never "billed exactly at contract" (0247, D-FC3): it contributes
-- to `unmeasured_paid` and to nothing else. Counting it as measured with an expected of zero would turn
-- every unquoted dollar into a variance. `fuel_spend_lines` returns contract_amount null for it and this
-- function branches on exactly that.
--
-- ── IT READS `fuel_spend_lines`, IT DOES NOT RE-DERIVE IT ───────────────────────────────────────
-- The quote lookup (newest observation at or before the business date, bounded), the station-local date
-- and the one-quote-per-fill rule are that function's (0246–0248, 0405). A second path to the same
-- numbers is how a tile and the list under it come to disagree. "In scope" is `isInScope`'s, spelled in
-- SQL: tractor tank, gallons above zero, a net amount present.
--
-- ── ALWAYS ONE ROW ──────────────────────────────────────────────────────────────────────────────
-- An aggregate without a GROUP BY returns a row even over nothing; sums are coalesced to 0 so a window
-- with no fuel reads as zero lines and zero dollars, which the TS treats as "nothing measured" exactly as
-- it treats an empty array today.
--
-- ── SCOPE ───────────────────────────────────────────────────────────────────────────────────────
-- `security invoker`, `p_org` last and defaulted and passed straight to `fuel_spend_lines`, which does the
-- `coalesce(p_org, auth_org_id())`: a browser is scoped by its JWT, `apps/api` must pass an org, a caller
-- that does neither gets no rows (D-FC1, 0247).
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────────────────────────
-- A new function, so by `lint:migration-ordering` its reader ships in a LATER merge. Nothing calls it here.
--
-- raw-access-waiver: reads `fuel_spend_lines` only, never a table directly.

create function fuel_contract_totals(
  p_from date,
  p_to date,
  p_vehicles uuid[] default null,
  p_org uuid default null
)
returns table (
  measured_lines int,
  measured_gallons numeric,
  measured_paid numeric,
  measured_expected numeric,
  unmeasured_lines int,
  unmeasured_paid numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (count(*) filter (where l.contract_amount is not null))::int                             as measured_lines,
    coalesce(sum(l.gallons)    filter (where l.contract_amount is not null), 0)              as measured_gallons,
    coalesce(sum(l.net_amount) filter (where l.contract_amount is not null), 0)              as measured_paid,
    coalesce(sum(l.contract_amount), 0)                                                      as measured_expected,
    (count(*) filter (where l.contract_amount is null))::int                                 as unmeasured_lines,
    coalesce(sum(l.net_amount) filter (where l.contract_amount is null), 0)                  as unmeasured_paid
  from fuel_spend_lines(p_from, p_to, p_vehicles, p_org) l
  where l.tank = 'tractor'
    and l.gallons > 0
    and l.net_amount is not null;
$$;

revoke all on function fuel_contract_totals(date, date, uuid[], uuid) from public, anon, authenticated;
grant execute on function fuel_contract_totals(date, date, uuid[], uuid) to authenticated, service_role;
