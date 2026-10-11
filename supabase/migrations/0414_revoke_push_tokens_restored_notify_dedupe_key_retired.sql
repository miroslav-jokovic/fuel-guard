-- 0414 — production gets `revoke_push_tokens` back, and the replay stops carrying `notify_dedupe_key`
-- (database audit 2026-10-03, finding 5; RELEASE-TRAIN-PLAN.md Q-REL6, function half).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- Production's ledger says 0089 ran, and production lacks two of the functions 0089 creates
-- (`select proname from pg_proc` 2026-10-03: `emit_notification` and `notification_allowed` are there,
-- these two are not). The plan's reading is that they were dropped out of band; the other reading is that
-- 0089 was edited after it was applied. Either way a clean replay of the migrations builds a database
-- production is not, so CI tests a function production does not have.
--
-- ── revoke_push_tokens: RESTORED, because the API calls it ──────────────────────────────────────
-- members.ts (offboarding), driverCredentials.ts and messaging/notify.ts:101 call it on sign-out and
-- when someone is removed. On production the RPC returns "function not found", `revokePushTokens` logs
-- `[notify] token revocation failed` and returns 0, and nothing else notices. The audit's reading is
-- right on the cost: a removed driver's personal phone keeps its token (0089's own header: "no token
-- expiry window fixes that"). Measured 2026-10-03: 2 tokens exist, both unrevoked. Delivery to a former
-- user was not demonstrated.
-- The body is 0089's, character for character: a reconciliation restores the intended behaviour, it does
-- not redesign it. One property is worth a reader's attention and is left alone — it revokes by
-- `user_id` across every organisation, so removing a user from one carrier revokes their tokens for
-- another they also belong to. 0089 (D14/D53) chose that; it is recorded as an open question, not
-- changed here.
-- ACL: service role only, the same as `emit_notification` beside it. It is SECURITY DEFINER and takes
-- the user as a parameter, so a client-callable copy would let anyone revoke anyone's push tokens —
-- the exact shape 0162, 0411 and 0412 closed elsewhere.
--
-- ── notify_dedupe_key: RETIRED, because nothing calls it ────────────────────────────────────────
-- No SQL body in production references it and no TypeScript calls it: callers build their own keys
-- (`fuel:stale:${orgId}:${day}` in fuelSweepFreshness.ts, and the rest of messaging), and 0162 already
-- notes that "existing projects can legitimately lack 0089's dedupe helper". Restoring a pure function
-- with no caller to make a diff clean would be a copy of a rule nobody reads. It is dropped from the
-- replay instead, so migrations, production and staging agree. If an owner wants one shared key
-- builder, that is a new function with a caller, written when its first reader is.
-- THIS IS A JUDGEMENT CALL the owner can overrule before merge: restoring it is a one-line
-- `create or replace function` and changes nothing else. Staging has the function and production does
-- not; this migration removes it from staging.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- Order-independent. The reader already exists and already tolerates a missing function (logs, returns
-- 0), so code served ahead of this migration behaves as it does today and code served after it starts
-- working. A new function is not a column. On the replay the `create or replace` is a no-op (the
-- function exists with this body) and the drop removes a function nothing uses.
-- ONE BEHAVIOUR CHANGE TO EXPECT: once restored, sign-out and offboarding start revoking tokens. That
-- is the intended behaviour; the 2 unrevoked tokens will be revoked when those events happen.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- `drop function public.revoke_push_tokens(uuid)` returns production to its present state. The dropped
-- helper is restored from 0089 lines 150–155.
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select proname, proacl::text from pg_proc where pronamespace = 'public'::regnamespace
--    and proname in ('revoke_push_tokens', 'notify_dedupe_key');
--   -- expect one row, revoke_push_tokens, {postgres=X, service_role=X}. Then call it for a user with no
--   -- tokens inside a DO block that raises, so nothing persists: expect 0, not "function not found".

create or replace function public.revoke_push_tokens(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.device_push_tokens
     set revoked_at = now()
   where user_id = p_user and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_push_tokens(uuid) from public, anon, authenticated;
grant execute on function public.revoke_push_tokens(uuid) to service_role;

drop function if exists public.notify_dedupe_key(text, uuid, timestamptz);
