-- 0411 — sync_fuel_exceptions and bump_card_write_counter become callable by the service role ONLY
-- (security audit 2026-10-02; the intent was already written in 0178, 0250, 0253 and 0320 — this is
-- the migration that makes it true).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- Both functions are SECURITY DEFINER and take the tenant as a BODY PARAMETER (`p_org`, and
-- `p_user` on the counter). Neither reads `auth.uid()` or the JWT: the API passes the org it derived
-- from the verified token, and the function trusts it. That is a sound shape ONLY while the database
-- refuses everyone but the API, and every one of those four migrations said it did:
--
--     revoke all on function … from public;
--     grant execute on function … to service_role;
--
-- It did not. On Supabase the platform's default privileges grant EXECUTE on every new function in
-- `public` straight to `anon`, `authenticated` and `service_role` — production's `pg_default_acl` reads
-- `postgres=X, anon=X, authenticated=X, service_role=X` — so there is no PUBLIC entry for that revoke
-- to remove. Measured on production 2026-10-02: `has_function_privilege('anon', …, 'execute')` was
-- true for both, `proacl` listed `anon=X/postgres` and `authenticated=X/postgres`.
--
-- What that exposes through PostgREST at /rest/v1/rpc/<name>, to anyone holding the public anon key
-- plus ONE valid organisation id (any logged-in tenant can read their own):
--   · `sync_fuel_exceptions` inserts, refreshes and CLOSES rows in `fuel_exceptions` for the org it is
--     handed. Closing is the dangerous half (0320, the `if p_kinds is not null …` block): with an
--     empty findings array, the producer's kinds and a period, every `open` or `investigating`
--     exception of those kinds in that window moves to `resolved_by_reingest`, and a
--     `fuel_exception_events` row is written with the CALLER-SUPPLIED `p_actor` as `actor_id` and a
--     note saying a later reconciliation no longer produced the finding. The ledger reads clean and
--     the audit trail blames whoever the caller named. A later genuine sync reopens a row only if it
--     still produces that finding (0320's `resolved_by_reingest` → `open` case).
--   · `bump_card_write_counter` charges a slot against any user's daily cap. `card_override` and
--     `card_prompts` fail CLOSED when the cap is reached (0178), so burning another user's allowance
--     locks them out of card control until midnight UTC.
-- Whether anyone has called either is NOT KNOWN: this audit read the catalog and the code, not
-- PostgREST request logs. Both functions write, so neither was called on production to demonstrate
-- it; the grants and the bodies answer the question without that.
--
-- ── WHY THIS SHAPE ──────────────────────────────────────────────────────────────────────────────
-- Revoke from `public, anon, authenticated` BY NAME, then re-grant `service_role` explicitly. This is
-- the register 0395, 0398 and 0402 already use for their definer functions. Naming `anon` and
-- `authenticated` is the whole fix — `public` is kept so the statement states the full intent and
-- keeps working if the platform's default ever changes. The explicit service_role grant is a no-op
-- today and documents who the caller is; it is what a reader greps for.
--
-- Signatures are written out in full and will ERROR if one is wrong. That is deliberate: a revoke that
-- silently matched nothing is the exact failure this migration exists to fix. Production has exactly
-- one overload of each (`select oid::regprocedure from pg_proc where proname in (…)`, 2026-10-02),
-- because 0253 and 0320 changed the argument list and dropped the old one.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- Order-independent, so nothing here needs two merges. Every caller reaches both functions through
-- `getSupabaseAdmin` (the service-role key): cardWriteLimit.ts, fuelReconRun.ts, fuelPolicyScan.ts, via
-- statements.ts and fuelSpendRollupScheduler.ts. The one anon-key client in the API (routes/auth.ts)
-- only calls `signInWithPassword`; apps/web, apps/driver and apps/admin never name either function.
-- `service_role` keeps EXECUTE before and after, so code served ahead of OR behind this migration
-- behaves identically. It touches no column, no table and no function body.
--
-- ── WHAT WAS REJECTED ───────────────────────────────────────────────────────────────────────────
-- · A caller check inside the bodies (`if p_org is distinct from auth_org_id()`). The API legitimately
--   calls both with the service role, where there is no JWT, so the check would have to special-case
--   exactly the caller that matters. Removing the surface beats guarding it, and a rule the grant
--   already expresses does not need a second statement of it inside two function bodies.
-- · `alter default privileges … revoke execute on functions from anon, authenticated`, which would
--   stop the NEXT function repeating this. Right idea, bigger blast radius: it changes what every
--   future function gets, including RLS helpers that MUST stay callable, so it is the owner's call
--   rather than a rider on a two-function fix. Until it is made, the class is guarded in CI by
--   `supabase/tests/definer-rpc-grants.test.mjs` ("no SECURITY DEFINER function outside the RLS
--   helpers is executable by anon or authenticated").
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- `grant execute on function … to anon, authenticated` restores the old state, and nothing should ask
-- for it: no caller uses either role.
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select proname, has_function_privilege('anon', oid, 'execute') anon,
--          has_function_privilege('authenticated', oid, 'execute') auth,
--          has_function_privilege('service_role', oid, 'execute') svc
--     from pg_proc where proname in ('sync_fuel_exceptions', 'bump_card_write_counter');
--   -- expect anon=false, auth=false, svc=true on both rows.

revoke all on function public.sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[], date, date)
  from public, anon, authenticated;
revoke all on function public.bump_card_write_counter(uuid, uuid, text, int)
  from public, anon, authenticated;

grant execute on function public.sync_fuel_exceptions(uuid, uuid, jsonb, uuid, text[], date, date)
  to service_role;
grant execute on function public.bump_card_write_counter(uuid, uuid, text, int)
  to service_role;
