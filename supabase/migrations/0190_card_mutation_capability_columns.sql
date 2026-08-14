-- 0190 — capability columns on the card-mutation ledger (Phase 3 Step 3.2).
--
-- Additive and nullable, because every row written before Phase 3 predates the capability registry
-- and there is nothing truthful to backfill them with. A null `capability_key` means "written by the
-- pre-registry orchestrator"; `intent` still answers the audit question for those rows, which is why
-- it stays and is not replaced.
--
-- ── Why capability_key AND request_body, when intent already exists ─────────────────────────────
-- `intent` is the COARSE, CHECK-constrained audit key — five values, one per thing a person did.
-- `capability_key` is the FINE key that names the descriptor. They are not redundant: several
-- capabilities can share one intent (docs/27 §5.2), and the reconciler needs the descriptor, not the
-- audit label.
--
-- Together with `request_body` they are what makes background reconciliation of direct operations
-- work at all. A `sent` row read out of the database can find its descriptor and re-run the
-- capability's own `verify.judge` against the body originally submitted. Without both, "did it land"
-- can only be a function of the after-state — which is true for exactly one capability we have today
-- and false for every one Phases 8-12 add.
--
-- `request_body` is REDACTED at the point of writing, in application code. Nothing here can enforce
-- that, so it is stated as a contract: the column must never receive a PAN, a PIN, or a password.
-- efsCardMutationEvidence.ts is the only place that should populate it.

alter table efs_card_mutations
  add column if not exists capability_key text,
  add column if not exists request_body jsonb,
  add column if not exists step_index int;

comment on column efs_card_mutations.capability_key is
  'Fine-grained capability descriptor key for this write, such as override_grant; null means the row predates the Phase 3 capability registry and only its coarse intent is known.';
comment on column efs_card_mutations.request_body is
  'REDACTED request body as submitted, so a reconciler can re-judge a sent row against the original input. Never a PAN, PIN or password. Null means the row predates the capability registry.';
comment on column efs_card_mutations.step_index is
  'Zero-based position within a multi-step capability sequence; null for the single-step capabilities that are all we have today.';

-- ── 'partial': terminal, but actionable ─────────────────────────────────────────────────────────
-- A sequenced capability that completed some steps and failed one is not 'failed' — that would say
-- nothing happened, and something did. It is not 'succeeded' either. Recovery is a re-run from
-- `step_index`, so the state has to be distinguishable from both (docs/27 §5.1).
--
-- The old constraint is dropped BY LOOKUP rather than by name. 0177 declared it inline on the column,
-- so its name is whatever Postgres generated; a `drop constraint if exists` against a guessed name
-- would silently do nothing and then this migration would add a second constraint alongside the
-- first, leaving 'partial' still rejected. That failure would be quiet at deploy time and loud months
-- later, on the first sequenced capability.
do $$
declare
  existing record;
begin
  for existing in
    select conname
      from pg_constraint
     where conrelid = 'efs_card_mutations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%drift_detected%'
  loop
    execute format('alter table efs_card_mutations drop constraint %I', existing.conname);
  end loop;
end $$;

alter table efs_card_mutations
  add constraint efs_card_mutations_status_check
  check (status in ('pending', 'sent', 'succeeded', 'failed', 'drift_detected', 'partial'));

-- ── efs_card_control_approvers.scopes is deliberately NOT widened here ──────────────────────────
-- Step 3.2 as written also widens the 0173 scopes CHECK. There is nothing to widen it to.
--
-- Phase 3 migrates the five capabilities that already exist — card_lock, card_unlock, override_grant,
-- override_clear, prompts_set — and every one of them maps to a scope the constraint already permits
-- (lock, unlock, override, prompts). The first genuinely new scope arrives with `card_deactivate` in
-- Phase 8.1.
--
-- Adding values now would permit scopes no capability defines, which is the speculative schema that
-- docs/27 rules out ("the abstraction may only accommodate cases that exist in code today"), and it
-- would spend the reviewable act that Step 0.12 deliberately made explicit: widening the CHECK is how
-- a new scope announces itself. Phase 8.1 must widen it, in the same migration that adds the
-- capability and its grant statement.
