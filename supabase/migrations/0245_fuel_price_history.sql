-- 0245: keep the daily fuel-price reports instead of throwing them away
--
-- Every 1–2 days the carrier uploads a Pilot "Better Of Pricing Report", and every upload DELETED the
-- one before it:
--
--     -- pilotPriceIngest.ts, before this migration
--     await admin.from("fuel_prices").delete().eq("org_id", orgId).eq("source", SOURCE);
--
-- The intent was sound — "no accumulation of stale nets" — but the effect was that months of daily
-- posted and net prices were destroyed on arrival. Measured 2026-08-25, `fuel_prices` held 683 rows for
-- 683 stations, `min(observed_at) = max(observed_at) = 2026-08-22`: exactly one day, the last upload.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT THE DELETION COST
--
-- Two things, and the first is the expensive one.
--
--   1. DISCOUNT CAPTURE IS UNANSWERABLE WITHOUT A RETAIL SERIES. The EFS feed records what we PAID and
--      never what was POSTED, so "how much of the pump price does our contract actually take off" has
--      no source but the vendor's weekly statement PDF — five weeks, uploaded by hand. The posted side
--      of that calculation has been arriving here every other day for months and being deleted. Kept,
--      it is a station-level daily retail series, and the question becomes answerable from the feed.
--   2. PLANNING SILENTLY LOST ITS FALLBACK. `resolveEffectivePrice` falls back to a station's price
--      HISTORY when no fresh quote exists, and `estimateStationPrice` reads these rows. With one day in
--      the table there is no history, so every station outside the newest report drops straight to a
--      brand median or to no price at all.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE TABLE WAS ALWAYS BUILT FOR THIS
--
-- 0058 created `fuel_prices` with `idx_fuel_prices_lookup (org_id, station_id, product, observed_at
-- desc)` — a time-series index — and no uniqueness constraint. Accumulation was the design; the delete
-- was a service-level decision layered on top. This migration only makes the schema say so.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FP1 — IDEMPOTENT BY (org, source, station, product, observed_at)
--
-- `observed_at` is the report's own printed "Effective Date" at noon UTC, not the upload time, so a
-- file dates itself. That is what makes re-uploading three months of reports safe in ANY order: the
-- same file lands on the same key every time and updates in place, while a new day accumulates beside
-- it. Without this key the backfill would multiply rows on every retry.
--
-- D-FP2 — THE CLIENT WRITE POLICY GOES
--
-- 0058 gave admins and fleet managers a direct INSERT/UPDATE/DELETE policy on `fuel_prices`. Every
-- comparable table since (`fuel_statements` 0243, `fuel_spend_days` 0244) is read-for-members,
-- service-role-write, because a price series that a browser session can rewrite is not evidence of
-- anything — and this one is about to become the benchmark a discount conversation with Pilot rests on.
-- The API writes it with the service role; nothing else should.

-- ── one row per report, per station, per day ─────────────────────────────────────────────────────
create unique index if not exists uq_fuel_prices_observation
  on fuel_prices (org_id, source, station_id, product, observed_at);

-- ── writes are the service role's alone (D-FP2) ──────────────────────────────────────────────────
drop policy if exists fuel_prices_write on fuel_prices;

-- ── the bounded read the Truck Stops page needs (see the function's own comment) ─────────────────
create or replace function fuel_prices_for_planning(
  p_org uuid,
  p_since timestamptz,
  p_cap int default 40,
  p_product text default 'diesel'
)
returns table (station_id uuid, net_price numeric, posted_price numeric, observed_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  -- WHY THIS EXISTS. The Truck Stops listing needs two things: the LATEST price per station, however
  -- old, and a bounded window of recent samples to estimate from. It got both by paging the whole
  -- table, which was one request while the table held a single day and becomes forty once three months
  -- of reports are kept. This returns the same rows in one round trip, capped per station rather than
  -- per response, so the cost stops growing with history.
  --
  -- `rn = 1` is unioned in deliberately: a station last priced two months ago must still show its last
  -- known price rather than vanish from the list because it fell outside the window.
  select p.station_id, p.net_price, p.posted_price, p.observed_at
  from (
    select f.station_id, f.net_price, f.posted_price, f.observed_at,
           row_number() over (partition by f.station_id order by f.observed_at desc) as rn
    from fuel_prices f
    where f.org_id = p_org and f.product = p_product
  ) p
  where p.rn = 1 or (p.rn <= p_cap and p.observed_at >= p_since)
  order by p.station_id, p.observed_at desc;
$$;

-- `security invoker` + the existing org-scoped select policy means a browser calling this sees only its
-- own carrier's prices no matter what p_org it passes. The API calls it with the service role, where
-- p_org IS the boundary — the same contract every other service query here follows.
revoke all on function fuel_prices_for_planning(uuid, timestamptz, int, text) from public;
grant execute on function fuel_prices_for_planning(uuid, timestamptz, int, text) to authenticated, service_role;
