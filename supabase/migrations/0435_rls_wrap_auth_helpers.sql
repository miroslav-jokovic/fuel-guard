-- 0435: every RLS policy evaluates auth_org_id() / auth_role() ONCE per statement, not once per row
-- (DATABASE-AUDIT-2026-10-03-PLAN Q-DA4, step 1 of 2 — owner approved 2026-10-05).
--
-- Both helpers are inlinable `language sql stable` functions that parse `request.jwt.claims` as jsonb.
-- Called bare in a policy (`org_id = auth_org_id()`), the parse repeats for every row the policy
-- filters. Wrapped as `(select auth_org_id())`, Postgres plans it as an InitPlan evaluated once.
--
-- ── MEASURED (production, 2026-10-05, read-only, the real fleet's org) ───────────────────────────
-- `select count(*) from idle_events where org_id = <helper>` (~205k rows), three runs each:
--   bare      210–216 ms
--   wrapped    65 ms
-- Policy text at the time: 201 bare auth_org_id() and 168 bare auth_role() uses, 0 wrapped.
--
-- ── WHY THIS IS STEP 1 ───────────────────────────────────────────────────────────────────────────
-- Step 2 (Q-DA4) makes the helpers consult the membership, so a suspended or demoted user loses
-- direct database access before the JWT expires. That costs one index lookup per evaluation — per
-- ROW while the calls are bare, per QUERY once they are wrapped. Wrapping first is what makes step 2
-- affordable. This step alone changes no result: same expressions, evaluated fewer times.
--
-- ── HOW ──────────────────────────────────────────────────────────────────────────────────────────
-- In place, with ALTER POLICY: names, commands, roles and permissive/restrictive stay exactly as they
-- are. Only `public` schema policies; only the two helpers. No policy is wrapped today (measured), so a
-- single pass is exact; the guard test below proves none is left bare or double-wrapped.
-- Guarded by supabase/tests/rls-wrapped-helpers.test.mjs, which fails if any migration after this one
-- adds a bare call. Rollback: none needed for behaviour; re-creating a policy bare restores the old cost.

do $$
declare
  p record;
  q text;
  c text;
  stmt text;
  changed int := 0;
begin
  for p in
    select pol.polname, cls.relname, pol.polqual, pol.polwithcheck, pol.polrelid
      from pg_policy pol
      join pg_class cls on cls.oid = pol.polrelid
      join pg_namespace n on n.oid = cls.relnamespace
     where n.nspname = 'public'
  loop
    q := pg_get_expr(p.polqual, p.polrelid);
    c := pg_get_expr(p.polwithcheck, p.polrelid);
    if coalesce(q, '') !~ '(auth_org_id|auth_role)\(\)' and coalesce(c, '') !~ '(auth_org_id|auth_role)\(\)' then
      continue;
    end if;
    stmt := format('alter policy %I on public.%I', p.polname, p.relname);
    if q is not null then
      stmt := stmt || ' using (' || regexp_replace(q, '(public\.)?(auth_org_id|auth_role)\(\)', '(select public.\2())', 'g') || ')';
    end if;
    if c is not null then
      stmt := stmt || ' with check (' || regexp_replace(c, '(public\.)?(auth_org_id|auth_role)\(\)', '(select public.\2())', 'g') || ')';
    end if;
    execute stmt;
    changed := changed + 1;
  end loop;
  raise notice '0435: % policies rewritten', changed;
end;
$$;
