-- 0640 — Tenstreet's application posts: each carrier's connection, and the one-year log of what arrived
-- (TENSTREET-INTAKE-PLAN TS1; ADS-PLATFORM-V2-PLAN Q-APX29 (a), ruled 2026-11-20).
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────────
-- Tenstreet can POST each applicant's application to a URL of ours (its "Receiving Application Data" guide), and
-- recruiters re-type those applicants today. The receiver (`recruiting/tenstreet/`) answers each post, keeps it,
-- and makes a lead through recruiting's one door (`ingest_lead`, channel `tenstreet`, DriverId as the reference).
--
-- ── THE CONNECTION ───────────────────────────────────────────────────────────────────────────────────
-- One per carrier. The post finds it by the secret in its URL, stored only as a SHA-256 hash (we compare, never
-- unseal); `key_hint` is its last four characters, for a person to tell keys apart. Tenstreet's `CompanyId` in the
-- body must equal `company_id` — a second check a leaked URL alone cannot pass for another carrier. `mode` is the
-- guide's TEST or PROD; a post in the other mode is refused by name. Off until a person switches it on.
--
-- ── THE LOG (the guide asks both sides to keep posts and replies a calendar year) ────────────────────
-- One row per post that reached a connection. `body_sealed` is the post AFTER the receiver removed every
-- `GovernmentID` (the SSN) and the `EqualEmploymentOpportunityData` block (D-TS4, D-TS5): those are never stored,
-- sealed or not. `removed` counts what was taken out. A post refused before a connection was found (an unknown
-- key) is not written at all: it is a stranger's body, and the answer is a bare 401.
-- Append-only except the three columns the queue job sets once (`processed_at`, `process_error`, `lead_id`) and
-- the purge, which clears the body only (`body_sealed`, set to null, `purged_at` set) — guard trigger below.
-- Pruned at 400 days (`RETENTION_RULES`: a year plus margin; 29 CFR 1602.14 and 56 Ill. Adm. Code 2520.110 hold
-- application records one year). NOT in `RETENTION_FORBIDDEN`: Q-TS9 (a) purges a post a year after receipt.
--
-- cross-module-waiver: none — recruiting's tables, written by recruiting's receiver and its job.
--
-- ⚠ DEPLOY WINDOW: two new tables; their writer ships in the same merge (new tables are exempt from the two-merge
-- rule). Old code never reads them.

create table if not exists public.tenstreet_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null unique references public.organizations(id) on delete cascade,
  company_id       text not null unique check (company_id ~ '^[0-9]{1,20}$'),
  mode             text not null default 'test' check (mode in ('test', 'prod')),
  enabled          boolean not null default false,
  key_hash         text unique check (key_hash is null or key_hash ~ '^[0-9a-f]{64}$'),
  key_hint         text check (key_hint is null or key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  rotated_at       timestamptz,
  last_post_at     timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 300),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  check ((key_hash is null) = (key_hint is null)),
  check (not enabled or key_hash is not null)
);
alter table public.tenstreet_connections enable row level security;

comment on table public.tenstreet_connections is
  'TS1 (0640): one carrier''s Tenstreet push — Company ID, TEST/PROD, on/off, the URL secret as a SHA-256 hash and its last four characters. Written by recruiting/tenstreet.';

create table if not exists public.tenstreet_posts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  connection_id    uuid not null,
  received_at      timestamptz not null default now(),
  driver_ref       text check (driver_ref is null or driver_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  mode             text check (mode is null or mode in ('TEST', 'PROD')),
  body_sha256      text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  bytes            integer not null check (bytes >= 0),
  body_sealed      text,
  removed          jsonb not null default '{}'::jsonb check (jsonb_typeof(removed) = 'object'),
  reply_status     text not null check (reply_status in ('ACCEPTED', 'REJECTED')),
  reply_reason     text not null check (reply_reason ~ '^[a-z_]{1,40}$'),
  processed_at     timestamptz,
  process_error    text check (process_error is null or length(process_error) <= 300),
  lead_id          uuid,
  purged_at        timestamptz,
  unique (org_id, id),
  foreign key (org_id, connection_id) references public.tenstreet_connections (org_id, id) on delete cascade,
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete set null (lead_id),
  -- An accepted post is kept to be processed; a refused one carries no body.
  check ((reply_status = 'ACCEPTED') = (body_sealed is not null or purged_at is not null)),
  check (purged_at is null or body_sealed is null)
);
alter table public.tenstreet_posts enable row level security;
create index if not exists ix_tenstreet_posts_org_received on public.tenstreet_posts (org_id, received_at desc);
create index if not exists ix_tenstreet_posts_unprocessed on public.tenstreet_posts (org_id, received_at) where processed_at is null and reply_status = 'ACCEPTED';

comment on table public.tenstreet_posts is
  'TS1 (0640): every Tenstreet post that reached a connection, with our reply — the body sealed AFTER the SSN and the EEO answers were removed (D-TS4/D-TS5, never stored). Append-only but for processing and the purge; pruned at 400 days.';

-- The guard: a row is what arrived and what we answered. Only processing (once) and the purge may touch it.
create or replace function public.guard_tenstreet_posts() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    return old; -- the retention job's prune at 400 days; a deletion request uses the purge (UPDATE) instead
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.connection_id is distinct from old.connection_id
     or new.received_at is distinct from old.received_at or new.driver_ref is distinct from old.driver_ref
     or new.mode is distinct from old.mode or new.body_sha256 is distinct from old.body_sha256 or new.bytes is distinct from old.bytes
     or new.removed is distinct from old.removed or new.reply_status is distinct from old.reply_status
     or new.reply_reason is distinct from old.reply_reason then
    raise exception 'tenstreet_posts: what arrived and what we answered never change' using errcode = 'TS001';
  end if;
  if old.processed_at is not null and (new.processed_at is distinct from old.processed_at
     or new.process_error is distinct from old.process_error or new.lead_id is distinct from old.lead_id) then
    raise exception 'tenstreet_posts: a processed post is final' using errcode = 'TS002';
  end if;
  if new.body_sealed is distinct from old.body_sealed and not (new.body_sealed is null and new.purged_at is not null) then
    raise exception 'tenstreet_posts: the body is only ever purged' using errcode = 'TS003';
  end if;
  if old.purged_at is not null and new.purged_at is distinct from old.purged_at then
    raise exception 'tenstreet_posts: a purge is final' using errcode = 'TS004';
  end if;
  return new;
end;
$$;

drop trigger if exists tenstreet_posts_guard on public.tenstreet_posts;
create trigger tenstreet_posts_guard before update or delete on public.tenstreet_posts
  for each row execute function public.guard_tenstreet_posts();
