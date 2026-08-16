-- 0199 — `card_deactivate` announces itself: a new ledger intent and a new approver scope (Phase 8.1).
--
-- This is the migration 0190 reserved. Its closing note says so in as many words: "The first
-- genuinely new scope arrives with `card_deactivate` in Phase 8.1. … Phase 8.1 must widen it, in the
-- same migration that adds the capability and its grant statement." Widening the CHECK is how a new
-- scope announces itself, and doing it here rather than in 0190 is what kept the constraint from
-- permitting a scope no capability defined.
--
-- ── Why `deactivate` is not simply folded into `lock` ───────────────────────────────────────────
-- Retiring a card and pausing one are different acts with different consequences, and until now the
-- ledger could not tell them apart: `card_lock` wrote both `Hold` and `Inactive` under intent
-- 'lock', so `CardChangeLog.vue` rendered "Locked card" for a retirement. That is the
-- audit-mislabelling half of audit P0-3 — "a lock-only approver could reactivate a Fraud-held card
-- while the audit row said card.locked" — reproduced on the one screen an operator opens to find out
-- what happened to a card.
--
-- The scope split is the other half. It grants no new power over fuel — deactivating STOPS fuel, the
-- same safe direction as a lock — but it makes the split in 0173's own header expressible: "let a
-- yard manager lock a stolen card at 2am without letting them" retire it from the fleet.
--
-- ── The grant statement, and why existing approvers keep working ────────────────────────────────
-- Every approver row predates this scope, so without a backfill `card_deactivate` would promote,
-- pass every gate, and be refused for every human being — a capability dead on arrival with
-- `not_approver` as its only explanation. The backfill gives `deactivate` to whoever already holds
-- `lock`, which changes nobody's power: they could already write Inactive through the lock route,
-- which is exactly what this migration takes away. Anyone who should NOT retire cards is now a row
-- an admin can narrow, which was impossible before.

-- ── The ledger intent ───────────────────────────────────────────────────────────────────────────
-- Dropped BY LOOKUP, not by name. 0177 declared this constraint inline on the column, so its name is
-- whatever Postgres generated; a `drop constraint if exists` against a guessed name would silently
-- do nothing and leave a second constraint alongside the first, still rejecting 'deactivate'. Quiet
-- at deploy time, loud on the first retirement. Same reasoning, and same idiom, as 0190's status
-- widening — matched on 'override_grant' because that string appears in the intent CHECK and in no
-- other constraint on this table.
do $$
declare
  existing record;
begin
  for existing in
    select conname
      from pg_constraint
     where conrelid = 'efs_card_mutations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%override_grant%'
  loop
    execute format('alter table efs_card_mutations drop constraint %I', existing.conname);
  end loop;
end $$;

alter table efs_card_mutations
  add constraint efs_card_mutations_intent_check
  check (intent in ('lock', 'unlock', 'deactivate', 'override_grant', 'override_clear', 'prompts_set'));

comment on column efs_card_mutations.intent is
  'Coarse audit key — one value per thing a person did. deactivate is retiring a card (status Inactive); lock is pausing one (status Hold). Both were intent lock before migration 0199, so rows older than it record a retirement as a lock.';

-- ── The approver scope ──────────────────────────────────────────────────────────────────────────
-- This one 0173 named, so it drops by name.
alter table efs_card_control_approvers
  drop constraint if exists efs_card_control_approver_scopes_valid;

alter table efs_card_control_approvers
  alter column scopes set default array['lock', 'unlock', 'deactivate', 'override', 'prompts'];

-- ⚠ `cardinality`, not `array_length` — 0173's non-empty half has never actually held.
--
-- Found 2026-08-16 while validating this migration against a scratch database: an approver row with
-- `scopes = '{}'` was ACCEPTED. `array_length('{}', 1)` is NULL rather than 0, `NULL >= 1` is NULL,
-- and a CHECK constraint only rejects a row when its expression is FALSE — so the clause 0173
-- documents as "An approver row with no scopes is a person who looks authorised and is not" passed
-- every empty array since it was written. `cardinality` returns 0 and the comparison is a real FALSE.
--
-- Not exploitable today, which is why it is a fix and not an incident: `efsCardControlAccess.ts`
-- refuses an empty scope list with `not_approver` before it reaches any capability, so the app has
-- always failed closed. What was wrong is the claim — the database was not enforcing the rule its
-- own comment said it did, and the next reader would have trusted it.
--
-- If this migration fails here, an empty-scoped row already exists. That row grants nothing and
-- never has; delete it or give it the scopes it was meant to have, then re-run.
alter table efs_card_control_approvers
  add constraint efs_card_control_approver_scopes_valid
  check (
    scopes <@ array['lock', 'unlock', 'deactivate', 'override', 'prompts']::text[]
    and cardinality(scopes) >= 1
  );

-- The grant statement 0190 asked for. Idempotent, so a re-run cannot produce a duplicate element;
-- scoped to holders of `lock`, so it never widens anybody beyond what they could already do.
update efs_card_control_approvers
   set scopes = scopes || array['deactivate']
 where 'lock' = any (scopes)
   and not ('deactivate' = any (scopes));
