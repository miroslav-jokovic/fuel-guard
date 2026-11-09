-- 0577 — what each AD did, hour by hour (ADS-CREATIVE-QUALITY-PLAN CQ3, D-AD22; G-CQ3).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The monitor pulls insights at `level=campaign` into `ads_spend_hourly (campaign_id, hour)`. A campaign holds
-- one ad per approved creative per language (B2c), so the only measurement the product keeps cannot tell which
-- CONCEPT (preset) brought the leads. Plan §8 "measure which preset works for us", D-AD11's reweighting of the
-- draw and §2b's "fatigue = 2x own history" all named a per-concept figure, and nothing stored one.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- The same row as `ads_spend_hourly`, keyed by Meta's ad id and the hour, naming the creative and language the
-- publisher recorded for that ad (`ads_campaigns.platform_refs.ads[]`). The campaign and the creative are both
-- composite foreign keys, so a row can never name a creative of another campaign or another carrier. Hours are
-- the account's local wall-clock hours stored on their UTC instant, as the campaign table's are (B5a).
-- Written by the same hourly pull (`monitor/adInsightsPull.ts`), which asks Meta `level=ad` for the campaign's
-- window right after the campaign-level read; a full-row upsert on (meta_ad_id, hour), so a revised hour is
-- replaced (`lint:upserts`). A new table, so writer and table ship together (the two-merge rule is for columns).
--
-- Insights API, `level`: https://developers.facebook.com/docs/marketing-api/insights/ ("Querying a parent with
-- a lower level (for example the campaign with level=ad) returns one row per child", read 2026-11-09).
--
-- No reader yet: the per-preset fold (the daily brief's and the Campaigns tab's table) ships a merge later.
--
-- raw-access-waiver: creates the ads module's own raw table (table-modules.json: ads/raw), written only by
-- apps/api/src/modules/ads/monitor/adInsightsPull.ts (table-writers.json); no other module reads it.

create table if not exists public.ads_ad_spend_hourly (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  campaign_id  uuid not null,
  creative_id  uuid not null,
  language     text not null check (language in ('en', 'es')),
  meta_ad_id   text not null check (meta_ad_id ~ '^[0-9]{1,40}$'),
  hour         timestamptz not null check (date_trunc('hour', hour at time zone 'UTC') = hour at time zone 'UTC'),
  spend_cents  bigint not null default 0 check (spend_cents >= 0),
  impressions  bigint not null default 0 check (impressions >= 0),
  clicks       bigint not null default 0 check (clicks >= 0),
  leads        integer not null default 0 check (leads >= 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  pulled_at    timestamptz not null default now(),
  primary key (meta_ad_id, hour),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, creative_id) references public.ads_creatives (org_id, id) on delete restrict
);
alter table public.ads_ad_spend_hourly enable row level security;
create index if not exists ix_ads_ad_spend_hourly_campaign_hour on public.ads_ad_spend_hourly (org_id, campaign_id, hour);
create index if not exists ix_ads_ad_spend_hourly_creative_hour on public.ads_ad_spend_hourly (org_id, creative_id, hour);
