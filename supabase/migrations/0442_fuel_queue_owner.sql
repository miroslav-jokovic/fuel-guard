-- FuelGuard — 0442 the fuel queue's default owner: one org setting, and every new fuel item is given to
-- that person (Q-F1, ruled 2026-10-06; F02-F04 PLAN.md chunk 8a).
--
-- THE GAP. Q-F1 ruled that one person owns the fuel-security queue and that "new items are assigned to him
-- by default". Today nothing assigns anything: on production (read-only, 2026-10-08) 157 open money
-- findings, 0 of them assigned, and every new fill case or card-fraud incident arrives with nobody's name
-- on it. An item with no owner is worked by whoever happens to open the page, which is how the queue
-- aged. Q-F1 supersedes Q-FUI15 ("unassigned by default; a finding is claimed") for the fuel queue.
--
-- THE SHAPE.
--   • `organizations.fuel_queue_owner` (null = no owner, today's behaviour). On the org row, as
--     `detection_epoch` (0439): the browser holds no UPDATE policy on `organizations` (only
--     `organizations_select`), so it moves only through the act below. ON DELETE SET NULL: a deleted
--     user leaves the queue ownerless rather than blocking the delete.
--   • `card_fraud_incidents.assigned_to`, as `anomalies` and `fuel_exceptions` already have. The one
--     queue (chunk 8c) lists all three, and an incident is the item that most needs an owner.
--   • ONE trigger function, `assign_fuel_queue_owner()`, BEFORE INSERT on the three tables: a new row
--     with no assignee gets the org's owner. It is one rule in one place because the three writers are
--     three SQL functions (`persist_scoring_outcome`, the `fuel_exceptions` ingest, `card_fraud_record`);
--     teaching each of them would be three copies of the rule. An insert that names an assignee keeps it.
--     A re-ingest that finds an existing finding goes through ON CONFLICT DO UPDATE, whose SET list leaves
--     `assigned_to` alone (D-FX10), so a person's reassignment is never overwritten.
--   • The owner must still be a MEMBER of the org when an item arrives; if they have left, the item stays
--     unassigned rather than going to somebody who can no longer open it.
--   • `set_fuel_queue_owner(p_org, p_actor, p_owner)`, service role only, one transaction: refuses a
--     missing actor and an owner who is not a member; sets the owner; gives every OPEN item that has no
--     assignee to the owner (it never takes an item from a person); writes ONE `audit_logs` row with the
--     counts. Chunk 8b runs it for Silvicom. `p_owner` null clears the setting and assigns nothing.
--
-- DECIDED HERE (2026-10-08, recorded in PLAN.md chunk 8a; the owner may overrule). Buying-habit findings
-- get the owner too, although Q-F2 takes them out of the queue in chunk 9. The alternative is a list of
-- the habit kinds written in SQL, a second copy of Q-F2's split that chunk 9 owns in TypeScript. An
-- assignment notifies nobody and is reversible; chunk 9 decides what the queue shows.
--
-- WHAT IS NOT CHECKED HERE, AND WHY. Whether the owner's ROLE can close every item. Section access lives in
-- the JWT and the TypeScript matrix (`rolesAssignableIn`, D-PERM4), and SQL cannot answer it for another
-- user without copying that matrix. Any API that sets the owner must check `rolesAssignableIn` for every
-- section a fuel item belongs to (fuel and safety), as `findingsAssign.ts` does. The act in 8b sets an admin.
--
-- WHAT WAS REJECTED.
--   • Assigning in each writer's TypeScript. The writers are SQL functions; a TS assignment would be a
--     second write after the insert, and a crash between them leaves an ownerless item.
--   • A setting in `anomaly_thresholds`: it is the settings form's table, saved by a full-row upsert.
--
-- DEPLOY WINDOW. Two new nullable columns nothing reads yet, a trigger that does nothing while the owner is
-- null (everywhere, until 8b), and a new function. Old code meets nothing it does not expect; it already
-- reads `assigned_to` on anomalies and fuel_exceptions.
--
-- cross-module-waiver: one rule — "a new fuel item goes to the org's queue owner" — applied identically to
-- the three tables the fuel queue lists, plus the org column that holds the owner and the act's one
-- `audit_logs` row (as 0439).
--
-- Proven in supabase/tests/fuel-queue-owner.test.mjs.
--
-- Rollback (before 8b has run): drop the three triggers, drop function assign_fuel_queue_owner() and
--   set_fuel_queue_owner(uuid, uuid, uuid); alter table organizations drop column fuel_queue_owner;
--   alter table card_fraud_incidents drop column assigned_to.

alter table public.organizations
  add column if not exists fuel_queue_owner uuid references auth.users(id) on delete set null;

comment on column public.organizations.fuel_queue_owner is
  '0442 (Q-F1): the person every new fuel item (fill case, money finding, card fraud incident) is '
  'assigned to. Null = no default owner. Set only by set_fuel_queue_owner, which writes an audit row.';

alter table public.card_fraud_incidents
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

comment on column public.card_fraud_incidents.assigned_to is
  '0442 (Q-F1): who works this incident. Filled from organizations.fuel_queue_owner when it opens.';

create or replace function public.assign_fuel_queue_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if new.assigned_to is not null then
    return new;
  end if;

  select o.fuel_queue_owner into v_owner from public.organizations o where o.id = new.org_id;
  if v_owner is not null and exists (
    select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = v_owner
  ) then
    new.assigned_to := v_owner;
  end if;

  return new;
end;
$$;

comment on function public.assign_fuel_queue_owner() is
  '0442 (Q-F1): a new fuel item with no assignee goes to the org''s fuel_queue_owner, if that person is '
  'still a member. Never replaces an assignee the insert named.';

revoke all on function public.assign_fuel_queue_owner() from public, anon, authenticated;

create trigger anomalies_assign_fuel_queue_owner
  before insert on public.anomalies
  for each row execute function public.assign_fuel_queue_owner();

create trigger fuel_exceptions_assign_fuel_queue_owner
  before insert on public.fuel_exceptions
  for each row execute function public.assign_fuel_queue_owner();

create trigger card_fraud_incidents_assign_fuel_queue_owner
  before insert on public.card_fraud_incidents
  for each row execute function public.assign_fuel_queue_owner();

create or replace function public.set_fuel_queue_owner(
  p_org    uuid,
  p_actor  uuid,
  p_owner  uuid
)
returns table (cases int, findings int, incidents int)
language plpgsql
set search_path = ''
as $$
declare
  v_previous  uuid;
  v_cases     int := 0;
  v_findings  int := 0;
  v_incidents int := 0;
begin
  if p_actor is null then
    raise exception 'set_fuel_queue_owner: an actor is required (Q-F1)' using errcode = '22023';
  end if;

  select o.fuel_queue_owner into v_previous from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'set_fuel_queue_owner: organization % does not exist', p_org using errcode = '22023';
  end if;

  if p_owner is not null and not exists (
    select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_owner
  ) then
    raise exception 'set_fuel_queue_owner: % is not a member of organization %', p_owner, p_org
      using errcode = '22023';
  end if;

  update public.organizations o set fuel_queue_owner = p_owner where o.id = p_org;

  if p_owner is not null then
    with done as (
      update public.anomalies a set assigned_to = p_owner
       where a.org_id = p_org and a.assigned_to is null and a.status in ('open', 'investigating')
      returning 1
    ) select count(*) into v_cases from done;

    with done as (
      update public.fuel_exceptions f set assigned_to = p_owner
       where f.org_id = p_org and f.assigned_to is null and f.status in ('open', 'investigating', 'disputed')
      returning 1
    ) select count(*) into v_findings from done;

    with done as (
      update public.card_fraud_incidents c set assigned_to = p_owner
       where c.org_id = p_org and c.assigned_to is null and c.status in ('open', 'investigating')
      returning 1
    ) select count(*) into v_incidents from done;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, meta)
  values (p_org, p_actor, 'fuel.queue_owner_set', 'organizations', p_org, jsonb_build_object(
    'owner', p_owner,
    'previous_owner', v_previous,
    'assigned_cases', v_cases,
    'assigned_findings', v_findings,
    'assigned_incidents', v_incidents
  ));

  return query select v_cases, v_findings, v_incidents;
end;
$$;

comment on function public.set_fuel_queue_owner(uuid, uuid, uuid) is
  '0442 (Q-F1): set the org''s fuel queue owner, give every open unassigned fuel item to them, and write '
  'one audit row. The caller checks the owner''s role (rolesAssignableIn). Service role only.';

revoke all on function public.set_fuel_queue_owner(uuid, uuid, uuid) from public, anon, authenticated;
-- Explicit, as 0438: the revoke from PUBLIC also takes the grant service_role would inherit.
grant execute on function public.set_fuel_queue_owner(uuid, uuid, uuid) to service_role;
