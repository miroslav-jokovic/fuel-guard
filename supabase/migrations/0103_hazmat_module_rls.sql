-- FuelGuard — 0103 HazmatGuard entitlement RLS (closes the D55/D56 layer-1 gap)
--
-- WHAT WAS WRONG. 0088 promised three enforcement layers for module entitlements:
--   1. RLS — "a disabled module's own tables return ZERO rows, even to a raw PostgREST call"
--   2. API — requireModule() 403s before any handler runs
--   3. UI  — a disabled module's surfaces never render
-- and stated "Layer 3 is courtesy. Layer 1 is the boundary (D10)."
--
-- Layer 2 shipped and is complete (routes/hazmat/index.ts applies requireModule router-wide).
-- Layer 1 WAS NEVER BUILT. `auth_module_enabled()` was defined in 0088 and then never called by a
-- single policy anywhere in the schema. Every hazmat policy keys on org_id/role only.
--
-- Measured on a real Postgres with 0001-0102 applied, as a non-superuser role with a fleet_manager
-- JWT, entitlement revoked (and again with the org_modules row deleted entirely):
--     auth_module_enabled('hazmatguard') = false        ← the helper was right
--     select from hazmat_loads           → 1 row        ← but nothing consulted it
--     insert into hazmat_loads           → INSERT 0 1   ← writes too
-- The web app talks to PostgREST directly with the user's JWT (composables/useModules.ts reads
-- org_modules that way), so this is a live path, not a theoretical one. Only the Express 403 stood
-- between a revoked tenant and their hazmat data — and anything holding a Supabase anon key could
-- step around it.
--
-- THE FIX. One RESTRICTIVE policy per hazmat table. RESTRICTIVE AND-combines with the existing
-- PERMISSIVE policies rather than replacing them, so the org/role rules in 0092 keep working exactly
-- as they do today and this adds a single extra condition: the tenant must actually own the module.
-- Same shape 0083 uses to narrow drivers to their own rows.
--
-- SCOPE. This is the tenant-facing boundary only. The service role has BYPASSRLS, so background
-- workers are NOT covered here by design — the queue handlers must check org_module_enabled()
-- themselves before writing (see services/queue/handlers/hazmat.ts).
--
-- Additive + idempotent. No existing policy is dropped or weakened.

do $$
declare
  t text;
begin
  foreach t in array array[
    'hazmat_loads',
    'hazmat_runs',
    'hazmat_documents',
    'hazmat_reviews',
    'hazmat_policies',
    'hazmat_cargo_tank_profiles'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_module_gate', t);
    -- `for all` covers select/insert/update/delete in one policy: USING filters the rows an existing
    -- row-returning command may touch, WITH CHECK refuses the write. Both must name the predicate.
    execute format(
      'create policy %I on %I as restrictive for all '
      'using (auth_module_enabled(''hazmatguard'')) '
      'with check (auth_module_enabled(''hazmatguard''))',
      t || '_module_gate', t
    );
  end loop;
end $$;

comment on function auth_module_enabled(text) is
  'Is this module enabled for the CALLING tenant (absent row = disabled)? Read by the RESTRICTIVE
   *_module_gate policies added in 0103. Service-role callers bypass RLS and must call
   org_module_enabled(org, key) explicitly instead.';
