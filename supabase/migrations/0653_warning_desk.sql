-- Silvicom 360 — 0652 warning desk: Samsara warnings and the follow-ups one person works
-- (docs/plans/maintenance/WARNING-DESK-PLAN.md WD1, D-WD4/D-WD6/D-WD9/D-WD10)
--
-- Samsara already warns the driver — a trailer losing air, a dying battery, a defect nobody fixed. What
-- nobody does is notice that it keeps happening and pick up the phone. These four tables are the whole
-- of that: what Samsara said (`samsara_warnings`), the problem a person should follow up
-- (`follow_ups`), what the person did (`follow_up_actions`), and the admin's choices of which warnings
-- count and how many times (`follow_up_rules`).
--
-- ── 1. ONE ROW PER WARNING, KEYED BY SAMSARA'S OWN IDENTITY ──────────────────────────────────────
-- `samsara_warnings` is the collector's staging (owner `samsara`, layer raw). Six sources fold into one
-- shape — an alert incident, a safety event, a DVIR defect, a trailer ATIS lamp episode, an engine lamp
-- episode, an HOS violation — so the desk reads one table, not six. `(org_id, source, source_key)` is
-- unique: `source_key` is the incident URL (unique per incident, measured 1,764 of 1,764), the safety
-- event id, the defect id, `<asset>:<onset>` for a lamp episode, `<driver>:<type>:<start>` for HOS. A
-- re-read refreshes the row in place (a full-row upsert, `lint:upserts`), so ended/resolved arrives on
-- the same row.
--
-- Units and drivers are Samsara ids and names, NOT roster foreign keys. Considered and rejected: a
-- `drivers(id)` FK obliges every merge to move the row (check-driver-references, the merge_driver
-- cascade trap), and a unit Samsara knows but the roster does not ("783 - OLD") would have nowhere to
-- go. The Samsara id is what the warning is about; the API joins it to the roster when it draws a line.
--
-- ── 2. NO LAMP STATE TABLE ───────────────────────────────────────────────────────────────────────
-- The plan's D-WD4 named a `samsara_lamp_states` table for lamp onsets. It is not needed: a lamp that
-- is on IS a warning row with `still_active`, and an "off" closes it. A lamp that comes back on within
-- 30 minutes re-opens the same row (a leaking tire cycles the ATIS lamp all day — 8,933 changes in 30
-- days on 120 trailers), so the desk sees episodes, never the 26,000 raw readings a day.
--
-- ── 3. ONE OPEN FOLLOW-UP PER PROBLEM ────────────────────────────────────────────────────────────
-- `follow_ups` is owned by the `followups` harness. The partial unique index is the promise "one open
-- line per (rule, unit-or-driver)": every repeat attaches to it. "Looks fixed" and "warned again after
-- the call" are NOT columns — both are derived when the line is drawn (`active_count = 0` and quiet for
-- a day; `last_at > contacted_at`), so nothing can leave them stale.
--
-- ── 4. EVERY ACTION IS A ROW, AND STATUS MOVES THROUGH ONE DOOR ──────────────────────────────────
-- `follow_up_actions` is append-only by trigger (WD011), which fires for the service role too — the
-- API holds that key, so RLS alone would leave the record editable by the one caller that matters
-- (0331's IV011 reasoning). `transition_follow_up` validates, moves the status and writes the action
-- row in one transaction under an optimistic version (0158's `transition_anomaly` shape). The collector
-- tick updates counts on the same rows but never the status or the version, so a person's click is
-- never refused because a warning arrived meanwhile.
--
-- ── 5. RLS ───────────────────────────────────────────────────────────────────────────────────────
-- Enabled with no client policy on all four: deny-all for the browser. Every read and write goes
-- through the API, which gates on the `maintenance.follow-ups` screen (D-WD1) and org-scopes itself.
--
-- New tables only, so `lint:migration-ordering` does not apply. Retention: `samsara_warnings` 90 days
-- (RETENTION_RULES); follow-ups and their actions are kept — they are the record of who told which
-- driver what.
--
-- cross-module-waiver: one feature born in one migration — the collector's staging (`samsara_warnings`,
-- owner samsara) and the desk's three tables (owner followups) arrive together so the desk's first tick
-- finds both. No table of either module is written by the other: the collector writes only its staging,
-- and the desk reads it through modules/samsara's exported reads (orchestration/warningDesk.ts).
--
-- Rollback: `drop function transition_follow_up; drop table follow_up_actions, follow_ups,
-- follow_up_rules, samsara_warnings; drop function guard_follow_up_actions_append_only;`

-- ── 1. what Samsara said ────────────────────────────────────────────────────────────────────────
create table if not exists public.samsara_warnings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  source              text not null check (source in ('alert', 'safety', 'dvir', 'atis', 'lamp', 'hos')),
  source_key          text not null check (length(btrim(source_key)) > 0),
  -- The rule kind this warning counts toward: 'alert:<configurationId>', 'safety_serious', 'atis', …
  -- (packages/shared/src/followUpRules.ts is the one catalogue).
  kind                text not null check (length(btrim(kind)) > 0),
  subject_kind        text not null check (subject_kind in ('truck', 'trailer', 'driver')),
  vehicle_samsara_id  text,
  trailer_samsara_id  text,
  driver_samsara_id   text,
  unit_name           text,
  driver_name         text,
  label               text not null,
  happened_at         timestamptz not null,
  ended_at            timestamptz,
  still_active        boolean not null default false,
  samsara_url         text,
  -- Small on purpose: what the desk shows beside the label, never a vendor payload.
  detail              jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2048),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint samsara_warnings_org_source_key unique (org_id, source, source_key)
);
comment on table public.samsara_warnings is
  '0652 (WARNING-DESK-PLAN D-WD4): every Samsara warning the desk counts — alert incidents, safety events, DVIR defects, ATIS and engine lamp episodes, HOS violations — in one shape, keyed by Samsara ids. Written by modules/samsara/warnings only; kept 90 days.';
create index if not exists idx_samsara_warnings_org_updated on public.samsara_warnings (org_id, updated_at desc);
create index if not exists idx_samsara_warnings_org_kind_time on public.samsara_warnings (org_id, kind, happened_at desc);
create index if not exists idx_samsara_warnings_org_active on public.samsara_warnings (org_id, source) where still_active;
alter table public.samsara_warnings enable row level security;

-- ── 2. the admin's choices ──────────────────────────────────────────────────────────────────────
-- Only an override is stored; the default for every kind is derived from the shared catalogue, so a
-- configuration added in Samsara tomorrow arrives with a default and nothing to code (D-WD10). A saved
-- row is always whole — all columns — never a partial payload.
create table if not exists public.follow_up_rules (
  org_id            uuid not null references public.organizations(id) on delete cascade,
  rule_key          text not null check (length(btrim(rule_key)) > 0),
  enabled           boolean not null,
  threshold_count   int not null check (threshold_count between 1 and 50),
  window_days       int not null check (window_days between 1 and 30),
  min_active_hours  int not null default 0 check (min_active_hours between 0 and 720),
  category          text not null check (category in ('maintenance', 'safety', 'compliance', 'route')),
  severity          text not null check (severity in ('urgent', 'high', 'normal')),
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (org_id, rule_key)
);
comment on table public.follow_up_rules is
  '0652 (D-WD10): an admin''s override of one follow-up rule (which warnings count, the Nth time, the window). Absent row = the catalogue default in followUpRules.ts.';
alter table public.follow_up_rules enable row level security;

-- ── 3. the follow-ups ───────────────────────────────────────────────────────────────────────────
create table if not exists public.follow_ups (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  rule_key            text not null,
  category            text not null check (category in ('maintenance', 'safety', 'compliance', 'route')),
  severity            text not null check (severity in ('urgent', 'high', 'normal')),
  subject_kind        text not null check (subject_kind in ('truck', 'trailer', 'driver')),
  subject_samsara_id  text not null check (length(btrim(subject_samsara_id)) > 0),
  subject_name        text,
  -- The driver Samsara named on the latest warning, when it named one. The API adds who holds the
  -- unit now (D-WD15); this is what the warning itself said.
  driver_samsara_id   text,
  driver_name         text,
  status              text not null default 'new' check (status in ('new', 'called', 'sent_to_shop', 'closed')),
  outcome             text check (outcome in ('fixed', 'not_a_problem')),
  warning_count       int not null default 0 check (warning_count >= 0),
  active_count        int not null default 0 check (active_count >= 0),
  first_at            timestamptz not null,
  last_at             timestamptz not null,
  -- The last time a person reached the driver or sent the unit to the shop. A warning after it is
  -- "warned again after the call" — derived, never stored.
  contacted_at        timestamptz,
  assignee_id         uuid references auth.users(id) on delete set null,
  version             int not null default 1,
  closed_at           timestamptz,
  closed_by           uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint follow_ups_closed_has_outcome check ((status = 'closed') = (outcome is not null)),
  constraint follow_ups_closed_has_time check ((status = 'closed') = (closed_at is not null))
);
comment on table public.follow_ups is
  '0652 (D-WD6): one problem a person should follow up — every repeat of the same rule on the same truck, trailer or driver. Opened by the followups evaluator at the Nth warning; status moves only through transition_follow_up.';
create unique index if not exists uq_follow_ups_open_problem
  on public.follow_ups (org_id, rule_key, subject_kind, subject_samsara_id) where status <> 'closed';
create index if not exists idx_follow_ups_org_status on public.follow_ups (org_id, status, last_at desc);
create index if not exists idx_follow_ups_org_closed on public.follow_ups (org_id, rule_key, subject_kind, subject_samsara_id, closed_at desc)
  where status = 'closed';
alter table public.follow_ups enable row level security;

-- ── 4. what the person did ──────────────────────────────────────────────────────────────────────
create table if not exists public.follow_up_actions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  follow_up_id  uuid not null references public.follow_ups(id) on delete cascade,
  action        text not null check (action in (
                  'called', 'no_answer', 'sent_to_shop', 'note', 'assigned',
                  'closed_fixed', 'closed_not_a_problem')),
  from_status   text not null,
  to_status     text not null,
  note          text check (note is null or length(note) <= 2000),
  actor_id      uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
comment on table public.follow_up_actions is
  '0652 (D-WD9): append-only record of every action on a follow-up — who called which driver, sent which unit to the shop, closed it and why. Written only by transition_follow_up.';
create index if not exists idx_follow_up_actions_follow_up on public.follow_up_actions (follow_up_id, created_at);
alter table public.follow_up_actions enable row level security;

create or replace function public.guard_follow_up_actions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'follow_up_actions is append-only: a correction is a new action'
    using errcode = 'WD011';
end;
$$;

drop trigger if exists trg_follow_up_actions_append_only on public.follow_up_actions;
create trigger trg_follow_up_actions_append_only
  before update or delete on public.follow_up_actions
  for each row
  execute function public.guard_follow_up_actions_append_only();

-- ── 5. the one door a status moves through ──────────────────────────────────────────────────────
-- SQLSTATEs: WD012 not found · WD013 version conflict · WD014 invalid action for the status ·
-- WD015 a note is required (a note action, or closing as "not a problem").
create or replace function public.transition_follow_up(
  p_org_id            uuid,
  p_follow_up_id      uuid,
  p_actor_id          uuid,
  p_action            text,
  p_note              text,
  p_expected_version  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_version  int;
  v_target   text;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_now      timestamptz := now();
begin
  select status, version into v_status, v_version
    from public.follow_ups
   where id = p_follow_up_id and org_id = p_org_id
   for update;
  if not found then
    raise exception 'not_found: follow-up % does not exist in org %', p_follow_up_id, p_org_id using errcode = 'WD012';
  end if;
  if v_version <> p_expected_version then
    raise exception 'conflict: follow-up version is %, expected %', v_version, p_expected_version using errcode = 'WD013';
  end if;
  if v_status = 'closed' then
    raise exception 'invalid_action: a closed follow-up takes no further action' using errcode = 'WD014';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'invalid_action: note exceeds 2000 characters' using errcode = 'WD014';
  end if;

  v_target := case p_action
    when 'called' then 'called'
    when 'sent_to_shop' then 'sent_to_shop'
    when 'closed_fixed' then 'closed'
    when 'closed_not_a_problem' then 'closed'
    when 'no_answer' then v_status
    when 'note' then v_status
    when 'assigned' then v_status
    else null
  end;
  if v_target is null then
    raise exception 'invalid_action: unknown action %', p_action using errcode = 'WD014';
  end if;
  if p_action in ('note', 'closed_not_a_problem') and v_note is null then
    raise exception 'note_required: % needs a note', p_action using errcode = 'WD015';
  end if;

  update public.follow_ups
     set status       = v_target,
         outcome      = case p_action when 'closed_fixed' then 'fixed'
                                      when 'closed_not_a_problem' then 'not_a_problem' else null end,
         closed_at    = case when v_target = 'closed' then v_now else null end,
         closed_by    = case when v_target = 'closed' then p_actor_id else null end,
         contacted_at = case when p_action in ('called', 'sent_to_shop') then v_now else contacted_at end,
         assignee_id  = case when p_action = 'assigned' then p_actor_id else coalesce(assignee_id, p_actor_id) end,
         version      = v_version + 1,
         updated_at   = v_now
   where id = p_follow_up_id and org_id = p_org_id;

  insert into public.follow_up_actions (org_id, follow_up_id, action, from_status, to_status, note, actor_id, created_at)
  values (p_org_id, p_follow_up_id, p_action, v_status, v_target, v_note, p_actor_id, v_now);

  return jsonb_build_object('follow_up_id', p_follow_up_id, 'from_status', v_status, 'to_status', v_target,
                            'version', v_version + 1);
end;
$$;

revoke all on function public.transition_follow_up(uuid, uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.transition_follow_up(uuid, uuid, uuid, text, text, int) to service_role;
comment on function public.transition_follow_up(uuid, uuid, uuid, text, text, int) is
  '0652 (D-WD9): validates and applies one action on a follow-up — status, outcome, contact time, assignee and version — and writes its append-only action row, in one transaction.';
