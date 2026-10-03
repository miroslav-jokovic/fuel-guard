-- 0416: the two sums Buy discipline grades its fuel targets from, added up in the database (Q-FSV16)
--
-- Buy discipline's on-network share and its avoided-state gallons are sums over tractor fuel by brand,
-- state and month. The page got them by downloading every `fuel_spend_lines` row for the window —
-- 5,866 rows on production, six sequential PostgREST pages at about 1.5 s each under row-level
-- security — and adding them up in the browser: roughly nine seconds of an empty page, measured
-- 2026-10-03. As the service role the same rows take about 0.25 s, so the cost is the transfer and the
-- per-page policy check, not the arithmetic. (`docs/plans/fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md`
-- §4 Q-FSV16.)
--
-- ── SQL RETURNS A MEASUREMENT, TS OWNS THE VERDICT ──────────────────────────────────────────────
-- What this returns carries NO policy: not the preferred brands, not the avoided states, not a target.
-- Those live in `route_fuel_settings` and are compared by `gradePolicyTargets` in `@silvicom/shared`,
-- which is where the rule "an unresolved station counts as off-network" is written once. Putting the
-- brand list in here would be a second copy of it with a delay fuse. So the function answers "how many
-- tractor gallons were bought, in which month, at which brand, in which state", and TypeScript decides
-- which of those cells are on-network and which state is avoided.
--
-- ── IT READS `fuel_spend_lines`, IT DOES NOT RE-DERIVE IT ───────────────────────────────────────
-- The brand join, the station-local business date and the one-quote-per-fill rule are `fuel_spend_lines`'
-- (0246–0248, 0405). A second path to the same numbers would let the month a fill lands in drift from
-- the month the rest of the page shows it in. The filter is `isTractorFuel`'s, spelled in SQL: tractor
-- tank, gallons above zero, a net amount present. A fill with no cost is not fuel the share can speak
-- for, and TS drops it the same way.
--
-- ── SCOPE ───────────────────────────────────────────────────────────────────────────────────────
-- `security invoker`, `p_org` last and defaulted, passed straight through to `fuel_spend_lines`, which
-- does the `coalesce(p_org, auth_org_id())`. A browser passes nothing and is scoped by its own JWT;
-- `apps/api` must pass an org because the service role bypasses RLS; a caller that does neither gets
-- null, which equals no org, which returns no rows (D-FC1, 0247).
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────────────────────────
-- A new function, so by `lint:migration-ordering` its first reader ships in a LATER merge: Railway can
-- serve a merge before this migration is applied, and a reader that calls a function that is not there
-- yet takes the page down for the gap. Nothing calls it in this change.
--
-- raw-access-waiver: reads `fuel_spend_lines` only, never a table directly.

create function fuel_policy_gallons(
  p_from date,
  p_to date,
  p_vehicles uuid[] default null,
  p_org uuid default null
)
returns table (
  -- `YYYY-MM` of the station-local business date, the month `avoidedStateByMonth` buckets by.
  month text,
  -- Null when the station could not be matched to a brand; kept as its own row, because TS counts it
  -- off-network and reports it as `unresolvedPct`.
  brand text,
  state text,
  gallons numeric,
  fills int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(l.tran_date, 'YYYY-MM') as month,
    l.brand,
    l.state,
    sum(l.gallons)                  as gallons,
    count(*)::int                   as fills
  from fuel_spend_lines(p_from, p_to, p_vehicles, p_org) l
  where l.tank = 'tractor'
    and l.gallons > 0
    and l.net_amount is not null
  group by 1, 2, 3
  order by 1, 2 nulls last, 3 nulls last;
$$;

revoke all on function fuel_policy_gallons(date, date, uuid[], uuid) from public, anon, authenticated;
grant execute on function fuel_policy_gallons(date, date, uuid[], uuid) to authenticated, service_role;
