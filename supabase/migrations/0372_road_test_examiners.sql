-- 0372: road_test_examiners — who may sign a §391.31 road test, with the signature the office adds
-- for them (ROAD-TEST-PLAN.md RT0; the owner's ruling on Q-RT2, 2026-09-25).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- §391.31(d)–(f) want the road-test form and certificate SIGNED by the examiner, with their title and
-- organization. The carrier's examiner, Arvidera Gakhal (Maintenance manager), has signed on paper
-- until now and has no Silvicom 360 account. The owner ruled Q-RT2: *"We can add his signature … from
-- our dashboard, he was signing in manually on paper before."* So the signature is kept once, by the
-- office, and printed on each road test he gives.
--
-- ── WHY THIS SHAPE ───────────────────────────────────────────────────────────────────────────────
-- · Append-only, except retirement. A new title, a new signature or a correction is a NEW row and
--   the old one is retired; nothing is edited. A filed road test names the examiner row it printed,
--   so the signature and title on a document can always be traced to the row that supplied them.
-- · `signature_path` is the object in the documents bucket; the API stores it under the org's own
--   prefix, and the CHECK below refuses any other, so one carrier's examiner can never print a
--   signature file from another's folder.
-- · `created_by` records WHO added the signature. The office adds it on the examiner's behalf (the
--   ruling above), so each filed road test also records the user who recorded it; together they say
--   whose judgement it is and who put it on the document.
-- · Retired rows stay: a road test filed in 2026 must still resolve its examiner in 2030.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- On, with no client policy: deny-all on purpose. The office reads and writes it through the API
-- with the service role, which org-filters itself.
--
-- ⚠ No reader in this merge. Railway serves code ~2m44s before `migrate.yml` applies the schema, so
-- the API and screen that use this table ship in the next merge (RT3).

create table if not exists road_test_examiners (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  full_name       text not null
                    constraint road_test_examiners_name_check check (length(btrim(full_name)) between 2 and 120),
  -- §391.31(f): the certificate prints the examiner's title.
  title           text not null
                    constraint road_test_examiners_title_check check (length(btrim(title)) between 2 and 80),
  signature_path  text not null,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  retired_at      timestamptz,
  retired_by      uuid references auth.users(id),

  constraint road_test_examiners_signature_org_check
    check (signature_path like org_id::text || '/examiners/%'),
  constraint road_test_examiners_retired_check
    check ((retired_at is null) = (retired_by is null))
);

create index if not exists idx_road_test_examiners_org_live
  on road_test_examiners (org_id) where retired_at is null;

alter table road_test_examiners enable row level security;

create or replace function road_test_examiners_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'road_test_examiners is append-only: an examiner is retired, never deleted'
      using errcode = 'RT010';
  end if;
  -- UPDATE: retirement, once, and nothing else.
  if old.retired_at is not null then
    raise exception 'a retired examiner cannot be changed'
      using errcode = 'RT011';
  end if;
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.full_name is distinct from old.full_name
     or new.title is distinct from old.title
     or new.signature_path is distinct from old.signature_path
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'an examiner is never edited: add a new one and retire this one'
      using errcode = 'RT011';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_road_test_examiners_guard on road_test_examiners;
create trigger trg_road_test_examiners_guard
  before update or delete on road_test_examiners
  for each row execute function road_test_examiners_guard();
