create table organizations(id uuid primary key);
create table loads(id uuid primary key, org_id uuid not null references organizations(id) on delete cascade);
create table load_stops(id uuid primary key, org_id uuid not null references organizations(id) on delete cascade, load_id uuid not null references loads(id) on delete cascade, status text not null default 'pending');

create table mcleod_write_requests (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  company_id text not null check (length(company_id) between 1 and 10),
  target_type text not null check (target_type in ('stop','movement','order','driver','tractor','trailer')),
  target_id text not null check (length(target_id) between 1 and 40),
  canary_key text,
  load_id uuid references loads(id) on delete restrict,
  stop_id uuid references load_stops(id) on delete restrict,
  movement_id text,
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 16384),
  expected jsonb not null check (jsonb_typeof(expected)='object'),
  origin text not null check (origin in ('driver_app','office_retry','prove')),
  supersedes uuid references mcleod_write_requests(id) on delete restrict,
  requested_by uuid,
  driver_id uuid,
  requested_at timestamptz not null default now(),
  constraint mwr_stop check (target_type <> 'stop' or origin = 'prove' or (load_id is not null and stop_id is not null and movement_id is not null)),
  constraint mwr_retry check ((origin = 'office_retry') = (supersedes is not null))
);
create unique index mwr_driver_stop on mcleod_write_requests (stop_id, operation) where origin = 'driver_app';
create unique index mwr_supersedes on mcleod_write_requests (supersedes) where supersedes is not null;
create index mwr_org_time on mcleod_write_requests (org_id, requested_at);
create index mwr_stop on mcleod_write_requests (stop_id) where stop_id is not null;
create index mwr_target on mcleod_write_requests (org_id, operation, company_id, target_id, requested_at);

create table mcleod_write_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null references mcleod_write_requests(id) on delete restrict,
  kind text not null check (kind in ('leased','send_started','transient','applied_unverified','confirmed','refused','conflict','office_closed')),
  lease_id uuid,
  lease_expires_at timestamptz,
  not_before timestamptz,
  switch_id uuid,
  reason_code text check (reason_code ~ '^[a-z][a-z_]{2,39}$'),
  mcleod_status integer check (mcleod_status between 100 and 599),
  mcleod_text text check (length(mcleod_text) <= 500),
  observed jsonb check (observed is null or jsonb_typeof(observed)='object'),
  instance_id text check (length(instance_id) between 1 and 64),
  agent_version text check (length(agent_version) <= 40),
  actor_user uuid,
  at timestamptz not null default clock_timestamp(),
  constraint mwe_leased check ((kind = 'leased') = (lease_expires_at is not null and switch_id is not null)),
  constraint mwe_leased_self check (kind <> 'leased' or lease_id = id),
  constraint mwe_agent check (kind = 'office_closed' or (lease_id is not null and instance_id is not null)),
  constraint mwe_office check ((kind = 'office_closed') = (actor_user is not null)),
  constraint mwe_reason check (kind not in ('refused','conflict','office_closed') or reason_code is not null),
  constraint mwe_not_before check (not_before is null or kind in ('transient','applied_unverified','send_started'))
);
create unique index mwe_one_end on mcleod_write_events (request_id) where kind in ('confirmed','refused','conflict');
create index mwe_request_seq on mcleod_write_events (request_id, seq desc);

create table mcleod_write_switches (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  org_id uuid not null references organizations(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  company_id text not null check (length(company_id) between 1 and 10),
  mode text not null check (mode in ('off','test','canary','live')),
  canary_keys text[] check (canary_keys is null or cardinality(canary_keys) between 1 and 20),
  proven_by_request uuid references mcleod_write_requests(id) on delete restrict,
  changed_by uuid not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  changed_at timestamptz not null default now(),
  constraint mws_canary check ((mode = 'canary') = (canary_keys is not null)),
  constraint mws_live check (mode <> 'live' or proven_by_request is not null)
);
create index mws_current on mcleod_write_switches (org_id, operation, company_id, seq desc);

-- append-only (0532 shape)
create function mcleod_write_append_only() returns trigger language plpgsql as $$
begin raise exception 'mcleod write evidence % is fixed once recorded', old.id using errcode = 'MK011'; end $$;
create trigger t1 before update on mcleod_write_requests for each row execute function mcleod_write_append_only();
create trigger t2 before update on mcleod_write_events for each row execute function mcleod_write_append_only();
create trigger t3 before update on mcleod_write_switches for each row execute function mcleod_write_append_only();

-- nothing after an end, except office_closed never (end is end)
create function mcleod_write_events_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from mcleod_write_requests r where r.id = new.request_id and r.org_id = new.org_id) then
    raise exception 'event org mismatch' using errcode = 'MK010';
  end if;
  if exists (select 1 from mcleod_write_events e where e.request_id = new.request_id and e.kind in ('confirmed','refused','conflict')) then
    raise exception 'request % already ended', new.request_id using errcode = 'MK012';
  end if;
  return new;
end $$;
create trigger t4 before insert on mcleod_write_events for each row execute function mcleod_write_events_guard();

create function mcleod_write_switch_current(p_org uuid, p_op text, p_company text)
returns mcleod_write_switches language sql stable as $$
  select s.* from mcleod_write_switches s
   where s.org_id = p_org and s.operation = p_op and s.company_id = p_company
   order by s.seq desc limit 1 $$;


-- state per request, derived (no lease_expired rows: expiry is a function of the DB clock)
create view mcleod_write_state with (security_invoker = true) as
select r.id as request_id, r.org_id, r.operation, r.company_id, r.target_id, r.canary_key, r.stop_id, r.load_id,
       r.origin, r.supersedes, r.requested_at,
  case when t.kind is not null then t.kind
       when x.n_sends > 0 or x.n_applied > 0 then 'sent'
       else 'queued' end as state,
  t.reason_code,
  l.id as lease_id, l.lease_expires_at,
  (l.id is not null and l.lease_expires_at > now()
     and not exists (select 1 from mcleod_write_events e where e.request_id = r.id and e.lease_id = l.id
                     and e.kind in ('transient','applied_unverified','confirmed','refused','conflict'))) as lease_live,
  coalesce(x.n_sends, 0) as sends, coalesce(x.n_applied, 0) as applied_reports,
  x.last_send_at, x.max_not_before as not_before,
  exists (select 1 from mcleod_write_requests r2 where r2.supersedes = r.id) as superseded,
  greatest(r.requested_at, x.last_at) as last_fact_at
from public.mcleod_write_requests r
left join lateral (select e.kind, e.reason_code from public.mcleod_write_events e
                    where e.request_id = r.id and e.kind in ('confirmed','refused','conflict') limit 1) t on true
left join lateral (select e.id, e.lease_expires_at from public.mcleod_write_events e
                    where e.request_id = r.id and e.kind = 'leased' order by e.seq desc limit 1) l on true
left join lateral (select count(*) filter (where e.kind = 'send_started') as n_sends,
                          count(*) filter (where e.kind = 'applied_unverified') as n_applied,
                          max(e.at) filter (where e.kind = 'send_started') as last_send_at,
                          max(e.not_before) as max_not_before,
                          max(e.at) as last_at
                     from public.mcleod_write_events e where e.request_id = r.id) x on true;

create function mcleod_write_claim(p_org uuid, p_instance text, p_version text, p_ops text[], p_companies text[], p_max int,
                                   p_lease_seconds int default 300, p_quiet_seconds int default 300)
returns table (request_id uuid, lease_id uuid, lease_expires_at timestamptz, sends bigint, applied_reports bigint)
language plpgsql as $$
declare r record; v_sw mcleod_write_switches; v_lease uuid; v_n int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('mcleod_write:' || p_org::text, 0));
  insert into mcleod_write_events (org_id, request_id, kind, lease_id, instance_id, agent_version, reason_code)
  select s.org_id, s.request_id, 'conflict', gen_random_uuid(), p_instance, p_version, 'stale_intent'
    from mcleod_write_state s
   where s.org_id = p_org and s.requested_at > now() - interval '8 days'
     and s.requested_at <= now() - interval '72 hours'
     and s.state in ('queued','sent') and not s.lease_live;
  for r in
    select s.* from mcleod_write_state s
     where s.org_id = p_org and s.requested_at > now() - interval '8 days'
       and s.state in ('queued','sent') and not s.lease_live
       and s.operation = any(p_ops) and s.company_id = any(p_companies)
       and (s.not_before is null or s.not_before <= now())
       -- a send with no reported result: wait out McLeod's own processing before anyone reads again
       and (s.last_send_at is null or s.last_send_at <= now() - make_interval(secs => p_quiet_seconds))
       and not exists (select 1 from mcleod_write_state o
                        where o.org_id = s.org_id and o.requested_at > now() - interval '8 days' and o.operation = s.operation and o.company_id = s.company_id
                          and o.target_id = s.target_id and o.requested_at < s.requested_at
                          and o.state in ('queued','sent'))
     order by s.requested_at
  loop
    exit when v_n >= p_max;
    v_sw := mcleod_write_switch_current(p_org, r.operation, r.company_id);
    continue when v_sw.id is null or v_sw.mode = 'off';
    continue when v_sw.mode = 'test' and r.origin <> 'prove';
    continue when v_sw.mode = 'canary' and not coalesce(r.canary_key = any (v_sw.canary_keys), false);
    v_lease := gen_random_uuid();
    insert into mcleod_write_events (id, org_id, request_id, kind, lease_id, lease_expires_at, switch_id, instance_id, agent_version)
    values (v_lease, p_org, r.request_id, 'leased', v_lease, now() + make_interval(secs => p_lease_seconds), v_sw.id, p_instance, p_version);
    request_id := r.request_id; lease_id := v_lease; lease_expires_at := now() + make_interval(secs => p_lease_seconds);
    sends := r.sends; applied_reports := r.applied_reports;
    v_n := v_n + 1;
    return next;
  end loop;
end $$;

create function mcleod_write_begin_send(p_org uuid, p_request uuid, p_lease uuid, p_instance text,
                                        p_send_window_seconds int default 90, p_max_sends int default 3)
returns text language plpgsql as $$
declare s record; v_sw mcleod_write_switches;
begin
  perform pg_advisory_xact_lock(hashtextextended('mcleod_write:' || p_org::text, 0));
  select * into s from mcleod_write_state where request_id = p_request and org_id = p_org;
  if s.request_id is null then return 'not_found'; end if;
  if s.state in ('confirmed','refused','conflict') then return 'ended'; end if;
  if s.lease_id is distinct from p_lease or not s.lease_live then return 'lease_lost'; end if;
  if s.lease_expires_at < now() + make_interval(secs => p_send_window_seconds) then return 'lease_too_short'; end if;
  if s.applied_reports > 0 then return 'already_applied'; end if;
  if s.sends >= p_max_sends then return 'send_cap'; end if;
  v_sw := mcleod_write_switch_current(p_org, s.operation, s.company_id);
  if v_sw.id is null or v_sw.mode = 'off' or (v_sw.mode = 'test' and s.origin <> 'prove')
     or (v_sw.mode = 'canary' and not coalesce(s.canary_key = any (v_sw.canary_keys), false)) then return 'switched_off'; end if;
  insert into mcleod_write_events (org_id, request_id, kind, lease_id, instance_id) values (p_org, p_request, 'send_started', p_lease, p_instance);
  return 'go';
end $$;
