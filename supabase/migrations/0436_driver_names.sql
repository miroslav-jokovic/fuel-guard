-- 0436: driver_names() — the name-only surface (DATABASE-AUDIT-2026-10-03-PLAN Q-DA3, step 1 of 3;
-- owner approved 2026-10-05).
--
-- Finding 1: a role with the roster section set to `none` still reads every `drivers` column in its
-- org (measured 2026-10-03: 292 driver rows read by a simulated fleet_manager with roster none). The
-- table cannot simply be gated by roster, because roles without roster legitimately need driver NAMES:
-- an accountant reads fuel lines by driver; idling and performance list names. So names get their own
-- surface first, the readers move to it (step 2), and only then is `drivers` gated (step 3).
--
-- ── WHY SECURITY DEFINER ─────────────────────────────────────────────────────────────────────────
-- An invoker function or view would inherit the very roster gate step 3 adds and go blank with it.
-- So it runs as owner and does its own scoping, which is the whole of its contract:
--   · org: the caller's own (`auth_org_id()`, from the JWT) — no org argument exists to pass;
--   · a `driver` login sees only its own row (the rule `drivers_driver_scope` enforces on the table);
--   · columns: id and full_name only — never CDL number, date of birth, phone, address or pay;
--   · anon: no execute.
-- It is the first client-callable definer function outside the RLS helpers, so
-- supabase/tests/definer-rpc-grants.test.mjs names it in a separate allowlist with this reason.
--
-- Reads every status (terminated included): names are needed for history — a fill from last year still
-- shows who fuelled. Deploy window: additive; nothing calls it until step 2.

create or replace function public.driver_names()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.full_name
    from public.drivers d
   where d.org_id = (select public.auth_org_id())
     and ((select public.auth_role()) is distinct from 'driver' or d.id = (select public.auth_driver_id()))
   order by d.full_name;
$$;

revoke all on function public.driver_names() from public, anon;
grant execute on function public.driver_names() to authenticated, service_role;

comment on function public.driver_names() is
  'Name-only driver list for the caller''s org (Q-DA3): id and full_name, every status; a driver login sees only itself. Definer on purpose so a roster gate on drivers cannot blank names other sections need.';
