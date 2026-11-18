-- 0632 — the swipe file: competitors' job pages and ad pictures a recruiter saved, and what the Researcher read
-- from each (ADS-PLATFORM-V2-PLAN V2r, D-AD36).
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────────
-- A campaign's plan is written from evidence (0606). Two of its six kinds had no builder (audit 2026-11-18, A-5):
-- `swipe` (ads a recruiter saved) and the Researcher's `market` items. A first campaign was planned from the job
-- and one benchmark. This table is where a person names the pages and pictures the Researcher may read: the
-- Researcher never searches and never follows a link, so every source it reads is a row here.
--
-- ── ONE ROW, READ IN PLACE ───────────────────────────────────────────────────────────────────────────
-- An entry is saved `waiting`; the read job (`ads_swipe_read`) writes its reading onto the row and moves it to
-- `read` or `unreadable`. "Read again" is a new attempt (`read_attempt`), so the model call's idempotency key
-- (`swipe:<id>:<attempt>`) is new and the ledger (`ad_generations`, via `generation_id`) keeps every call.
-- A stored plan copies the evidence it was written from (0606 `evidence`), so a later re-read or removal never
-- changes a plan a person approved.
--
-- ── REMOVED, NOT DELETED ─────────────────────────────────────────────────────────────────────────────
-- `ADS_AUTHORITY.delete_anything` is "never". A person removes an entry (`archived_at`); it then stays out of every
-- new pack, and the row remains for what was read from it.
--
-- ── A PAGE OR A PICTURE ──────────────────────────────────────────────────────────────────────────────
-- A page carries its https address; a picture carries the stored asset it was accepted as (`ad-assets`, by sha256,
-- the brand-kit upload road). `page_sha256` is the hash of the text the Researcher was handed, so what a quote was
-- checked against can be named later.
create table if not exists public.ads_swipe_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  kind           text not null check (kind in ('page', 'picture')),
  url            text check (url is null or (url ~ '^https://' and length(url) <= 2000)),
  asset          jsonb check (asset is null or jsonb_typeof(asset) = 'object'),
  note           text check (note is null or length(btrim(note)) between 1 and 300),
  state          text not null default 'waiting' check (state in ('waiting', 'read', 'unreadable')),
  read_attempt   integer not null default 1 check (read_attempt >= 1),
  -- Validated by the shared contract (`swipeFile.ts`) before it is written: a page's kept items, or a picture's reading.
  reading        jsonb check (reading is null or jsonb_typeof(reading) in ('array', 'object')),
  dropped        jsonb not null default '[]'::jsonb check (jsonb_typeof(dropped) = 'array'),
  page_sha256    text check (page_sha256 is null or page_sha256 ~ '^[0-9a-f]{64}$'),
  generation_id  uuid,
  last_error     text check (last_error is null or length(last_error) <= 2000),
  read_at        timestamptz,
  created_by     uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz,
  unique (org_id, id),
  check ((kind = 'page' and url is not null and asset is null) or (kind = 'picture' and url is null and asset is not null)),
  check ((state = 'read') = (reading is not null)),
  check ((state = 'waiting') = (read_at is null)),
  foreign key (org_id, generation_id) references public.ad_generations (org_id, id) on delete restrict
);

-- The pack reads an org's live, read entries; the screen lists an org's entries newest first.
create index if not exists ads_swipe_entries_org_created on public.ads_swipe_entries (org_id, created_at desc);

comment on table public.ads_swipe_entries is
  'Competitor job pages and ad pictures a recruiter saved, and what the ads Researcher read from each (ADS-PLATFORM-V2-PLAN V2r, D-AD36).';

-- No client policy: every read and write goes through the API, which org-filters each query (deny-all on purpose).
alter table public.ads_swipe_entries enable row level security;
