-- 0243: the vendor fuel statement, kept (FUEL-SPEND-RECONCILIATION-PLAN WP3, D-FR4/D-FR5)
--
-- Until now `/fuel-reconciliation` was a viewer: parse a Pilot report in the browser, show it, throw it
-- away. That answers "does this week's statement match our records" and cannot answer the question the
-- carrier actually asked — "fuel spend is going up, why" — because nothing is kept to compare against.
--
-- What the kept statements make answerable, measured on the five real 2026-07-20 → 2026-08-23 statements
-- and the June+July monthly export (13 unbroken weeks from 2026-06-01):
--   • the spend bridge — of +$58,234/week, 61.1% is the market, 20.7% more gallons, 18.1% the discount
--     compressing. A bridge computed on MONTHLY averages attributes that wrongly, which is why the
--     weekly grain is stored rather than derived later from a summary.
--   • discount capture — $24,761 below each week's own median across the five weeks.
--   • ONE9 — not one ONE9 gallon in five weeks captured a cent of discount, against $0.53–0.61/gal on
--     Pilot and Flying J. ONE9 is in `route_fuel_settings.avoid_brands`; nothing measured compliance.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY THE VENDOR'S OWN PRINTED TOTALS ARE COLUMNS
--
-- A statement checks its own arithmetic — it prints `** Customer Total`, a per-product `Customer Total`
-- and a `Savings Total`. `parsePilotStatement` must reproduce those to the cent or the upload is
-- refused (D-FR3). Storing what the vendor printed ALONGSIDE what we computed means that check stays
-- auditable for the life of the row instead of being a moment at upload time: if the parser is ever
-- changed, a re-parse can be compared against the same evidence the original passed.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY SUPERSEDE AND NOT UPDATE
--
-- Pilot reissues a statement under the same invoice number when a line is adjusted. Overwriting it
-- would silently rewrite history the discount analysis is drawn from — the exact failure the evidence
-- tables in `RETENTION_FORBIDDEN` exist to prevent. So a re-upload INSERTS a new statement and points
-- the old one at it; `uq_fuel_statements_current` keeps exactly one live row per invoice, and the
-- trigger below makes `superseded_by` / `superseded_at` the only columns an UPDATE may touch. A
-- correction is a new row, a deletion is an explicit audited act, never a side effect.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY `station_id` AND `brand` ARE ON THE LINE
--
-- The `Loc.` column is a Pilot-family store number, and joining it with `State` against `fuel_stations`
-- resolved 582 of 582 distinct site/state pairs across all five statements — 100%, no unknowns. That
-- join is what makes "how much at ONE9", "how much in California" and "how much off-network" answerable
-- at all. Resolving it ONCE at ingest and storing the result is deliberate: the statement is a
-- point-in-time fact, and a station rebranding next year must not retroactively change what last
-- August's fuel is reported as.

-- ── the statement ────────────────────────────────────────────────────────────
create table if not exists fuel_statements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  -- chain-agnostic seam: Pilot is the only vendor that direct-bills Silvicom today, but the shape of
  -- "a weekly statement with lines and printed totals" is not Pilot-specific.
  vendor            text not null default 'pilot',
  account_no        text,
  invoice_no        text not null,
  period_start      date not null,
  period_end        date not null,
  billing_date      date,

  -- what WE parsed
  total_gallons     numeric(12,2) not null default 0,
  fuel_amount       numeric(12,2) not null default 0,   -- fuel only; matches fuel_transactions.total_cost
  misc_amount       numeric(12,2) not null default 0,   -- in-store merchandise, incl. charges bundled onto a fuel ticket
  sales_tax         numeric(12,2) not null default 0,
  invoice_total     numeric(12,2) not null default 0,   -- fuel + misc + tax = what Pilot bills
  retail_total      numeric(12,2) not null default 0,
  savings           numeric(12,2) not null default 0,   -- retail_total − invoice_total, the vendor's own definition

  -- what the VENDOR printed, for the tie-out to stay auditable (see header)
  printed_units     numeric(12,2),
  printed_amount    numeric(12,2),
  printed_retail    numeric(12,2),
  printed_savings   numeric(12,2),

  line_count        int  not null default 0,
  source_format     text not null,                      -- 'pdf_statement' | 'grid_export'
  source_filename   text,
  source_path       text,                               -- object in the private 'fuel-statements' bucket
  source_sha256     text,                               -- of the bytes actually stored, computed server-side
  source_bytes      int,

  superseded_by     uuid references fuel_statements(id) on delete set null,
  superseded_at     timestamptz,
  uploaded_by       uuid references auth.users(id),
  created_at        timestamptz not null default now(),

  constraint fuel_statements_period_ordered check (period_end >= period_start),
  constraint fuel_statements_source_format  check (source_format in ('pdf_statement', 'grid_export')),
  -- superseded_by and superseded_at travel together or not at all
  constraint fuel_statements_supersede_pair check (
    (superseded_by is null and superseded_at is null) or (superseded_by is not null and superseded_at is not null)
  ),
  constraint fuel_statements_no_self_supersede check (superseded_by is null or superseded_by <> id)
);

-- Exactly one LIVE statement per invoice; superseded ones accumulate behind it without limit.
create unique index if not exists uq_fuel_statements_current
  on fuel_statements (org_id, vendor, invoice_no) where superseded_by is null;
create index if not exists idx_fuel_statements_org_period on fuel_statements (org_id, period_start desc);

-- ── its lines ────────────────────────────────────────────────────────────────
create table if not exists fuel_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  statement_id    uuid not null references fuel_statements(id) on delete cascade,
  line_number     int  not null,

  product_code    text,                                  -- Pilot's code as printed: 020, 021, 033, 140, …
  product         text,                                  -- diesel | def | other
  tank_type       text,                                  -- tractor | reefer | none  (033 is REEFER fuel)
  tran_date       date,

  card_ref        text,                                  -- last 6 of the EFS PAN, as the statement prints it
  unit_number     text,
  po_name         text,                                  -- the P.O. field; a printed name, NOT a link to drivers
  auth_no         text,
  ticket_no       text,
  odometer        numeric(10,1),                          -- keyed at the pump; cross-check only, never authoritative

  site_number     text,                                   -- Pilot-family store number, leading zeros stripped
  city            text,
  state           text,
  station_id      uuid references fuel_stations(id) on delete set null,
  brand           text,                                   -- resolved at ingest; see header

  gallons         numeric(10,3) not null default 0,
  unit_cost       numeric(8,4),
  fuel_amount     numeric(10,2),
  misc_amount     numeric(10,2),
  sales_tax       numeric(10,2),
  invoice_total   numeric(10,2),
  retail_total    numeric(10,2),

  created_at      timestamptz not null default now(),
  constraint fuel_statement_lines_tank check (tank_type is null or tank_type in ('tractor', 'reefer', 'none'))
);

create unique index if not exists uq_fuel_statement_lines_no on fuel_statement_lines (statement_id, line_number);
create index if not exists idx_fuel_statement_lines_org_date  on fuel_statement_lines (org_id, tran_date);
create index if not exists idx_fuel_statement_lines_statement on fuel_statement_lines (statement_id);
create index if not exists idx_fuel_statement_lines_brand     on fuel_statement_lines (org_id, brand, tran_date);

-- ── append-only enforcement ──────────────────────────────────────────────────
-- The supersede chain is the ONLY mutation a statement admits. Everything else about it is what the
-- vendor sent, and a number the discount analysis rests on must not be editable in place.
create or replace function fuel_statements_supersede_only() returns trigger
language plpgsql as $$
begin
  -- Once superseded, the row is frozen ENTIRELY — including re-pointing it at the same replacement,
  -- which looks idempotent but silently moves `superseded_at` and so rewrites when the correction
  -- happened. The head of the chain is the only row that can still move.
  if old.superseded_by is not null then
    raise exception 'this statement was already superseded; supersede its replacement instead'
      using errcode = 'check_violation';
  end if;
  if to_jsonb(new) - 'superseded_by' - 'superseded_at' is distinct from to_jsonb(old) - 'superseded_by' - 'superseded_at' then
    raise exception 'fuel_statements is append-only: only superseded_by/superseded_at may change (re-upload to correct a statement)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_fuel_statements_supersede_only on fuel_statements;
create trigger trg_fuel_statements_supersede_only before update on fuel_statements
  for each row execute function fuel_statements_supersede_only();

create or replace function fuel_statement_lines_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'fuel_statement_lines is immutable: re-upload the statement, which supersedes this one'
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_fuel_statement_lines_immutable on fuel_statement_lines;
create trigger trg_fuel_statement_lines_immutable before update on fuel_statement_lines
  for each row execute function fuel_statement_lines_immutable();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for org members; NO client write policy. The API writes with the service role after the parse
-- has reproduced the vendor's printed totals — a browser must not be able to assert a statement.
alter table fuel_statements      enable row level security;
alter table fuel_statement_lines enable row level security;

drop policy if exists fuel_statements_select on fuel_statements;
create policy fuel_statements_select on fuel_statements for select using (org_id = auth_org_id());

drop policy if exists fuel_statement_lines_select on fuel_statement_lines;
create policy fuel_statement_lines_select on fuel_statement_lines for select using (org_id = auth_org_id());

-- ── the source document ──────────────────────────────────────────────────────
-- The PDF the numbers came from, so a figure taken to Pilot can be traced to the document that carries
-- it. ~350 KB a week. Service-role only — no policies at all, which is deny-all for every client
-- session; originals are served through API-issued signed URLs, exactly like the `hazmat` bucket.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fuel-statements', 'fuel-statements', false, 25 * 1024 * 1024)
on conflict (id) do nothing;

-- ── link a recorded fill to the station registry (D-FR5) ─────────────────────
-- So "how much at ONE9 / off-network / in California" is answerable from the EFS feed too, not only
-- from a statement. Nullable and unbackfilled here; 0243 ships the column, not the fill.
alter table fuel_transactions add column if not exists station_id uuid references fuel_stations(id) on delete set null;
create index if not exists idx_ftxn_station on fuel_transactions (org_id, station_id, fueled_at desc);
