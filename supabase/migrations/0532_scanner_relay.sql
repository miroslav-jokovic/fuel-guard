-- 0532 — a scanner plugged into one PC, used from any device (SCANNER-RELAY-PLAN.md step SR1;
-- D-SR1..D-SR7).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- On 2026-10-30 the Tera scanner on its cable to the office Mac was tested against a tablet: scans
-- reached only the Mac, typed into whatever window had focus — a Claude Code chat, not Silvicom. A
-- scanner in its factory mode is a keyboard for the machine it is plugged into. The owner asked for
-- the printer's shape in the other direction: the scanner stays on one PC, and any device uses it.
--
-- So the scanner is switched to its USB-COM mode, where it types nothing and is a serial port
-- (D-SR1); the print station program on that PC reads the port and sends each read up its existing
-- connection; the database routes the read to the ONE device holding the scanner at that moment
-- (D-SR3, D-SR4); that device's open page receives it as though it had been typed (D-SR6).
--
-- ── WHY THREE TABLES ────────────────────────────────────────────────────────────────────────────
-- `scanners` — one row per physical scanner the office named: which station reads it, the port its
--   operating system gave it, the port's USB ids (so a Windows COM renumbering is followed, D-SR2),
--   and the LEASE — who holds it, from which browser tab, until when (D-SR3). The lease is columns
--   on the row, not a table, because there is exactly one holder or none, and "exactly one" is then
--   a property of a row rather than an index two writers can race.
-- `scanner_reads` — every read the station sent, with the tab it was routed to (or none). The
--   device's wait for reads is a query on it; Settings' "last read — nobody was using it" is a query
--   on it. Append-only, kept 7 days (D-SR7): a diagnostic trail, not a record.
-- `print_station_ports` — what serial ports each station's operating system reports, and how its
--   reader of each assigned scanner is doing ("reading", or the error opening the port). A table
--   rather than columns on `print_stations`, because a column and its first reader must ship in two
--   merges (lint:migration-ordering) and a new table is exempt — and because it is replaced whole
--   on every hello, which is the shape of a separate row.
--
-- ── WHY THE ROUTING IS IN THE DATABASE ─────────────────────────────────────────────────────────
-- A read and a "take" can arrive in the same instant on two API processes. `scanner_record_read`
-- and `scanner_take` both lock the scanner's row, so a read lands on the holder before the take or
-- on the taker after it — never on both, never on a holder whose lease ran out a moment ago.
--
-- ── WHAT WAS REJECTED ───────────────────────────────────────────────────────────────────────────
-- * Capturing the scanner's keystrokes on the PC (keyboard mode): needs OS-level keyboard hooks and
--   still races the focused window — the 10/30 failure, automated (D-SR1).
-- * Delivering a read late: a read older than 60 s is never handed to a page (D-SR5). The API's
--   query says so; nothing here deletes it, so Settings can still show that it arrived.
-- * A composite (id, org_id) FK for "same organization": PGRST201 (0526's reason). A guard trigger.
-- * Client RLS policies: every read and write goes through the API (service role), which
--   org-filters itself. Zero policies = deny-all to browsers, on purpose.
--
-- Error codes: SR001 another org's row named; SR002 a scanner that is not this station's, or
-- retired; SR003 a read changed after it was recorded.
--
-- Rollback: drop function public.scanner_record_read(uuid, uuid, text, integer),
--           public.scanner_take(uuid, uuid, uuid, uuid, boolean);
--           drop table public.scanner_reads, public.scanners, public.print_station_ports;
--           drop function public.scanner_rows_same_org(), public.scanner_reads_append_only();

create table if not exists public.scanners (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.organizations(id) on delete cascade,
  station_id      uuid        not null references public.print_stations(id) on delete restrict,
  -- What the office calls it ("Shop scanner"), which is what "Use the office scanner" names.
  name            text        not null check (length(btrim(name)) between 1 and 80),
  -- The port the station's operating system gave it: "COM3" on Windows, "/dev/cu.usbmodem1101" on
  -- a Mac. Chosen in Settings from the station's own report, never typed.
  port_name       text        not null check (length(btrim(port_name)) between 1 and 200),
  -- The port's USB ids as the station reported them (lower-case hex), when it could. Windows can
  -- give the same scanner a new COM number in a different USB socket; the station follows these
  -- when the named port is gone and exactly one port has them (D-SR2).
  usb_vendor_id   text        check (usb_vendor_id ~ '^[0-9a-f]{4}$'),
  usb_product_id  text        check (usb_product_id ~ '^[0-9a-f]{4}$'),
  -- The lease (D-SR3). `held_session` is a random id per browser tab; `held_by` the person, for
  -- "Mia is using it"; `held_until` is renewed by the tab's own wait for reads.
  held_by         uuid        references auth.users(id) on delete set null,
  held_session    uuid,
  held_since      timestamptz,
  held_until      timestamptz,
  retired_at      timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid        references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint scanners_name_unique unique (org_id, name),
  constraint scanners_lease_whole check (
    (held_session is null) = (held_since is null) and (held_session is null) = (held_until is null)
  ),
  constraint scanners_retired_unheld check (retired_at is null or held_session is null)
);

comment on table public.scanners is
  'A physical scanner in USB-COM mode, read by one print station and held by at most one browser tab at a time (SCANNER-RELAY-PLAN.md, 0532).';

-- Two live scanners on one port is a typo: only one of them could ever read.
create unique index if not exists scanners_one_per_port
  on public.scanners (station_id, port_name) where retired_at is null;

create table if not exists public.scanner_reads (
  id                bigint      generated always as identity primary key,
  org_id            uuid        not null references public.organizations(id) on delete cascade,
  scanner_id        uuid        not null references public.scanners(id) on delete cascade,
  -- Exactly what the scanner sent, line ending removed. 200 bounds it: our longest tag is 15
  -- characters and a GS1 DataMatrix in this shop well under 100.
  code              text        not null check (length(code) between 1 and 200),
  -- When the scanner read it: the API's clock minus how long the station held it (the station
  -- reports an age, never its own clock, so a PC with the wrong time cannot age a read).
  read_at           timestamptz not null default now(),
  -- The tab it was routed to on arrival (D-SR4); null = nobody held the scanner.
  delivered_session uuid,
  delivered_to      uuid        references auth.users(id) on delete set null,
  constraint scanner_reads_delivery_whole check (delivered_session is not null or delivered_to is null)
);

comment on table public.scanner_reads is
  'Every read a station relayed, and the browser tab it was routed to (0532, D-SR4). Append-only; pruned after 7 days (D-SR7).';

create index if not exists scanner_reads_session_idx
  on public.scanner_reads (scanner_id, delivered_session, id) where delivered_session is not null;
create index if not exists scanner_reads_recent_idx on public.scanner_reads (scanner_id, id desc);
create index if not exists scanner_reads_org_time_idx on public.scanner_reads (org_id, read_at);

create table if not exists public.print_station_ports (
  station_id      uuid        primary key references public.print_stations(id) on delete cascade,
  org_id          uuid        not null references public.organizations(id) on delete cascade,
  -- [{ "name": "COM3", "label": "USB Serial Device (COM3)", "vendorId": "0581", "productId": "0215" }]
  ports           jsonb       not null default '[]'::jsonb check (jsonb_typeof(ports) = 'array'),
  -- [{ "scannerId": …, "state": "reading" | "waiting" | "failed", "portName": …, "error": … }]
  scanner_states  jsonb       not null default '[]'::jsonb check (jsonb_typeof(scanner_states) = 'array'),
  reported_at     timestamptz not null default now()
);

comment on table public.print_station_ports is
  'The serial ports a print station''s operating system reports, and how its scanner readers are doing; replaced on every hello (0532).';

-- ── SAME ORGANIZATION, SAID ONCE ────────────────────────────────────────────────────────────────
create or replace function public.scanner_rows_same_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'scanner_reads' then
    select s.org_id into v_org from public.scanners s where s.id = new.scanner_id;
  else
    select s.org_id into v_org from public.print_stations s where s.id = new.station_id;
  end if;
  if v_org is distinct from new.org_id then
    raise exception '%: the named % belongs to another organization', tg_table_name,
      case when tg_table_name = 'scanner_reads' then 'scanner' else 'station' end
      using errcode = 'SR001';
  end if;
  return new;
end;
$$;

revoke all on function public.scanner_rows_same_org() from public, anon, authenticated;

drop trigger if exists trg_scanners_same_org on public.scanners;
create trigger trg_scanners_same_org before insert or update of station_id, org_id on public.scanners
  for each row execute function public.scanner_rows_same_org();
drop trigger if exists trg_scanner_reads_same_org on public.scanner_reads;
create trigger trg_scanner_reads_same_org before insert on public.scanner_reads
  for each row execute function public.scanner_rows_same_org();
drop trigger if exists trg_print_station_ports_same_org on public.print_station_ports;
create trigger trg_print_station_ports_same_org before insert or update of station_id, org_id on public.print_station_ports
  for each row execute function public.scanner_rows_same_org();

-- ── A READ IS WHAT ARRIVED, AND WHERE IT WENT ──────────────────────────────────────────────────
-- Applies to the service role too (0161's reasoning): rewriting where a read was routed would make
-- "did the scan reach my tablet?" unanswerable. Deletion stays open — retention (D-SR7) and an
-- organization's cascade.
create or replace function public.scanner_reads_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'scanner read % is fixed once recorded', old.id using errcode = 'SR003';
end;
$$;

revoke all on function public.scanner_reads_append_only() from public, anon, authenticated;

drop trigger if exists trg_scanner_reads_append_only on public.scanner_reads;
create trigger trg_scanner_reads_append_only before update on public.scanner_reads
  for each row execute function public.scanner_reads_append_only();

-- ── HOUSEKEEPING EVERY TENANT TABLE CARRIES ─────────────────────────────────────────────────────
drop trigger if exists trg_scanners_org_immutable on public.scanners;
create trigger trg_scanners_org_immutable before update on public.scanners
  for each row execute function public.forbid_org_change();
drop trigger if exists trg_print_station_ports_org_immutable on public.print_station_ports;
create trigger trg_print_station_ports_org_immutable before update on public.print_station_ports
  for each row execute function public.forbid_org_change();
drop trigger if exists trg_scanners_updated on public.scanners;
create trigger trg_scanners_updated before update on public.scanners
  for each row execute function public.set_updated_at();

-- Spelled out rather than looped: check-rls.mjs reads the statement, and so does a reviewer.
alter table public.scanners enable row level security;
alter table public.scanner_reads enable row level security;
alter table public.print_station_ports enable row level security;

-- ── THE STATION'S CALL: RECORD A READ AND ROUTE IT ─────────────────────────────────────────────
-- Service-role only: the API resolves the station from its token, then calls this with its id.
-- Refuses a scanner that is not this station's, or retired (SR002) — a station's token must never
-- put reads on another station's scanner. Locks the scanner's row, so the holder it reads is the
-- holder at this instant (the header's reason). `p_age_ms` is how long the station held the read
-- before sending it, capped at the 30 s the station may hold one (D-SR5). Also the heartbeat.
create or replace function public.scanner_record_read(p_station uuid, p_scanner uuid, p_code text, p_age_ms integer)
returns table (read_id bigint, delivered boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_scanner public.scanners;
  v_session uuid;
  v_user uuid;
  v_id bigint;
begin
  select s.* into v_scanner from public.scanners s where s.id = p_scanner for update;
  if v_scanner.id is null or v_scanner.station_id is distinct from p_station or v_scanner.retired_at is not null then
    raise exception 'scanner % is not a live scanner of this station', p_scanner using errcode = 'SR002';
  end if;

  update public.print_stations st set last_seen_at = now()
   where st.id = p_station and st.revoked_at is null and st.token_hash is not null;

  if v_scanner.held_until > now() then
    v_session := v_scanner.held_session;
    v_user := v_scanner.held_by;
  end if;

  insert into public.scanner_reads (org_id, scanner_id, code, read_at, delivered_session, delivered_to)
  values (
    v_scanner.org_id, v_scanner.id, p_code,
    now() - make_interval(secs => least(greatest(coalesce(p_age_ms, 0), 0), 30000) / 1000.0),
    v_session, case when v_session is null then null else v_user end
  )
  returning id into v_id;

  return query select v_id, v_session is not null;
end;
$$;

-- ── A TAB'S CALL: TAKE, OR RENEW, THE LEASE ────────────────────────────────────────────────────
-- One function for both, because a renewal IS a take by the tab that already holds it. Outcomes:
--   'taken'   — this tab holds it until `held_until` (renewed if it already did);
--   'held'    — another tab holds a live lease and `p_force` was false; `holder` says who;
--   'retired' — the scanner was retired; nobody can hold it;
--   'missing' — no such scanner in this organization.
-- `held_since` survives a renewal, so Settings can say "since 9:14".
create or replace function public.scanner_take(p_org uuid, p_scanner uuid, p_user uuid, p_session uuid, p_force boolean)
returns table (outcome text, holder uuid, held_until timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_scanner public.scanners;
  v_until timestamptz := now() + interval '90 seconds';
  v_mine boolean;
begin
  select s.* into v_scanner from public.scanners s where s.id = p_scanner and s.org_id = p_org for update;
  if v_scanner.id is null then
    return query select 'missing'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_scanner.retired_at is not null then
    return query select 'retired'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- "This tab" is the tab id AND the person: a tab id is not a secret worth trusting alone, so
  -- another person presenting it is somebody else asking, not the holder renewing.
  v_mine := v_scanner.held_session = p_session and v_scanner.held_by is not distinct from p_user;
  if v_scanner.held_until > now() and not coalesce(v_mine, false) and not coalesce(p_force, false) then
    return query select 'held'::text, v_scanner.held_by, v_scanner.held_until;
    return;
  end if;

  update public.scanners s
     set held_by = p_user,
         held_session = p_session,
         held_since = case when coalesce(v_mine, false) and v_scanner.held_until > now()
                           then v_scanner.held_since else now() end,
         held_until = v_until
   where s.id = p_scanner;

  return query select 'taken'::text, p_user, v_until;
end;
$$;

revoke all on function public.scanner_record_read(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.scanner_take(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
