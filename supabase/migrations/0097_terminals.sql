-- FuelGuard — 0097 terminals (Master Data & Identity, M1 · plan §2.1)
--
-- The first piece of admin-owned MASTER DATA. Everything before this migration described equipment
-- and people as telematics saw them; a terminal is a fact only the office knows — where a driver
-- domiciles, which yard a tractor lives at, whose clock an HOS day runs on.
--
-- Deliberately thin: code + name + timezone. It exists now because `drivers`, `vehicles` and
-- `trailers` all gain a `home_terminal_id` in 0098–0100 and the FK target must precede them.
--
-- RLS mirrors the section matrix in packages/shared/src/auth.ts: read = anyone in the org,
-- write = rolesThatManage('fleet') = admin | fleet_manager | safety_manager.

create table if not exists terminals (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  /** Short operational label the office already uses on paperwork — e.g. 'CHI', 'DAL'. */
  code       text not null,
  name       text not null,
  /** IANA zone ('America/Chicago'). Null = fall back to the org's zone. */
  timezone   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create index if not exists idx_terminals_org on terminals(org_id);

alter table terminals enable row level security;

drop policy if exists terminals_select on terminals;
create policy terminals_select on terminals
  for select using (org_id = auth_org_id());

drop policy if exists terminals_write on terminals;
create policy terminals_write on terminals
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

drop trigger if exists trg_terminals_updated on terminals;
create trigger trg_terminals_updated before update on terminals
  for each row execute function set_updated_at();

comment on table terminals is
  'Admin-owned domicile/yard master data. FK target for drivers.home_terminal_id,
   vehicles.home_terminal_id and trailers.home_terminal_id (0098-0100).';
