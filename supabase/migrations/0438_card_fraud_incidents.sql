-- FuelGuard — 0438 card fraud incidents: "a card used where its truck isn't", one per card per
-- episode (CF2, docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md D-CF1/D-CF2; F02-F04 PLAN.md chunk 5b).
--
-- THE GAP. The stolen card the week of 2026-09-22 (…27564, South Bend, IN, while truck 729 was in the
-- south) was caught: every attempt was a decline the scorer kept `location_mismatch` on. Over
-- 2026-09-02..10-02 that is 13 declines on 5 cards, and each was its own alert with its own
-- notification among ~1,290 others in a fortnight. Chunk 5a (#1346) wrote the rule that folds them into
-- 7 incidents (`packages/shared/src/cardFraud.ts`). This is where those incidents live: one row a
-- person can open, investigate and close with an outcome, that grows with the attempts, and that
-- remembers which steps it has already told people about, so a re-score never sends a second message.
--
-- THE SHAPE.
--   • `card_fraud_incidents` holds the fold's state (`FraudIncident`) as columns a list sorts and
--     filters on (card, level, times, counts), plus three jsonb/array columns the drawer reads
--     (places, steps, failed prompts, the truck's last measured position). That state is DERIVED from
--     the attempts. `status` and `disposition` are a PERSON'S, and `card_fraud_record` never writes
--     them. Disposition values are 0034's, so the precision measure reads one vocabulary.
--   • `card_fraud_incident_attempts` puts every qualifying decline or fill in exactly ONE incident: the
--     primary key is the attempt. That is what makes a re-score a no-op.
--   • `card_fraud_record` writes one attempt atomically (below).
--
-- CONCURRENCY. The fold runs in TypeScript, so a scorer reads the card's latest incident, applies the
-- attempt, and writes. Two workers can score two declines of the same card at once (an import scores
-- its rows in parallel jobs). #1216's version of this function guarded an UPDATE with a version, but an
-- OPENING inserted under a key built from the attempt's own id, so two workers opening at once both
-- succeeded and the card had two incidents for one episode. Here the function takes a per-card
-- transaction lock, and then refuses the write unless the card's latest incident is still exactly the
-- one the caller read (its id and version, or "none"). A refusal returns `moved` and the caller
-- re-reads and re-applies. An update also refuses an incident a person closed in between (`closed`):
-- the caller re-reads, the fold sees it closed, and opens a new one rather than reopening theirs.
--
-- A REVIEWED INCIDENT CANNOT BE DELETED. This is the Q-F8 rule (0437, owner's ruling 2026-10-07) on the
-- new home of a fraud verdict, from its first day rather than after a loss: an incident that is
-- investigating, resolved or dismissed, or that carries a disposition, refuses DELETE. Deleting the
-- organization still cascades, by 0437's reasoning (the org row is already gone inside its cascade).
-- An incident nobody touched may go; its attempts go with it.
--
-- WHAT WAS REJECTED.
--   • Storing incidents in `anomalies`. It is keyed per fuel transaction (`transaction_id` not null,
--     the unique index on (transaction_id, rule_id)), and a decline is not a transaction. Bending it
--     would give every reader of `anomalies` (dashboard RPC, detection metrics, the findings inbox) a
--     second meaning to filter out — the workaround the root CLAUDE.md names.
--   • One `state jsonb` column for the whole fold, as #1216 had. The list (chunk 8c) sorts on level
--     and time, and the drawer (CF7) reads places and the truck; named columns are what both read.
--   • A foreign key from an attempt to the decline or the fill. An attempt is one of two tables, and
--     a decline delete must not be refused by an incident; the attempt keeps the source's id as data.
--   • Browser policies. Incidents are served through the API, which org-filters itself; deny-all RLS.
--
-- DEPLOY WINDOW. New tables and new functions; nothing existing changes, so no running code can meet a
-- shape it does not expect (lint:migration-ordering exempts new tables). The first writer is chunk 5c.
--
-- Proven in supabase/tests/card-fraud-incidents.test.mjs.
--
-- Rollback (nothing reads or writes these before 5c):
--   drop function card_fraud_record(uuid, text, text, uuid, int, uuid, text, uuid, timestamptz,
--     timestamptz, text, int, boolean, jsonb, text[], jsonb, jsonb, text, uuid, timestamptz, text);
--   drop table card_fraud_incident_attempts; drop table card_fraud_incidents;
--   drop function card_fraud_incidents_reviewed_cannot_be_deleted();

create table public.card_fraud_incidents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  -- `FraudIncident.key`: the card key and the attempt that opened it.
  incident_key     text not null,
  -- `cardFraudKey()`: the full card number, or a masked ref together with its truck.
  card_key         text not null,
  card_ref         text not null,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  opened_at        timestamptz not null,
  last_attempt_at  timestamptz not null,
  level            text not null check (level in ('alert', 'escalated')),
  attempt_count    int not null check (attempt_count >= 1),
  fuel_taken       boolean not null default false,
  failed_prompts   text[] not null default '{}'
                   check (failed_prompts <@ array['odometer', 'driver_id']::text[]),
  -- [{city, state, attempts, firstAt, lastAt}], in the order the card reached them.
  places           jsonb not null check (jsonb_typeof(places) = 'array' and jsonb_array_length(places) >= 1),
  -- [{step, at, attemptId}]: every message-worthy step taken; its index is CF4's dedupe step.
  steps            jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) >= 1),
  -- {at, city, state, milesToStation}: where Samsara last had the card's truck (CF1), or null.
  last_truck       jsonb check (last_truck is null or jsonb_typeof(last_truck) = 'object'),
  version          int not null default 1,
  status           text not null default 'open'
                   check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  disposition      text check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive')),
  disposition_by   uuid references auth.users(id),
  disposition_at   timestamptz,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, incident_key),
  -- The attempts table's composite key: an attempt can never sit in another org's incident.
  unique (id, org_id),
  constraint card_fraud_incidents_attempt_order check (last_attempt_at >= opened_at),
  constraint card_fraud_incidents_closed_has_outcome
    check (status not in ('resolved', 'dismissed') or disposition is not null)
);
create index idx_card_fraud_incidents_card on public.card_fraud_incidents (org_id, card_key, opened_at desc);
create index idx_card_fraud_incidents_queue on public.card_fraud_incidents (org_id, status, last_attempt_at desc);
alter table public.card_fraud_incidents enable row level security;

comment on table public.card_fraud_incidents is
  'CF2 (0438): one per card per episode of use where its truck was not. The fold state is '
  'applyFraudAttempt''s (packages/shared/src/cardFraud.ts), written only by card_fraud_record; '
  'status and disposition are a person''s. A reviewed incident cannot be deleted.';

create table public.card_fraud_incident_attempts (
  source        text not null check (source in ('decline', 'fill')),
  -- declined_transactions.id or fuel_transactions.id; deliberately no foreign key (see header).
  source_id     uuid not null,
  org_id        uuid not null,
  incident_id   uuid not null,
  attempted_at  timestamptz not null,
  -- The step this attempt took (FraudStep), or null when it was more of the same.
  step          text check (step in ('opened', 'escalated', 'new_place')),
  created_at    timestamptz not null default now(),
  primary key (source, source_id),
  foreign key (incident_id, org_id) references public.card_fraud_incidents (id, org_id) on delete cascade
);
create index idx_card_fraud_incident_attempts_incident on public.card_fraud_incident_attempts (incident_id);
create index idx_card_fraud_incident_attempts_org on public.card_fraud_incident_attempts (org_id);
alter table public.card_fraud_incident_attempts enable row level security;

comment on table public.card_fraud_incident_attempts is
  'CF2 (0438): each qualifying decline or fill, in exactly one incident. The primary key on the '
  'attempt is what makes recording idempotent.';

-- ── The one writer ──────────────────────────────────────────────────────────────────────────────
-- Record one attempt. `p_read_id`/`p_read_version` name the card's latest incident as the caller read
-- it (both null = the card had none). `p_incident_id` null = open a new incident with the given fold
-- state; otherwise it must equal `p_read_id`, and that incident is updated to the given state.
--
-- Returns one row: outcome 'recorded' with the incident id and its new version, or a refusal with
-- nulls — 'duplicate' (this attempt is already in an incident), 'moved' (the card's latest incident is
-- not the one read), 'closed' (a person closed it meanwhile). On 'moved' or 'closed' the caller
-- re-reads and re-applies; on 'duplicate' there is nothing to do.
create or replace function public.card_fraud_record(
  p_org              uuid,
  p_card_key         text,
  p_card_ref         text,
  p_read_id          uuid,
  p_read_version     int,
  p_incident_id      uuid,
  p_incident_key     text,
  p_vehicle_id       uuid,
  p_opened_at        timestamptz,
  p_last_attempt_at  timestamptz,
  p_level            text,
  p_attempt_count    int,
  p_fuel_taken       boolean,
  p_places           jsonb,
  p_failed_prompts   text[],
  p_steps            jsonb,
  p_last_truck       jsonb,
  p_attempt_source   text,
  p_attempt_id       uuid,
  p_attempted_at     timestamptz,
  p_step             text
)
returns table (outcome text, incident_id uuid, version int)
language plpgsql
set search_path = ''
as $$
declare
  v_latest_id uuid;
  v_latest_version int;
  v_id uuid;
  v_version int;
begin
  -- One writer per card at a time, for the rest of this transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text || '|' || p_card_key, 0));

  if exists (
    select 1 from public.card_fraud_incident_attempts a
    where a.source = p_attempt_source and a.source_id = p_attempt_id
  ) then
    return query select 'duplicate'::text, null::uuid, null::int;
    return;
  end if;

  select i.id, i.version into v_latest_id, v_latest_version
    from public.card_fraud_incidents i
   where i.org_id = p_org and i.card_key = p_card_key
   order by i.opened_at desc, i.created_at desc
   limit 1;

  if v_latest_id is distinct from p_read_id or v_latest_version is distinct from p_read_version then
    return query select 'moved'::text, null::uuid, null::int;
    return;
  end if;

  if p_incident_id is null then
    insert into public.card_fraud_incidents
      (org_id, incident_key, card_key, card_ref, vehicle_id, opened_at, last_attempt_at, level,
       attempt_count, fuel_taken, failed_prompts, places, steps, last_truck)
    values
      (p_org, p_incident_key, p_card_key, p_card_ref, p_vehicle_id, p_opened_at,
       p_last_attempt_at, p_level, p_attempt_count, p_fuel_taken, coalesce(p_failed_prompts, '{}'),
       p_places, p_steps, p_last_truck)
    returning id, card_fraud_incidents.version into v_id, v_version;
  else
    if p_incident_id is distinct from p_read_id then
      raise exception 'card_fraud_record: incident % is not the one read (%)', p_incident_id, p_read_id
        using errcode = '22023';
    end if;
    update public.card_fraud_incidents i
       set last_attempt_at = p_last_attempt_at,
           level           = p_level,
           attempt_count   = p_attempt_count,
           fuel_taken      = p_fuel_taken,
           failed_prompts  = coalesce(p_failed_prompts, '{}'),
           places          = p_places,
           steps           = p_steps,
           last_truck      = p_last_truck,
           version         = i.version + 1,
           updated_at      = now()
     where i.id = p_incident_id
       and i.org_id = p_org
       and i.status in ('open', 'investigating')
    returning i.id, i.version into v_id, v_version;
    if v_id is null then
      return query select 'closed'::text, null::uuid, null::int;
      return;
    end if;
  end if;

  insert into public.card_fraud_incident_attempts (source, source_id, org_id, incident_id, attempted_at, step)
  values (p_attempt_source, p_attempt_id, p_org, v_id, p_attempted_at, p_step);

  return query select 'recorded'::text, v_id, v_version;
end;
$$;

comment on function public.card_fraud_record(uuid, text, text, uuid, int, uuid, text, uuid, timestamptz,
  timestamptz, text, int, boolean, jsonb, text[], jsonb, jsonb, text, uuid, timestamptz, text) is
  '0438 (CF2): the one writer of card fraud incidents. Per-card lock; refuses a duplicate attempt, a '
  'card whose latest incident moved since it was read, and an incident a person closed. Service role only.';

revoke all on function public.card_fraud_record(uuid, text, text, uuid, int, uuid, text, uuid, timestamptz,
  timestamptz, text, int, boolean, jsonb, text[], jsonb, jsonb, text, uuid, timestamptz, text) from public, anon, authenticated;
-- Explicit, as 0435: the revoke from PUBLIC above also takes the grant service_role would inherit, and
-- without this line 5c's first call is a production 500 that the API's stubbed tests cannot see.
grant execute on function public.card_fraud_record(uuid, text, text, uuid, int, uuid, text, uuid, timestamptz,
  timestamptz, text, int, boolean, jsonb, text[], jsonb, jsonb, text, uuid, timestamptz, text) to service_role;

-- ── A reviewed incident cannot be deleted (Q-F8, as 0437) ───────────────────────────────────────
create or replace function public.card_fraud_incidents_reviewed_cannot_be_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The org is being deleted: its cascade is the sanctioned way these rows go (0361, 0437).
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;

  if old.status in ('investigating', 'resolved', 'dismissed') or old.disposition is not null then
    raise exception
      'reviewed_incident: card fraud incident % has been reviewed and cannot be deleted — close it instead (Q-F8)', old.id
      using errcode = 'FG013';
  end if;

  return old;
end;
$$;

comment on function public.card_fraud_incidents_reviewed_cannot_be_deleted() is
  '0438 (Q-F8, as 0437): refuses deleting a card fraud incident a person has touched — status '
  'investigating/resolved/dismissed, or a disposition. Deleting the organization still cascades.';

revoke all on function public.card_fraud_incidents_reviewed_cannot_be_deleted() from public, anon, authenticated;

create trigger card_fraud_incidents_reviewed_cannot_be_deleted
  before delete on public.card_fraud_incidents
  for each row execute function public.card_fraud_incidents_reviewed_cannot_be_deleted();
