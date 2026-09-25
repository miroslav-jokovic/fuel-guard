-- 0374: the driver handbook, signed on screen — Representatives, handbook marks, and the two
-- invitation stamps the handbook ceremony needs (HANDBOOK-SIGNING-PLAN.md HB0; D-HB1..D-HB5, the
-- owner's rulings of 2026-09-25).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The carrier's DRIVER HANDBOOK carries five signature blocks for the driver and one countersignature
-- for Silvicom Inc (block 4, `Agreed:`). The owner ruled it is signed on screen like the application,
-- as its own step AFTER the application is signed and BEFORE the hire (D-HB1), and that the carrier's
-- signature comes from a managed list of Representatives (D-HB3).
--
-- ── WHY A SECOND MARKS TABLE, NOT application_packet_marks ───────────────────────────────────────
-- `record_packet_mark` raises DR033 once `submitted_at` is set, and that is right: a filed packet is
-- closed. The handbook is signed after it is filed, so it cannot ride on that table without opening
-- the packet again. `handbook_marks` is its own ledger, guarded by the inverse condition: a handbook
-- mark is refused UNTIL the application is filed.
--
-- ── WHY THIS SHAPE ───────────────────────────────────────────────────────────────────────────────
-- · `carrier_representatives` follows `maintenance_inspectors` (0280), because the owner named it:
--   rows are added and deleted, and a delete is refused by `on delete restrict` once a handbook mark
--   names the Representative. A row is never EDITED (HB010): a new title or signature is a new row,
--   so a filed handbook's countersignature always traces to the row that supplied it. Its signature
--   PNG must sit in the row's own org folder, as 0372's does.
-- · `handbook_marks`: one row per signed place (`placement_id`, validated in TypeScript against the
--   placement list generated from the carrier's .docx, as the packet's are), the text version signed
--   (`handbook_version`, a hash of the source), and for the carrier's place the Representative and
--   the office user who applied it. Append-only (HB011). Unique per (invitation, place): a second
--   signature on the same line is HB-refused by the index, not by a race.
-- · The guard trigger (HB020..HB024) holds the order in the database, where no client can skip it:
--   the application is filed, handbook signing is open, and the handbook is not yet filed.
-- · Two stamps on `application_invitations`: `handbook_signing_opened_at/_by` (the office's act, like
--   AF5's `signing_opened_at`), and `handbook_filed_at` (set once the PDF and the record are filed,
--   which closes the ledger). CHECKs keep them in order.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- On for both tables, with no client policy: deny-all on purpose. The API reads and writes them with
-- the service role and org-filters itself.
--
-- ⚠ No reader in this merge. Railway serves code ~2m44s before `migrate.yml` applies the schema, so
-- the API and screens that use this ship in the next merge (HB1–HB5), after this is in production.

-- ── 1. Representatives ───────────────────────────────────────────────────────────────────────────
create table if not exists carrier_representatives (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  full_name       text not null
                    constraint carrier_representatives_name_check check (length(btrim(full_name)) between 2 and 120),
  title           text not null
                    constraint carrier_representatives_title_check check (length(btrim(title)) between 2 and 80),
  signature_path  text not null,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),

  constraint carrier_representatives_signature_org_check
    check (signature_path like org_id::text || '/representatives/%')
);

create index if not exists idx_carrier_representatives_org on carrier_representatives (org_id);

alter table carrier_representatives enable row level security;

create or replace function carrier_representatives_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a representative is never edited: add a new one and delete this one'
    using errcode = 'HB010';
end;
$$;

drop trigger if exists trg_carrier_representatives_guard on carrier_representatives;
create trigger trg_carrier_representatives_guard
  before update on carrier_representatives
  for each row execute function carrier_representatives_guard();

-- ── 2. The invitation's handbook stamps ──────────────────────────────────────────────────────────
alter table application_invitations
  add column if not exists handbook_signing_opened_at timestamptz,
  add column if not exists handbook_signing_opened_by uuid references auth.users(id),
  add column if not exists handbook_filed_at timestamptz;

alter table application_invitations drop constraint if exists application_invitations_handbook_order_check;
alter table application_invitations add constraint application_invitations_handbook_order_check check (
  -- Opened only after the application is filed (D-HB1), by somebody, and filed only once opened.
  (handbook_signing_opened_at is null or submitted_at is not null)
  and ((handbook_signing_opened_at is null) = (handbook_signing_opened_by is null))
  and (handbook_filed_at is null or handbook_signing_opened_at is not null)
);

-- ── 3. The marks ─────────────────────────────────────────────────────────────────────────────────
create table if not exists handbook_marks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  invitation_id      uuid not null references application_invitations(id) on delete cascade,
  placement_id       text not null
                       constraint handbook_marks_placement_check check (placement_id ~ '^h[0-9]+[a-z]?$'),
  party              text not null
                       constraint handbook_marks_party_check check (party in ('driver', 'carrier')),
  handbook_version   text not null
                       constraint handbook_marks_version_check check (length(handbook_version) between 8 and 80),
  signed_name        text not null
                       constraint handbook_marks_name_check check (length(btrim(signed_name)) between 1 and 200),
  -- The sentence the signer affirmed at this place, as it was shown — the packet's discipline.
  affirmed           text not null
                       constraint handbook_marks_affirmed_check check (length(btrim(affirmed)) >= 1),
  representative_id  uuid references carrier_representatives(id) on delete restrict,
  recorded_by        uuid references auth.users(id),
  signed_at          timestamptz not null default now(),
  signed_ip          inet,
  signed_user_agent  text,
  created_at         timestamptz not null default now(),

  -- The carrier's place names the Representative AND the office user who applied the signature (the
  -- Q-RT2 pattern). The driver's place names neither.
  constraint handbook_marks_carrier_check check (
    (party = 'carrier') = (representative_id is not null)
    and (party = 'carrier') = (recorded_by is not null)
  )
);

create unique index if not exists uq_handbook_marks_place on handbook_marks (invitation_id, placement_id);
create index if not exists idx_handbook_marks_org_invitation on handbook_marks (org_id, invitation_id);

alter table handbook_marks enable row level security;

create or replace function handbook_marks_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP <> 'INSERT' then
    raise exception 'handbook_marks is append-only' using errcode = 'HB011';
  end if;

  select org_id, expires_at, revoked_at, submitted_at, handbook_signing_opened_at, handbook_filed_at
    into inv
    from application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'handbook_invitation_not_found' using errcode = 'HB020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'handbook_invitation_unusable' using errcode = 'HB021';
  end if;
  if inv.submitted_at is null then
    raise exception 'handbook_application_not_filed' using errcode = 'HB022';
  end if;
  if inv.handbook_signing_opened_at is null then
    raise exception 'handbook_signing_not_opened' using errcode = 'HB023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'handbook_already_filed' using errcode = 'HB024';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_handbook_marks_insert_guard on handbook_marks;
create trigger trg_handbook_marks_insert_guard
  before insert on handbook_marks
  for each row execute function handbook_marks_guard();

drop trigger if exists trg_handbook_marks_append_only on handbook_marks;
create trigger trg_handbook_marks_append_only
  before update or delete on handbook_marks
  for each row execute function handbook_marks_guard();
