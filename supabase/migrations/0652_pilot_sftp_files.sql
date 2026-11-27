-- 0652 — the record of every file the API has taken from Pilot's SFTP drop (PILOT-SFTP-FEED-PLAN §4).
--
-- ── WHAT CHANGED AT PILOT ────────────────────────────────────────────────────────────────────────────
-- On 2026-11-25 Pilot (Ally) set up SFTP delivery for account 139445: the daily Price Quote and a daily
-- Transaction file. Both replace things that today arrive by email (the 48-hour quote link, 0635; the weekly
-- bill, 0644) — the owner called the emailed invoice layout temporary on 2026-11-24. Pilot filters the port by
-- IP; production and staging were allowed the same day, and a real login from staging listed an empty root.
--
-- ── WHY THE FILE ITSELF IS KEPT ──────────────────────────────────────────────────────────────────────
-- Nobody at Silvicom has seen a Transaction file yet: the first was due 2026-11-26 and the root was still empty
-- that morning (0 entries, measured from the office). So the pull is built before the reader, and a file it has
-- no reader for must not be lost while one is written — Pilot does not say how long a file stays on its server.
-- Every file is copied, byte for byte, into the private `pilot-sftp` bucket before anything reads it, and its
-- row says `held` until a reader exists. When one lands, the code's reader version moves past the row's and the
-- next run reads the kept copy; nothing has to be fetched from Pilot again.
--
-- ── WHY ONE ROW UPDATED IN PLACE ─────────────────────────────────────────────────────────────────────
-- A work record, like 0635 and 0644, not evidence: what a file says is kept where its reader puts it (prices in
-- `fuel_prices` under the quote's Effective Date). A re-read updates the row (`attempts`, `reader_version`).
--
-- ── WHY THE KEY IS PATH + SIZE + MODIFIED TIME ───────────────────────────────────────────────────────
-- It is what a directory listing tells us without downloading, so a run that finds nothing new downloads nothing.
-- If Pilot re-sends a file under the same name with new contents, its size or time moves and it is a new row;
-- identical bytes under a second name are recognised by `file_sha256` and settle as `duplicate`.
create table if not exists public.pilot_sftp_files (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  remote_path     text not null check (length(remote_path) between 1 and 500),
  remote_size     bigint not null check (remote_size >= 0),
  remote_mtime    timestamptz not null,
  file_sha256     text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path    text check (storage_path is null or length(storage_path) between 1 and 600),
  kind            text not null check (kind in ('price_quote', 'transactions', 'unknown')),
  state           text not null check (state in ('loaded', 'held', 'refused', 'duplicate', 'failed')),
  reader_version  integer not null default 0 check (reader_version >= 0),
  attempts        integer not null default 1 check (attempts >= 1),
  effective_date  date,
  rows_loaded     integer check (rows_loaded is null or rows_loaded >= 0),
  error           text check (error is null or length(error) <= 2000),
  first_seen_at   timestamptz not null default now(),
  last_tried_at   timestamptz not null default now(),
  unique (org_id, remote_path, remote_size, remote_mtime),
  -- A file is only past `failed` once its bytes are kept, so every other state can be re-read without Pilot.
  check (state = 'failed' or (file_sha256 is not null and storage_path is not null))
);

-- The run reads an org's rows for the paths it just listed; the fuel pages list an org's newest.
create index if not exists pilot_sftp_files_org_seen on public.pilot_sftp_files (org_id, first_seen_at desc);
create index if not exists pilot_sftp_files_org_sha on public.pilot_sftp_files (org_id, file_sha256);

comment on table public.pilot_sftp_files is
  'Each file the API took from Pilot''s SFTP drop, the kept copy, and what became of it (PILOT-SFTP-FEED-PLAN).';

-- No client policy: written by the API's scheduler, read through the API, which org-filters (deny-all on purpose).
alter table public.pilot_sftp_files enable row level security;

-- ── the kept files ───────────────────────────────────────────────────────────────────────────────────
-- Service-role only — no policies at all, which is deny-all for every client session, as `fuel-statements`
-- (0243), with the same 25 MB ceiling; the run refuses a larger file before downloading it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pilot-sftp', 'pilot-sftp', false, 25 * 1024 * 1024)
on conflict (id) do nothing;
