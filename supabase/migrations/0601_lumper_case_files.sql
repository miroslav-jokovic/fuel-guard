-- 0601 — Lumper cases: the revised rate confirmation, filed on the case.
--
-- LUMPER-REVISED-RC-PLAN.md step LRC3, D-LRC3: "the revised RC is received only when its file is on
-- the case. No tick-box without a document." McLeod holds this fact nowhere (plan §1.3), so this
-- table IS the record that the broker's revised RC arrived: who filed it, when, and the file itself.
--
-- A filed paper is never changed and never deleted. A wrong file (the original RC, another load's
-- paper) is REMOVED: the row stays, with who removed it and why, and stops counting. So "the RC was on
-- file on the day we invoiced" can still be answered after somebody tidies up.
--
-- The bucket is private with no client policy: the API signs every upload and every read, after
-- checking the caller may see lumper cases, and checks the bytes that arrived against what the
-- browser said it was sending before the row is written.

insert into storage.buckets (id, name, public, file_size_limit)
values ('lumper-files', 'lumper-files', false, 25 * 1024 * 1024)
on conflict (id) do nothing;

create table if not exists public.lumper_case_files (
  id            uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  case_id       uuid not null references public.lumper_cases(id) on delete cascade,
  kind          text not null default 'revised_rc' check (kind in ('revised_rc')),
  file_name     text not null,
  mime          text not null,
  byte_size     bigint not null,
  sha256        text not null,
  storage_path  text not null unique,
  uploaded_by   uuid not null,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,
  removed_by    uuid,
  remove_reason text,
  constraint lumper_case_files_name_check check (length(btrim(file_name)) between 1 and 200 and file_name !~ '[/\\]'),
  constraint lumper_case_files_size_check check (byte_size between 1 and 25 * 1024 * 1024),
  constraint lumper_case_files_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint lumper_case_files_mime_check check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint lumper_case_files_removed_together check (
    (removed_at is null and removed_by is null and remove_reason is null)
    or (removed_at is not null and removed_by is not null and length(btrim(remove_reason)) between 3 and 300)
  )
);
create index if not exists ix_lumper_case_files_case on public.lumper_case_files (org_id, case_id);
alter table public.lumper_case_files enable row level security;

-- The paper itself is fixed once filed; only its removal can be recorded, once.
create or replace function public.lumper_case_file_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Allowed only as part of the case (and so the organisation) going away.
    if exists (select 1 from lumper_cases c where c.id = old.case_id) then
      raise exception 'a filed revised RC is removed, never deleted' using errcode = 'LR001';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.case_id is distinct from old.case_id
     or new.kind is distinct from old.kind or new.file_name is distinct from old.file_name or new.mime is distinct from old.mime
     or new.byte_size is distinct from old.byte_size or new.sha256 is distinct from old.sha256
     or new.storage_path is distinct from old.storage_path or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a filed revised RC is never changed' using errcode = 'LR002';
  end if;
  if old.removed_at is not null then
    raise exception 'this file was already removed' using errcode = 'LR003';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lumper_case_files_guard on public.lumper_case_files;
create trigger trg_lumper_case_files_guard before update or delete on public.lumper_case_files
  for each row execute function public.lumper_case_file_guard();

-- A file belongs to a case of the same organisation.
create or replace function public.lumper_case_file_place() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from lumper_cases c where c.id = new.case_id and c.org_id = new.org_id) then
    raise exception 'no such lumper case in this organisation' using errcode = 'LR004';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lumper_case_files_place on public.lumper_case_files;
create trigger trg_lumper_case_files_place before insert on public.lumper_case_files
  for each row execute function public.lumper_case_file_place();
