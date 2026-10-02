-- 0410: card fraud incidents — "a card used where its truck isn't", one per card (CF2,
-- docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md D-CF1/D-CF2)
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The only thing in this product that would have caught the stolen card the week of 2026-09-22 is
-- a decline the scorer kept `location_mismatch` on: Samsara had the card's truck elsewhere and no
-- fill by that truck at that station explained it. Over 2026-09-02..10-02 that is 13 declines on
-- 5 cards, and each one was its own alert row with its own notification, among ~1,290 others. The
-- product needs ONE row per card per episode that grows with the attempts, that a person can open,
-- investigate and close with an outcome, and that remembers which escalation steps it has already
-- told people about — so a re-score, or the third try in five minutes, never sends a second text.
--
-- ── WHY THIS SHAPE ──────────────────────────────────────────────────────────────────────────────
-- `card_fraud_incidents` holds the reducer's state (`applyFraudAttempt`, packages/shared/cardFraud.ts)
-- as jsonb, beside the columns a list needs to sort and filter on. The state is DERIVED from the
-- attempts; status and disposition are a PERSON'S, and nothing derived ever writes them.
-- `card_fraud_incident_attempts` maps every attempt to exactly one incident (primary key on the
-- attempt), which is what makes recording idempotent: the second time a decline is scored, the
-- mapping already exists and the write is refused before it can take a step.
--
-- `anomalies` was considered and rejected: it is keyed per fuel transaction (`transaction_id` not
-- null, the partial unique index on (transaction_id, rule_id)), and a decline is not a transaction.
-- Bending it to carry declines would put a second meaning on every reader of `anomalies` (the
-- dashboard RPC, detection metrics, the findings inbox) — the workaround CLAUDE.md names.
--
-- ── CONCURRENCY ─────────────────────────────────────────────────────────────────────────────────
-- The reducer runs in TypeScript, so a read-modify-write. `card_fraud_record` makes the write
-- conditional: a new incident inserts only if its key is free; an existing one updates only at the
-- version the caller read AND while still open or investigating. Either refusal returns no row and
-- the caller re-reads and re-applies. Two workers scoring the same card cannot both extend an incident,
-- and an attempt that lands while a person closes the incident opens a fresh one instead of reopening
-- theirs.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- New tables and a new function; nothing existing changes. Exempt from lint:migration-ordering
-- (new tables). Deny-all RLS: incidents are served through the API, which org-filters itself.

create table public.card_fraud_incidents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  incident_key     text not null,
  card_ref         text not null,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  opened_at        timestamptz not null,
  last_attempt_at  timestamptz not null,
  attempt_count    int not null check (attempt_count >= 1),
  fuel_taken       boolean not null default false,
  state            jsonb not null,
  version          int not null default 1,
  status           text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  disposition      text check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive')),
  disposition_by   uuid references auth.users(id),
  disposition_at   timestamptz,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, incident_key),
  constraint card_fraud_incidents_attempt_order check (last_attempt_at >= opened_at),
  constraint card_fraud_incidents_closed_has_outcome check (status not in ('resolved', 'dismissed') or disposition is not null)
);
create index idx_card_fraud_incidents_card on public.card_fraud_incidents (org_id, card_ref, last_attempt_at desc);
create index idx_card_fraud_incidents_queue on public.card_fraud_incidents (org_id, status, last_attempt_at desc);
alter table public.card_fraud_incidents enable row level security;

create table public.card_fraud_incident_attempts (
  source        text not null check (source in ('decline', 'fill')),
  source_id     uuid not null,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  incident_id   uuid not null references public.card_fraud_incidents(id) on delete cascade,
  attempted_at  timestamptz not null,
  -- The escalation step this attempt took (FraudStep), or null when it was more of the same.
  step          text check (step in ('opened', 'fuel_taken', 'new_place', 'returned', 'failed_prompt', 'inactive_card')),
  created_at    timestamptz not null default now(),
  primary key (source, source_id)
);
create index idx_card_fraud_incident_attempts_incident on public.card_fraud_incident_attempts (incident_id);
alter table public.card_fraud_incident_attempts enable row level security;

-- Record one attempt against one incident, atomically. p_expected_version null = open a new incident.
-- Returns the incident id and its new version, or no row when refused (key taken, version moved,
-- incident closed meanwhile, or this attempt already recorded) — the caller re-reads and re-applies.
create or replace function public.card_fraud_record(
  p_org              uuid,
  p_incident_key     text,
  p_expected_version int,
  p_card_ref         text,
  p_vehicle_id       uuid,
  p_opened_at        timestamptz,
  p_last_attempt_at  timestamptz,
  p_attempt_count    int,
  p_fuel_taken       boolean,
  p_state            jsonb,
  p_attempt_source   text,
  p_attempt_id       uuid,
  p_attempted_at     timestamptz,
  p_step             text
)
returns table (incident_id uuid, version int)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_version int;
begin
  if exists (
    select 1 from public.card_fraud_incident_attempts a
    where a.source = p_attempt_source and a.source_id = p_attempt_id
  ) then
    return;
  end if;

  if p_expected_version is null then
    insert into public.card_fraud_incidents
      (org_id, incident_key, card_ref, vehicle_id, opened_at, last_attempt_at, attempt_count, fuel_taken, state)
    values
      (p_org, p_incident_key, p_card_ref, p_vehicle_id, p_opened_at, p_last_attempt_at, p_attempt_count, p_fuel_taken, p_state)
    on conflict (org_id, incident_key) do nothing
    returning id, card_fraud_incidents.version into v_id, v_version;
  else
    update public.card_fraud_incidents i
       set last_attempt_at = p_last_attempt_at,
           attempt_count   = p_attempt_count,
           fuel_taken      = p_fuel_taken,
           state           = p_state,
           version         = i.version + 1,
           updated_at      = now()
     where i.org_id = p_org
       and i.incident_key = p_incident_key
       and i.version = p_expected_version
       and i.status in ('open', 'investigating')
    returning i.id, i.version into v_id, v_version;
  end if;

  if v_id is null then
    return;
  end if;

  insert into public.card_fraud_incident_attempts (source, source_id, org_id, incident_id, attempted_at, step)
  values (p_attempt_source, p_attempt_id, p_org, v_id, p_attempted_at, p_step);

  incident_id := v_id;
  version := v_version;
  return next;
end;
$$;

revoke all on function public.card_fraud_record(uuid, text, int, text, uuid, timestamptz, timestamptz, int, boolean, jsonb, text, uuid, timestamptz, text) from public;
revoke all on function public.card_fraud_record(uuid, text, int, text, uuid, timestamptz, timestamptz, int, boolean, jsonb, text, uuid, timestamptz, text) from anon;
revoke all on function public.card_fraud_record(uuid, text, int, text, uuid, timestamptz, timestamptz, int, boolean, jsonb, text, uuid, timestamptz, text) from authenticated;
grant execute on function public.card_fraud_record(uuid, text, int, text, uuid, timestamptz, timestamptz, int, boolean, jsonb, text, uuid, timestamptz, text) to service_role;

comment on table public.card_fraud_incidents is
  'One per card per episode of use where its truck was not (CF2, 0410). state = applyFraudAttempt output; status/disposition are a person''s.';
comment on table public.card_fraud_incident_attempts is
  'Each qualifying decline or fill, in exactly one incident (CF2, 0410). The primary key is what makes recording idempotent.';
