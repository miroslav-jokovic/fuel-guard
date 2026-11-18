-- 0630 — the BLS wage figures a campaign's plan may cite as market evidence (ADS-PLATFORM-V2-PLAN V2r, D-AD35).
--
-- ── WHY A TABLE ──────────────────────────────────────────────────────────────────────────────────────
-- The plan's market items are read by code from the Bureau of Labor Statistics' public data API, not by a model
-- and not from a page (`bls.gov`'s pages answer 403 to a server; measured 2026-11-18). Without a key that API
-- allows 25 requests a day from one address, and every carrier's planning would ask it the same eight series
-- (four measures for the nation, four for a state). OEWS figures are published once a year, so each answer is
-- kept here and asked again only after 30 days (`apps/api/src/modules/ads/plan/marketWages.ts`).
--
-- ── WHY NO org_id ────────────────────────────────────────────────────────────────────────────────────
-- These are public federal statistics, the same for every carrier — `weather_cache` (0049) is the precedent: a
-- global cache read and written by the service role only. No carrier writes it and none of its rows is anyone's.
--
-- ── value IS NULLABLE ON PURPOSE ─────────────────────────────────────────────────────────────────────
-- BLS withholds a figure it cannot publish for an area; the API then answers the series with no data. That
-- answer is kept as a row with no value, so a withheld series is not asked again every planning — and the
-- evidence writes no item for an area missing a measure (`marketEvidence`).
create table if not exists public.ads_market_wages (
  series_id  text        primary key check (series_id ~ '^OEU[NS][0-9]{21}$'),
  year       integer     check (year between 1997 and 2100),
  value      numeric(12, 2) check (value is null or value > 0),
  fetched_at timestamptz not null default now(),
  check ((value is null) = (year is null))
);

comment on table public.ads_market_wages is
  'BLS OEWS wage figures for heavy and tractor-trailer truck drivers, cached for the ads planner''s market evidence (ADS-PLATFORM-V2-PLAN D-AD35). Global public data; service role only.';

-- Server-only, as weather_cache: the API reads and writes with the service role; no member reads it.
alter table public.ads_market_wages enable row level security;
