-- FleetGuard — 0009 notification settings + audit triggers (Phase 8 hardening)
-- docs/03-ROADMAP.md Phase 8, audit H9. Adds org notification config and DB-level audit triggers so
-- client-side (direct-to-Supabase) changes to vehicles/drivers/thresholds are recorded in audit_logs
-- (which is otherwise service-role-write only).

alter table organizations
  add column notification_emails text[] not null default '{}',
  add column notifications_enabled boolean not null default true;

-- ── audit trigger: generic for tables with an `id` + `org_id` (vehicles, drivers) ──
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_id    uuid;
  v_actor uuid;
begin
  if (tg_op = 'DELETE') then
    v_org := old.org_id; v_id := old.id;
  else
    v_org := new.org_id; v_id := new.id;
  end if;
  v_actor := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id)
  values (v_org, v_actor, tg_argv[0] || '.' || lower(tg_op), tg_table_name, v_id);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

create trigger audit_vehicles after insert or update or delete on vehicles
  for each row execute function audit_row_change('vehicle');
create trigger audit_drivers after insert or update or delete on drivers
  for each row execute function audit_row_change('driver');

-- ── audit trigger: anomaly_thresholds (PK is org_id, no `id` column) ──
create or replace function audit_threshold_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
begin
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id)
  values (new.org_id, v_actor, 'threshold.' || lower(tg_op), 'anomaly_thresholds', new.org_id);
  return new;
end;
$$;

create trigger audit_thresholds after insert or update on anomaly_thresholds
  for each row execute function audit_threshold_change();
