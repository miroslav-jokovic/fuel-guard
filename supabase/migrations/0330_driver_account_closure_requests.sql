-- 0330: a driver can ask for their login to be closed, and the fleet's answer is a record.
--
-- ── WHY THIS TABLE, WHEN "DELETE THE ACCOUNT" WOULD HAVE BEEN ONE LINE ───────────────────────────
-- Apple 5.1.1(v) requires an app that supports account CREATION to offer in-app deletion. This app
-- supports no such thing — logins are issued by the carrier (DC9) — so 5.1.1(ix) is the clause that
-- actually governs: a regulated industry may complete the deletion through a customer-service flow.
-- That is not a loophole to lean on. It is a description of the real constraint: 49 CFR §391.51
-- obliges the CARRIER to keep a driver's qualification file for three years after they leave, so an
-- app that let a driver erase themselves would be handing them a button that deletes their
-- employer's regulatory records. The honest surface is therefore a REQUEST — the login closes at
-- once, the fleet is asked to delete what may be deleted, and the file the law names stays.
--
-- The request has to be a row rather than an email because three separate people need it later. The
-- driver, who asked and is entitled to know it was actioned. The fleet, who has 30 days and needs a
-- queue rather than an inbox. And an auditor or a regulator asking "you say you honour deletion
-- requests — show me one", for whom `resolved_at` and `resolved_by` are the whole answer.
--
-- ── EVIDENCE, THEREFORE RETENTION_FORBIDDEN ──────────────────────────────────────────────────────
-- This joins `RETENTION_FORBIDDEN` (`apps/api/src/modules/org/dataRetention.ts`) in this same PR, and
-- the reason is worth stating because it inverts the obvious: a table ABOUT deleting personal data is
-- the one table a retention prune must never touch. Pruning it would delete the proof that a deletion
-- request was honoured — erasing the compliance record by exercising the very policy it evidences.
-- The row holds no driving history and no document; it holds "who asked, when, and what we did".
--
-- ── WHAT IS FROZEN AND WHAT MOVES (AC010) ────────────────────────────────────────────────────────
-- Unlike the append-only evidence tables, this row is DESIGNED to be updated exactly once: `open` →
-- `completed` or `declined`. So the trigger below freezes the half that records what the driver
-- asked — org, driver, user, requested_at — and forbids leaving a resolved state, while leaving the
-- resolution half writable until it is set. A request that could be reopened, or backdated, would be
-- a queue item rather than a record.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- Enabled with NO policy: deny-all on purpose, the house pattern. Both sides of this go through the
-- API with the service role — the driver's own request is written by an endpoint that has just
-- banned their auth user, and the fleet's resolution is a manage-gated route. A browser session that
-- could UPDATE here could mark its own closure request completed without deleting anything.
--
-- ⚠ MERGE. `driver_id` is `on delete restrict`, which is the cascade trap `check-driver-references.mjs`
-- exists to catch: without a reassignment entry, the first roster dedup involving a driver who had
-- ever asked to close their account would ABORT the whole merge. The entry ships in this PR, in
-- `modules/roster/mergeDriver.ts`. It is a mechanical move — the request follows the surviving
-- driver — and not a refusal, because unlike a signed consent there is nothing here that becomes
-- false when the two records turn out to be one person.

create table if not exists driver_account_closure_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  -- `restrict`, not `cascade`: deleting a driver row out from under an unresolved closure request
  -- would destroy the record of the request along with the thing it is evidence about. The roster
  -- has no hard delete anyway (0235 refuses it) — this makes the same statement at the FK.
  driver_id    uuid not null references drivers(id) on delete restrict,
  -- The auth user that was banned. Deliberately NOT a FK to auth.users: the whole point of the
  -- request is that this identity may be removed later, and a FK would then either block that or
  -- cascade the record away.
  user_id      uuid not null,
  requested_at timestamptz not null default now(),
  status       text not null default 'open' check (status in ('open', 'completed', 'declined')),
  -- Who at the fleet resolved it, and when. `completed` is the fleet's attestation that the
  -- non-retained data was deleted per the published policy; `declined` records that they refused and
  -- `note` says why.
  resolved_by  uuid,
  resolved_at  timestamptz,
  note         text,
  -- A resolved request names its resolver and its moment; an open one names neither. Written as one
  -- constraint rather than two nullable columns and a hope, because "completed by nobody at no time"
  -- is the shape an audit finding takes.
  constraint driver_account_closure_resolution_complete check (
    (status = 'open' and resolved_by is null and resolved_at is null)
    or (status <> 'open' and resolved_by is not null and resolved_at is not null)
  )
);

/*
 * ONE OPEN REQUEST PER DRIVER — and this index is load-bearing rather than tidy.
 *
 * The driver's request rides the offline outbox like every other write in that app, which means it
 * is RETRIED: a phone that loses signal mid-send replays the record when it reconnects, and the
 * outbox's idempotency is a client UUID the server does not key on here. Without this index, one
 * driver on a bad connection produces five open requests and the fleet's queue shows five drivers'
 * worth of work for one person. With it, the retry is a unique violation the endpoint reads as
 * "already asked" and answers success to — which is what idempotent means from the phone's side.
 *
 * Partial, so it constrains only the open ones: a driver who is closed, rehired and asks again is a
 * second legitimate request, and a total unique index would refuse it.
 */
create unique index if not exists driver_account_closure_requests_one_open
  on driver_account_closure_requests (org_id, driver_id)
  where status = 'open';

-- The fleet's queue reads open requests for one org, newest first.
create index if not exists driver_account_closure_requests_org_status
  on driver_account_closure_requests (org_id, status, requested_at desc);

alter table driver_account_closure_requests enable row level security;

create or replace function public.guard_driver_account_closure_request()
returns trigger
language plpgsql
as $$
begin
  -- The REQUEST half is frozen: what a driver asked, and when, is not editable by anybody. Note that
  -- `driver_id` is absent from this list ON PURPOSE, exactly as 0238's AD010 guard omits it — a
  -- merge carrying the row onto the surviving driver is not a rewrite of what happened, and freezing
  -- it here would make the reassignment in mergeDriver.ts fail at the trigger instead.
  if old.org_id is distinct from new.org_id
     or old.user_id is distinct from new.user_id
     or old.requested_at is distinct from new.requested_at
  then
    raise exception 'driver_account_closure_immutable: what was asked, and when, cannot be edited'
      using errcode = 'AC010';
  end if;

  -- A resolved request is final. Reopening would let a fleet mark a request completed, satisfy an
  -- auditor, and quietly move it back — and it would also mean `resolved_at` no longer answers "when
  -- was this honoured". A new request is a new row.
  if old.status <> 'open' and new.status is distinct from old.status then
    raise exception 'driver_account_closure_resolved: a resolved request is final; a new request is a new row'
      using errcode = 'AC010';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_driver_account_closure on public.driver_account_closure_requests;
create trigger trg_guard_driver_account_closure
  before update on public.driver_account_closure_requests
  for each row execute function public.guard_driver_account_closure_request();

comment on table public.driver_account_closure_requests is
  'A driver asked for their company-issued login to be closed (DIRECTION-B-PLAN §6 P4, D-PR8). The '
  'login is banned immediately by the API; this row is the fleet''s 30-day queue item and the '
  'evidence that the request was honoured. The §391.51 qualification file is retained regardless and '
  'the published privacy policy says so. Append-mostly: AC010 freezes the request half and forbids '
  'leaving a resolved state.';
