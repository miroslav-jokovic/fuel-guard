-- FuelGuard — 0161 hazmat draft closure + org_id immutability (audit 2026-08-09, Stage 1)
--
-- Two defects, one theme: a write path that trusts a parameter instead of the caller. The third
-- defect in this set — SECURITY DEFINER functions granted to `authenticated` — is 0162, split out
-- so that this file references no Supabase-managed role and the self-contained HazmatGuard matrix
-- (supabase/tests/hazmat_rls.test.mjs, which applies 0092 and nothing else) can apply it verbatim.
--
-- 1. hazmat_loads_driver_update's WITH CHECK omitted org_id and status. USING correctly pinned both
--    (own row, status='draft'), but WITH CHECK governs the POST-update row, so a driver could PATCH
--    their own draft to status='cleared' — bypassing the hazmat_reviews separation of duties that
--    0092 was written to enforce — or rewrite org_id and inject the row into another tenant. It was
--    the only permissive policy in the whole schema whose WITH CHECK had no org_id. 0092's header
--    says the state machine "is enforced in the API"; the API is not the only door, and 0103's own
--    header records a measured direct-PostgREST write against this table with a fleet_manager JWT.
--
-- 2. Nothing anywhere stopped an UPDATE from moving a row between tenants. org_id is identity, not
--    data: no legitimate code path in this repository rewrites it. Enforcing that as an invariant in
--    the database — rather than per policy, where it was already forgotten once — is what makes the
--    class of bug above unrepeatable rather than merely fixed.
--
-- Rollback: drop trigger trg_<t>_org_immutable on each table; drop function public.forbid_org_change();
--           restore the 0092 policy body.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. hazmat_loads: a driver may only ever edit their OWN DRAFT, and it stays their own draft.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists hazmat_loads_driver_update on public.hazmat_loads;
create policy hazmat_loads_driver_update on public.hazmat_loads for update
  using (
    org_id = auth_org_id()
    and auth_role() = 'driver'
    and created_by = auth_user_id()
    and status = 'draft'
  )
  with check (
    org_id = auth_org_id()
    and auth_role() = 'driver'
    and created_by = auth_user_id()
    and status = 'draft'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. org_id is immutable on every tenant table.
--
-- Fires only when org_id actually changes, so ordinary updates are untouched (one uuid comparison).
-- It applies to the service role too, deliberately: the API's own bugs are in scope. A genuine
-- cross-tenant move — a merge, a demo reset — should be a deliberate operation that disables the
-- trigger explicitly and says so in a migration.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.forbid_org_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception
      'org_id is immutable on %.% (row %): a tenant row cannot be moved between organizations',
      tg_table_schema, tg_table_name, old
      using errcode = 'TG001';
  end if;
  return new;
end;
$$;

comment on function public.forbid_org_change() is
  'Refuses any UPDATE that rewrites org_id. Attached to every public table carrying an org_id column (0161).';

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'org_id'
       and a.attnum > 0
       and not a.attisdropped
     order by 1
  loop
    execute format('drop trigger if exists %I on public.%I',
                   'trg_' || r.table_name || '_org_immutable', r.table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.forbid_org_change()',
      'trg_' || r.table_name || '_org_immutable', r.table_name);
  end loop;
end;
$$;
