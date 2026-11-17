-- 0626 — Toll statements, kept as uploaded (TOLLS-PER-TRUCK-PLAN.md TL4a).
--
-- ── ONE ROW PER FILE THE OFFICE UPLOADED, BEFORE ANY READER EXISTS ─────────────────────────────
-- The weekly statements from E-ZPass, K-TAG and ExpressToll are the only record of which tag paid
-- which toll (no provider has an API, owner 2026-11-16). The readers that turn them into toll lines
-- (TL5) are written against the providers' real files, and the office hands those over through the
-- Tolls page. So this table holds the file and who uploaded it, nothing read from it yet: the period
-- and the printed total are filled when a reader reads the stored bytes, and the toll lines get their
-- own table in that step, when their columns are known from the files (Q-TL1). Owner 2026-11-17:
-- load the last six months.
--
-- The four read columns are here rather than in TL5's migration so the reader that fills them does
-- not have to ship a release after a column of its own (lint:migration-ordering).
--
-- ── A FILE IS NEVER CHANGED AND NEVER DELETED ─────────────────────────────────────────────────
-- Every per-truck toll will trace back to a line of one of these files (D-TL8), so the file and its
-- fingerprint are fixed once kept. A wrong file (another company's statement, the wrong provider
-- picked) is REMOVED: the row stays with who removed it and why, and stops counting. Uploading the
-- same bytes twice is refused while the first copy counts; after a removal it may come back, under
-- the right provider.
--
-- The bucket is private with no client policy: the API signs every upload and every read after
-- checking the caller's `accounting` section (D-TL11), and holds the arrived bytes to the size and
-- SHA-256 the browser declared before writing the row.

insert into storage.buckets (id, name, public, file_size_limit)
values ('toll-statements', 'toll-statements', false, 25 * 1024 * 1024)
on conflict (id) do nothing;

create table if not exists public.toll_statements (
  id            uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- The three accounts 0622 knows; PrePass is not tolls (owner 2026-11-16).
  provider      text not null check (provider in ('ezpass', 'ktag', 'expresstoll')),
  file_name     text not null,
  -- What the bytes are, read from them, never from the name (`tollStatementFormatOf`, D-TL5).
  format        text not null check (format in ('pdf', 'xlsx', 'ods', 'xls', 'html', 'csv')),
  byte_size     bigint not null,
  sha256        text not null,
  storage_path  text not null unique,
  uploaded_by   uuid not null,
  created_at    timestamptz not null default now(),
  -- Filled by the reader (TL5). Null means "not read yet", which the list says in words.
  period_start  date,
  period_end    date,
  printed_total numeric(12, 2),
  read_at       timestamptz,
  removed_at    timestamptz,
  removed_by    uuid,
  remove_reason text,
  constraint toll_statements_name_check check (length(btrim(file_name)) between 1 and 200 and file_name !~ '[/\\]'),
  constraint toll_statements_size_check check (byte_size between 1 and 25 * 1024 * 1024),
  constraint toll_statements_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint toll_statements_period_check check (period_start is null or period_end is null or period_start <= period_end),
  -- `remove_reason is not null` is spelled out: `length(btrim(NULL)) between 3 and 300` is NULL, and a
  -- CHECK passes NULL, so without it a removal with no reason at all is admitted (0601's version of
  -- this constraint has exactly that gap; the matrix's "a removal needs a reason" fails without it).
  constraint toll_statements_removed_together check (
    (removed_at is null and removed_by is null and remove_reason is null)
    or (removed_at is not null and removed_by is not null and remove_reason is not null and length(btrim(remove_reason)) between 3 and 300)
  )
);
create index if not exists ix_toll_statements_org on public.toll_statements (org_id, created_at desc);
-- The same file counts once. A removed copy does not block it coming back.
create unique index if not exists ux_toll_statements_file on public.toll_statements (org_id, sha256) where removed_at is null;
alter table public.toll_statements enable row level security;

-- The file and who kept it are fixed; the reader may fill the read columns; a removal is recorded once.
create or replace function public.toll_statement_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Allowed only as part of the organisation going away.
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a toll statement is removed, never deleted' using errcode = 'TS001';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.provider is distinct from old.provider
     or new.file_name is distinct from old.file_name or new.format is distinct from old.format
     or new.byte_size is distinct from old.byte_size or new.sha256 is distinct from old.sha256
     or new.storage_path is distinct from old.storage_path or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a kept toll statement is never changed' using errcode = 'TS002';
  end if;
  if old.removed_at is not null then
    raise exception 'this statement was already removed' using errcode = 'TS003';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_toll_statements_guard on public.toll_statements;
create trigger trg_toll_statements_guard before update or delete on public.toll_statements
  for each row execute function public.toll_statement_guard();
