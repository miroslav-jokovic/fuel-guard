-- 0633 — What each toll statement says, line by line (TOLLS-PER-TRUCK-PLAN.md TL4b, D-TL6, D-TL8,
-- D-TL12, D-TL18).
--
-- ── EVERY ATTEMPT TO READ A STATEMENT IS KEPT ──────────────────────────────────────────────────
-- `toll_statement_reads` holds one row per attempt: `read` (the provider's reader returned every line
-- and every printed total tied to the cent) or `refused` (with the reader's sentence: which total,
-- by how much, or which line it could not name). A refusal is evidence too: it is why a statement
-- shows no tolls, and a person can see it rather than infer it. A statement has at most one `read`
-- row; a statement read wrongly is removed (0627) and uploaded again, never re-read in place, so a
-- figure that was shown once cannot change under anybody.
--
-- The API reads the bytes it stored itself (pdfjs on the server), so nothing here was taken on the
-- browser's word.
--
-- ── EVERY LINE IS KEPT, NONE IS EVER CHANGED ───────────────────────────────────────────────────
-- `toll_statement_lines` is the statement as printed: tolls, credits, account payments, tag
-- purchases, fees and adjustments (D-TL18), with the identity the provider billed (tag, or plate, or
-- ExpressToll's device heading kept apart from the line's own plate, §1.3), the plaza, the local
-- times as printed (no zone: the plaza's zone is learned in TL8a, D-TL14), the amount in integer cents
-- with its sign, and the page and position so every figure traces to the paper.
--
-- ── WHY NO TRUCK AND NO "DUPLICATE OF" COLUMN ──────────────────────────────────────────────────
-- Which truck a toll belongs to is derived at read time from the tag and plate histories (D-TL3);
-- storing it would freeze today's answer onto last April's toll. The same goes for overlap: a line
-- that appears in two kept statements counts once, and which copy counts is derived from
-- `match_key` among statements still kept. Stored, a "duplicate of" would go wrong the day the other
-- statement is removed. `match_key` carries the occurrence within the statement, so a genuine double
-- charge (two identical lines on one statement) is two lines, not one (review 2026-11-18, item 8).
--
-- ── ONE FUNCTION WRITES A READ, ALL OR NOTHING ─────────────────────────────────────────────────
-- An E-ZPass month is ~3,000 lines. Written in batches from the API, a failure halfway would leave a
-- `read` row over half a statement: the one state D-TL12's "complete" exists to rule out. So
-- `record_toll_statement_read` writes the attempt, every line and the statement's read columns in one
-- transaction, and checks what it was given: the line count matches, line positions run 0..n-1 with no
-- gap, the statement is this org's and still kept, and it has not been read already.
--
-- New tables only, so the column/first-reader rule (lint:migration-ordering) does not apply. RLS on,
-- no client policy: service-role only, like 0627.

create table if not exists public.toll_statement_reads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  statement_id  uuid not null references public.toll_statements(id) on delete cascade,
  outcome       text not null check (outcome in ('read', 'refused')),
  -- The reader's sentence for a refusal; null for a read.
  message       text,
  -- Which reader and layout read it, so a later reader change is visible in the record.
  reader        text not null check (length(btrim(reader)) between 1 and 60),
  account       text,
  period_start  date,
  period_end    date,
  -- E-ZPass "Tolls, Non-Tolls and Fees", K-TAG "Tolls", ExpressToll "Grand Total" (TL5).
  printed_charges_cents bigint,
  line_count    integer,
  -- Toll lines and their sum (credits included; payments, fees, tag sales and adjustments not), counted
  -- by the write function from the lines it stores, never taken from the caller.
  toll_line_count integer,
  toll_cents    bigint,
  -- Every printed total and what the lines added up to: [{label, printedCents, readCents}].
  ties          jsonb not null default '[]'::jsonb check (jsonb_typeof(ties) = 'array'),
  read_by       uuid not null,
  created_at    timestamptz not null default now(),
  constraint toll_statement_reads_shape check (
    (outcome = 'read' and message is null and account is not null and period_start is not null
      and period_end is not null and period_start <= period_end and printed_charges_cents is not null
      and line_count is not null and line_count >= 0 and toll_line_count is not null and toll_cents is not null)
    or (outcome = 'refused' and message is not null and length(btrim(message)) between 1 and 1000
      and line_count is null and toll_line_count is null and toll_cents is null)
  )
);
create index if not exists ix_toll_statement_reads_statement on public.toll_statement_reads (org_id, statement_id, created_at desc);
create unique index if not exists ux_toll_statement_reads_one_read on public.toll_statement_reads (statement_id) where outcome = 'read';
alter table public.toll_statement_reads enable row level security;

create table if not exists public.toll_statement_lines (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  statement_id   uuid not null references public.toll_statements(id) on delete cascade,
  read_id        uuid not null references public.toll_statement_reads(id) on delete cascade,
  line_index     integer not null check (line_index >= 0),
  kind           text not null check (kind in ('toll', 'account_payment', 'tag_purchase', 'service_fee', 'adjustment')),
  tag_number     text,
  plate          text,
  plate_state    text,
  device         text,
  agency         text,
  entry_plaza    text,
  entry_at       timestamp without time zone,
  exit_plaza     text,
  exit_at        timestamp without time zone,
  location       text,
  lane           text,
  vehicle_class  text,
  rate           text,
  posted_on      date,
  amount_cents   bigint not null,
  balance_cents  bigint,
  label          text,
  page           integer not null check (page >= 1),
  -- provider | identity | exit time | plaza | amount | occurrence within the statement (D-TL8).
  match_key      text not null check (length(match_key) between 3 and 300),
  created_at     timestamptz not null default now(),
  -- A toll names what drove: a tag or a plate. A non-toll line names neither and says what it is.
  constraint toll_statement_lines_identity check (
    (kind = 'toll' and (tag_number is not null or plate is not null) and exit_at is not null)
    or (kind <> 'toll' and tag_number is null and plate is null and label is not null)
  ),
  unique (read_id, line_index)
);
create index if not exists ix_toll_statement_lines_statement on public.toll_statement_lines (org_id, statement_id, line_index);
create index if not exists ix_toll_statement_lines_key on public.toll_statement_lines (org_id, match_key);
create index if not exists ix_toll_statement_lines_tag on public.toll_statement_lines (org_id, tag_number) where tag_number is not null;
create index if not exists ix_toll_statement_lines_plate on public.toll_statement_lines (org_id, plate) where plate is not null;
alter table public.toll_statement_lines enable row level security;

-- Reads and lines are evidence: written once by the function below, never changed, never deleted
-- except with their organisation (the statement itself is never deleted, 0627 TS001).
create or replace function public.toll_statement_evidence_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from organizations o where o.id = old.org_id) then
      raise exception 'a toll statement''s read and lines are never deleted' using errcode = 'TS101';
    end if;
    return old;
  end if;
  raise exception 'a toll statement''s read and lines are never changed' using errcode = 'TS102';
end;
$$;
revoke all on function public.toll_statement_evidence_guard() from public, anon, authenticated;

drop trigger if exists trg_toll_statement_reads_guard on public.toll_statement_reads;
create trigger trg_toll_statement_reads_guard before update or delete on public.toll_statement_reads
  for each row execute function public.toll_statement_evidence_guard();
drop trigger if exists trg_toll_statement_lines_guard on public.toll_statement_lines;
create trigger trg_toll_statement_lines_guard before update or delete on public.toll_statement_lines
  for each row execute function public.toll_statement_evidence_guard();

-- Write one attempt: a refusal (no lines), or a read with all its lines, in one transaction.
-- `p_read` keys: outcome, message, reader, account, period_start, period_end, printed_charges_cents,
-- ties. `p_lines`: an array of objects with the line columns above (line_index … match_key).
create or replace function public.record_toll_statement_read(
  p_org_id uuid, p_statement_id uuid, p_actor uuid, p_read jsonb, p_lines jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_statement public.toll_statements%rowtype;
  v_read_id uuid;
  v_count integer := coalesce(jsonb_array_length(p_lines), 0);
  v_outcome text := p_read->>'outcome';
  v_toll_count integer;
  v_toll_cents bigint;
begin
  select * into v_statement from public.toll_statements where id = p_statement_id and org_id = p_org_id for update;
  if not found then
    raise exception 'statement not found' using errcode = 'TS103';
  end if;
  if v_statement.removed_at is not null then
    raise exception 'a removed statement is not read' using errcode = 'TS104';
  end if;
  if v_outcome = 'read' and exists (select 1 from public.toll_statement_reads r where r.statement_id = p_statement_id and r.outcome = 'read') then
    raise exception 'this statement has already been read' using errcode = 'TS105';
  end if;
  if v_outcome = 'refused' and v_count <> 0 then
    raise exception 'a refused read has no lines' using errcode = 'TS106';
  end if;

  if v_outcome = 'read' then
    select count(*), coalesce(sum(l.amount_cents), 0) into v_toll_count, v_toll_cents
      from jsonb_to_recordset(p_lines) as l(kind text, amount_cents bigint) where l.kind = 'toll';
  end if;

  insert into public.toll_statement_reads (org_id, statement_id, outcome, message, reader, account, period_start,
    period_end, printed_charges_cents, line_count, toll_line_count, toll_cents, ties, read_by)
  values (p_org_id, p_statement_id, v_outcome, p_read->>'message', p_read->>'reader', p_read->>'account',
    (p_read->>'period_start')::date, (p_read->>'period_end')::date, (p_read->>'printed_charges_cents')::bigint,
    case when v_outcome = 'read' then v_count end, v_toll_count, v_toll_cents, coalesce(p_read->'ties', '[]'::jsonb), p_actor)
  returning id into v_read_id;

  if v_outcome = 'read' then
    insert into public.toll_statement_lines (org_id, statement_id, read_id, line_index, kind, tag_number, plate,
      plate_state, device, agency, entry_plaza, entry_at, exit_plaza, exit_at, location, lane, vehicle_class,
      rate, posted_on, amount_cents, balance_cents, label, page, match_key)
    select p_org_id, p_statement_id, v_read_id, l.line_index, l.kind, l.tag_number, l.plate, l.plate_state,
      l.device, l.agency, l.entry_plaza, l.entry_at, l.exit_plaza, l.exit_at, l.location, l.lane,
      l.vehicle_class, l.rate, l.posted_on, l.amount_cents, l.balance_cents, l.label, l.page, l.match_key
    from jsonb_to_recordset(p_lines) as l(line_index integer, kind text, tag_number text, plate text,
      plate_state text, device text, agency text, entry_plaza text, entry_at timestamp, exit_plaza text,
      exit_at timestamp, location text, lane text, vehicle_class text, rate text, posted_on date,
      amount_cents bigint, balance_cents bigint, label text, page integer, match_key text);
    -- Positions 0..n-1 exactly once each: a line lost or doubled between the reader and here is caught.
    if (select count(*) <> v_count or coalesce(max(line_index), -1) <> v_count - 1 or count(distinct line_index) <> v_count
        from public.toll_statement_lines where read_id = v_read_id) then
      raise exception 'the lines given do not run 0..% exactly once', v_count - 1 using errcode = 'TS107';
    end if;
    update public.toll_statements
       set period_start = (p_read->>'period_start')::date,
           period_end = (p_read->>'period_end')::date,
           printed_total = ((p_read->>'printed_charges_cents')::bigint) / 100.0,
           read_at = now()
     where id = p_statement_id and org_id = p_org_id;
  end if;
  return v_read_id;
end;
$$;
revoke all on function public.record_toll_statement_read(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
