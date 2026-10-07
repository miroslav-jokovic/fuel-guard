-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- ifta_fuel_receipt_uploads + ifta_fuel_receipts — driver-paid fuel the office UPLOADS for IFTA
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- IFTA-PRECISION-PLAN IP8, the owner's ruling of 2026-10-07 (D-IP7, superseding D-IP5). Two files
-- started it: a fuel-discount app's CSV of 40 fills unit 512's driver paid himself (3,397.5 gal in 14
-- states, Q3 2026, no truck number on any row) and the McLeod "Fuel Ticket Hist Listing" export of 61
-- receipts the office keyed by hand (6,094 gal, units 718 and 777 nearly all of it). Production held
-- none of either: `mcleod_fuel_tax_receipts` (0434) is empty until the McLeod VM's read grant exists.
-- The office will keep sending these as CSV or Excel files, so the file IS the entry point.
--
-- ── WHY ITS OWN TABLE, NOT `fuel_transactions` AND NOT `mcleod_fuel_tax_receipts` ──────────────
-- Not `fuel_transactions`: for the reason 0434 gives — fraud scoring, MPG intervals and the spend
-- report all assume a card fill, and a driver-paid receipt has no card. Not 0434's table: that one is
-- McLeod's raw staging, refreshed in place by the nightly sweep, so a row the office uploaded there
-- would be overwritten or orphaned by the next re-read. An upload is a different source with a
-- different life: it is what a person put in front of us, kept as they gave it.
--
-- ── EVIDENCE: VOIDED, NEVER EDITED OR DELETED ───────────────────────────────────────────────────
-- A tax-paid gallon is a credit against the carrier's IFTA liability, and an auditor can refuse a
-- credit whose record changed after the fact. So both tables are append-only by trigger: the one
-- permitted UPDATE stamps the void columns once (a wrong upload is undone by voiding it, and the
-- corrected file is a new upload), and DELETE is refused. Pinned in `RETENTION_FORBIDDEN` beside
-- the other evidence tables. `raw` keeps the file's own row verbatim so every stored figure can be
-- traced back to the cell it came from.
--
-- ── RE-UPLOADING THE SAME FILE IS HARMLESS ──────────────────────────────────────────────────────
-- `fingerprint` is the row's identity inside its source (the app's transaction id; for the McLeod
-- export, which carries placeholder invoice numbers, unit|date|state|gallons|invoice). One live row
-- per fingerprint, so the office can upload a quarter's file again with July added and only July
-- lands. A voided row frees its fingerprint, so a corrected re-upload is not refused.
--
-- Matching an upload against card fills and McLeod's own receipts is the IFTA READ's rule, in
-- `@silvicom/shared` (`foldReceiptSources`), not a constraint here — where it can be tested and
-- changed without rewriting evidence.

create table if not exists ifta_fuel_receipt_uploads (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  file_name             text not null,
  file_sha256           text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  format                text not null check (format in ('fuel_app_csv', 'mcleod_ticket_export')),
  rows_in_file          integer not null check (rows_in_file >= 0),
  rows_imported         integer not null check (rows_imported >= 0),
  rows_already_present  integer not null check (rows_already_present >= 0),
  rows_refused          integer not null check (rows_refused >= 0),
  uploaded_by           uuid references auth.users(id) on delete set null,
  uploaded_at           timestamptz not null default now(),
  voided_at             timestamptz,
  voided_by             uuid references auth.users(id) on delete set null,
  void_reason           text,
  constraint ifta_fuel_receipt_uploads_void_complete
    check ((voided_at is null) = (void_reason is null))
);

create index if not exists idx_ifta_fuel_receipt_uploads_org
  on ifta_fuel_receipt_uploads (org_id, uploaded_at desc);

create table if not exists ifta_fuel_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  upload_id         uuid not null references ifta_fuel_receipt_uploads(id) on delete restrict,
  -- Restrict, not cascade: a truck is never deleted (vehicles-status-is-restated), and if one ever
  -- were, its tax evidence must stop the delete rather than vanish with it.
  vehicle_id        uuid not null references vehicles(id) on delete restrict,
  -- How the truck was decided: the file named it, the driver's Samsara assignment on that day named
  -- it, or the person uploading picked it. Said so an auditor can ask "how do you know".
  truck_basis       text not null check (truck_basis in ('unit_in_file', 'driver_assignment', 'chosen_at_upload')),
  jurisdiction      text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  fueled_on         date not null,
  -- Station-local wall-clock time when the file has one; neither file carries a time zone.
  fueled_time_local time,
  gallons           numeric(10,3) not null check (gallons > 0),
  price_per_gal     numeric(10,4),
  amount_paid       numeric(12,2),
  fuel_type         text,
  station           text,
  city              text,
  postal_code       text,
  external_ref      text,
  unit_as_filed     text,
  driver_as_filed   text,
  fingerprint       text not null,
  raw               jsonb not null,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid references auth.users(id) on delete set null,
  void_reason       text,
  constraint ifta_fuel_receipts_void_complete check ((voided_at is null) = (void_reason is null))
);

create unique index if not exists uq_ifta_fuel_receipts_live_fingerprint
  on ifta_fuel_receipts (org_id, fingerprint) where voided_at is null;
-- The IFTA reads ask "this quarter, optionally this jurisdiction".
create index if not exists idx_ifta_fuel_receipts_period
  on ifta_fuel_receipts (org_id, fueled_on, jurisdiction) where voided_at is null;
create index if not exists idx_ifta_fuel_receipts_upload on ifta_fuel_receipts (upload_id);

-- ── APPEND-ONLY, WITH ONE WAY OUT ────────────────────────────────────────────────────────────────
-- The only UPDATE allowed sets the void stamp on a live row and touches nothing else; DELETE is
-- refused. One function for both tables: each compares the whole row minus the void columns.
create or replace function public.guard_ifta_fuel_receipts_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is append-only: void the row instead of deleting it', tg_table_name
      using errcode = 'IF010';
  end if;
  if old.voided_at is not null then
    raise exception '% row is already void: a correction is a new upload', tg_table_name
      using errcode = 'IF011';
  end if;
  if new.voided_at is null
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
        is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception '% is append-only: the only change allowed is voiding a row', tg_table_name
      using errcode = 'IF012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ifta_fuel_receipt_uploads_append_only on ifta_fuel_receipt_uploads;
create trigger trg_ifta_fuel_receipt_uploads_append_only
  before update or delete on ifta_fuel_receipt_uploads
  for each row execute function public.guard_ifta_fuel_receipts_append_only();

drop trigger if exists trg_ifta_fuel_receipts_append_only on ifta_fuel_receipts;
create trigger trg_ifta_fuel_receipts_append_only
  before update or delete on ifta_fuel_receipts
  for each row execute function public.guard_ifta_fuel_receipts_append_only();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- Service-role only: the browser reads and writes these through the ifta module's API, which
-- org-scopes every query and applies the fuel section's manage gate to an upload. No client policy
-- is deny-all, on purpose.
alter table ifta_fuel_receipt_uploads enable row level security;
alter table ifta_fuel_receipts enable row level security;
