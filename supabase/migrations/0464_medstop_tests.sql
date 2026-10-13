-- 0464: Med-Stop requests and tests — the schema half of MS2 (MEDSTOP-PLAN.md §6 F-4/F-5).
--
-- ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────────
-- MS1 mirrored who is in the random pool. MS2 follows the tests themselves: a recruiter needs to see
-- an applicant's pre-employment test move OPEN → COMPLETED → AT LAB → RESULTS → REVIEWED → CLOSED and
-- when the result is due (median 61 h, p90 93 h from collection, §5A), the hiring step's
-- `drug_test` record should file itself from a verified negative, and a positive or a refusal must
-- reach the DER and stop dispatch the hour Med-Stop knows it — not the day somebody opens the portal.
--
-- This migration is the schema only (with 0465, the notification category, which is messaging's
-- table and so its own file). The code that ACTS on a result (files the record, sends the
-- notification, blocks dispatch) lands in the next merge: a merge may be served before its migration
-- applies (the deploy window), and an emit against the old notification CHECK fails outright.
--
-- ── ⚠ A RESULT IS A TESTING RECORD (§382.401(a)) ──────────────────────────────────────────────────
-- `medstop_tests.result` is the MRO-verified outcome of a DOT drug or alcohol test. Both tables are
-- service-role only (RLS on, no client policies), and every API read of `result` is filtered by
-- `canReadTestingRecords` (admin, safety_manager). A recruiter sees the stage and the date the result
-- is expected, never the result — the same line 0211/0237 draw for the drug_test qualification kinds.
--
-- ── 1. NOT A SNAPSHOT: MERGED, NEVER DELETED ──────────────────────────────────────────────────────
-- MS1's roster/pool/selection mirror is replaced whole every sweep, because a person Med-Stop removed
-- must disappear from it. Tests are the opposite: Med-Stop never deletes one (and we never call
-- `DELETE /Request`), there are 1,666 of them since 2013 (measured 2026-10-13), and the sweep reads a
-- ~13-month window rather than the whole history every hour. So rows are MERGED by Med-Stop's id —
-- a test that leaves the window keeps its last known state here — and our own columns (when we first
-- saw it, whether we acted on it) survive every merge.
--
-- Times: Med-Stop sends zoneless local stamps ('2026-10-09T14:24:00'). They are stored as
-- `timestamp` WITHOUT time zone, because that is what they are; nothing here pretends to know the
-- zone. Every question asked of them ("expected by which day") is answered in days.

create table if not exists medstop_requests (
  org_id               uuid not null references organizations(id) on delete cascade,
  medstop_id           text not null check (length(btrim(medstop_id)) > 0),
  employee_medstop_id  text,
  -- TD drug · TA alcohol · TM medical examination.
  service              text,
  category             text,
  reason               text,
  observed             boolean,
  dot_regulated        boolean,
  requested_local      timestamp,
  payment              text,
  location             text,
  test_medstop_id      text,
  tested_local         timestamp,
  -- STATUSREQUEST: PROCESSING · OPEN · ACTIVE · PREPARE · TESTING · COMPLETED · NO SHOW · CANCELED ·
  -- TEST CANCELED · REFUSAL · EXPIRED (`/List/STATUSREQUEST`, §5A).
  status               text,
  first_seen_at        timestamptz not null default now(),
  synced_at            timestamptz not null default now(),
  primary key (org_id, medstop_id)
);

create index if not exists medstop_requests_employee on medstop_requests (org_id, employee_medstop_id);

alter table medstop_requests enable row level security;

create table if not exists medstop_tests (
  org_id               uuid not null references organizations(id) on delete cascade,
  medstop_id           text not null check (length(btrim(medstop_id)) > 0),
  employee_medstop_id  text,
  service              text,
  category             text,
  reason               text,
  dot_regulated        boolean,
  collected_local      timestamp,
  -- Verbatim: NEGATIVE · NEGATIVE - DILUTE · POSITIVE · CANCELED · NOT REFUSAL · REFUSAL TO TEST ·
  -- the medical-exam wordings. Classified in ONE place, `medstopTestOutcome` in shared.
  result               text,
  location             text,
  -- STATUSTEST: OPEN · COMPLETED · AT LAB · RESULTS · REVIEWED · CLOSED (and the split variants).
  status               text,
  -- The trail from `/Test/{id}/status`, oldest first: [{ "status": "AT LAB", "at": "2026-10-10T10:15:06" }].
  -- Fetched only for a test whose status moved since the last sweep, so null for history.
  stages               jsonb check (stages is null or jsonb_typeof(stages) = 'array'),
  -- ── ours, never overwritten by a merge ──
  first_seen_at        timestamptz not null default now(),
  -- True for a test the org's FIRST test sweep found already more than two weeks old (the sweep
  -- decides, `syncTests.ts`). That sweep reads twelve months of history
  -- (5 positives, 9 dilutes in the 12 months to 2026-10-13); those results were handled — or not — by
  -- people, outside this product, before it was watching. Acting on them would page the DER about a
  -- result from February and stop a driver who completed return-to-duty in the spring with nothing
  -- on file here to prove it. History is listed for review; only news is acted on. Two weeks, not
  -- "everything on the first sweep": a test closed yesterday is news on any sweep, and an org whose
  -- first test arrives after the switch-on must not have it filed as history.
  baseline            boolean not null default false,
  -- The outcome the next merge's code acted on (filed / alerted / blocked), and when. A result that
  -- CHANGES after it was acted on (an MRO correction) is acted on again, because this differs from it.
  outcome_handled      text,
  outcome_handled_at   timestamptz,
  synced_at            timestamptz not null default now(),
  primary key (org_id, medstop_id)
);

create index if not exists medstop_tests_employee on medstop_tests (org_id, employee_medstop_id);

alter table medstop_tests enable row level security;

-- ── 2. The one writer of both mirrors ─────────────────────────────────────────────────────────────
-- raw-access-waiver: the medstop collector's own writer of its own two staging tables, called only from modules/medstop/syncTests.ts.
-- Merges `p_rows` by Med-Stop's id. Med-Stop's columns are replaced from the row; ours
-- (`first_seen_at`, `baseline`, `outcome_handled*`) are set on insert and never touched again, and
-- `stages` only when the row carries a fresh trail. A row's `baseline` is read on INSERT only.
-- Set-based, one statement per kind — never a PostgREST upsert with a partial payload (`lint:upserts`).
create or replace function public.medstop_merge(p_org uuid, p_kind text, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'a Med-Stop merge of % must be an array', p_kind using errcode = 'MS003';
  end if;

  if p_kind = 'requests' then
    insert into public.medstop_requests as t (
      org_id, medstop_id, employee_medstop_id, service, category, reason, observed, dot_regulated,
      requested_local, payment, location, test_medstop_id, tested_local, status, synced_at)
    select p_org, r.medstop_id, r.employee_medstop_id, r.service, r.category, r.reason, r.observed, r.dot_regulated,
           r.requested_local, r.payment, r.location, r.test_medstop_id, r.tested_local, r.status, now()
      from jsonb_populate_recordset(null::public.medstop_requests, p_rows) r
    on conflict (org_id, medstop_id) do update set
      employee_medstop_id = excluded.employee_medstop_id, service = excluded.service,
      category = excluded.category, reason = excluded.reason, observed = excluded.observed,
      dot_regulated = excluded.dot_regulated, requested_local = excluded.requested_local,
      payment = excluded.payment, location = excluded.location, test_medstop_id = excluded.test_medstop_id,
      tested_local = excluded.tested_local, status = excluded.status, synced_at = excluded.synced_at;
  elsif p_kind = 'tests' then
    insert into public.medstop_tests as t (
      org_id, medstop_id, employee_medstop_id, service, category, reason, dot_regulated,
      collected_local, result, location, status, stages, baseline, synced_at)
    select p_org, r.medstop_id, r.employee_medstop_id, r.service, r.category, r.reason, r.dot_regulated,
           r.collected_local, r.result, r.location, r.status, r.stages, coalesce(r.baseline, false), now()
      from jsonb_populate_recordset(null::public.medstop_tests, p_rows) r
    on conflict (org_id, medstop_id) do update set
      employee_medstop_id = excluded.employee_medstop_id, service = excluded.service,
      category = excluded.category, reason = excluded.reason, dot_regulated = excluded.dot_regulated,
      collected_local = excluded.collected_local, result = excluded.result, location = excluded.location,
      status = excluded.status, stages = coalesce(excluded.stages, t.stages), synced_at = excluded.synced_at;
  else
    raise exception 'unknown Med-Stop merge kind %', p_kind using errcode = 'MS002';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.medstop_merge(uuid, text, jsonb) from public, anon, authenticated;
