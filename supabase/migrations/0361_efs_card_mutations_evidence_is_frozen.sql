-- FuelGuard — 0361 the card-mutation ledger's evidence cannot be rewritten or cascaded away.
--
-- THE GAP (EFS security audit, 2026-09-22). `efs_card_mutations` is the only record of who changed a
-- live fuel card, why, and what the card looked like before. It is pinned in RETENTION_FORBIDDEN and
-- carries RLS with no policies, so no CLIENT can touch it — but the API writes it with the service
-- role, which bypasses RLS, and two things were left open to that role:
--
--   1. `efs_card_id ... on delete cascade` (0177). Deleting one `efs_cards` row silently deleted every
--      mutation ever aimed at that card. 0177 justified it as "a mirror row is only ever deleted when
--      the org is" — true of the code the day it was written, and enforced by nothing. 0181 moved card
--      removal to tombstoning (`absent_since`) precisely so the mirror row survives; the cascade is the
--      one path left that would erase the evidence instead of keeping it.
--   2. Every column stayed writable after insert. The settle phase legitimately fills in the OUTCOME
--      (status, after-document, versions, faults, redacted XML, approver), but nothing stopped a later
--      UPDATE from rewriting the REQUEST half: the reason, the requester, the before-document, the edit
--      list, the idempotency key. A ledger whose "what was asked" can be edited after the fact is a
--      log, not evidence.
--
-- THE SHAPE.
--   • The FK becomes NO ACTION rather than RESTRICT. Both refuse a direct `delete from efs_cards`
--     while mutations reference the card. They differ on deleting an ORGANIZATION, which cascades to
--     both tables in one statement: RESTRICT checks immediately and can fire before the cascade has
--     reached the mutations, failing an org deletion depending on the order Postgres walks the
--     cascades; NO ACTION checks at the end of the statement, when both are gone. An org deletion is
--     the one sanctioned way these rows disappear (0177 header), so it has to keep working.
--   • A BEFORE UPDATE trigger freezes the insert-time columns. Three are allowed to move to NULL and
--     only to NULL, because `on delete set null` foreign keys run as UPDATEs and fire this trigger:
--     `requested_by` and `approved_by` (a deleted auth user) and `proof_run_id` (a deleted proof).
--     Refusing those would make deleting a user fail on their card history.
--   • `approved_by` is write-once: null → a user at markSent (0197), or → null via its FK, never one
--     approver replaced by another. Re-attributing an approval is the edit this exists to stop.
--
-- AND ONE LATENT DEFECT IN 0197, found by this migration's own matrix. 0197 refuses any UPDATE that
-- leaves a vendor-contacted row (`sent`, `succeeded`, `drift_detected`, `partial`) with no approver.
-- `approved_by ... on delete set null` is such an UPDATE, so deleting ANY auth user who ever approved
-- a card change failed with `not_ready` — measured in PGlite with 0361 removed, so it is 0197's and
-- has been live since it shipped. The rule's intent is "stamped by the time the write reaches the
-- vendor", which is a fact about the TRANSITION. It now fires only when the status changes; a user
-- deleted afterwards clears the column the way every other set-null reference to auth.users does, and
-- the frozen `requested_by`/`approved_by` rule above still refuses anything but a clear to NULL.
--
-- WHAT WAS REJECTED. A BEFORE DELETE trigger on the ledger itself: it would also refuse the org
-- cascade, and the retention pin plus the absence of any delete path in the API already cover the
-- direct case. Freezing the outcome columns too: the background reconciler (`efsCardReconcile.ts`,
-- `efsCardUnresolved.ts`) settles `sent` rows hours later, which is correct behaviour, not tampering.
--
-- Verified before writing: no migration and no API path deletes `efs_cards` rows; production holds 60
-- mutation rows across 9 cards; the only post-insert writers are ledger.ts (markSent, settle) and the
-- two reconcilers, whose columns are exactly the unfrozen set below.
--
-- Proven in supabase/tests/efs-card-control-triggers.test.mjs.
--
-- Rollback:
--   drop trigger efs_card_mutation_evidence_frozen on efs_card_mutations;
--   drop function efs_card_mutation_evidence_frozen();
--   alter table efs_card_mutations drop constraint efs_card_mutations_efs_card_id_fkey,
--     add constraint efs_card_mutations_efs_card_id_fkey
--     foreign key (efs_card_id) references efs_cards(id) on delete cascade;
--
-- raw-access-waiver: these triggers are the efs collector's own integrity rules on its own ledger
-- table, the same position as 0197's approver trigger — they read nothing out of the table for anyone.

alter table efs_card_mutations drop constraint if exists efs_card_mutations_efs_card_id_fkey;
alter table efs_card_mutations
  add constraint efs_card_mutations_efs_card_id_fkey
  foreign key (efs_card_id) references efs_cards(id) on delete no action;

create or replace function efs_card_mutation_evidence_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.id               is distinct from old.id
  or new.org_id           is distinct from old.org_id
  or new.efs_card_id      is distinct from old.efs_card_id
  or new.intent           is distinct from old.intent
  or new.reason           is distinct from old.reason
  or new.step_up          is distinct from old.step_up
  or new.expected_version is distinct from old.expected_version
  or new.before_version   is distinct from old.before_version
  or new.before_document  is distinct from old.before_document
  or new.edits            is distinct from old.edits
  or new.idempotency_key  is distinct from old.idempotency_key
  or new.request_fingerprint is distinct from old.request_fingerprint
  or new.environment      is distinct from old.environment
  or new.endpoint_host    is distinct from old.endpoint_host
  or new.card_last4       is distinct from old.card_last4
  or new.capability_key   is distinct from old.capability_key
  or new.request_body     is distinct from old.request_body
  or new.created_at       is distinct from old.created_at
  then
    raise exception
      'evidence_frozen: what a card mutation asked for is fixed at insert — record a correction as a new row (mutation %)', old.id
      using errcode = 'FG012';
  end if;

  -- Set-null foreign keys fire this trigger; to NULL is the only move they may make.
  if (new.requested_by is distinct from old.requested_by and new.requested_by is not null)
  or (new.proof_run_id is distinct from old.proof_run_id and new.proof_run_id is not null)
  then
    raise exception
      'evidence_frozen: who requested a card mutation, and under which proof, is fixed at insert (mutation %)', old.id
      using errcode = 'FG012';
  end if;

  -- Write-once: stamped at markSent, cleared only by its FK. Never re-attributed.
  if old.approved_by is not null and new.approved_by is not null and new.approved_by <> old.approved_by then
    raise exception
      'evidence_frozen: a recorded approval cannot be re-attributed to someone else (mutation %)', old.id
      using errcode = 'FG012';
  end if;

  return new;
end;
$$;

comment on function efs_card_mutation_evidence_frozen() is
  '0361 (EFS security audit 2026-09-22): the request half of an efs_card_mutations row is fixed at '
  'insert. Outcome columns stay writable for the settle phase and the reconcilers; requested_by, '
  'approved_by and proof_run_id may only move to NULL (their on-delete-set-null FKs), and approved_by '
  'is write-once.';

-- 0197's rule, narrowed to the transition (see the header). Same function name, same trigger, same
-- errcode and message, so nothing that matches on them changes.
create or replace function efs_card_mutation_requires_approver()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('sent', 'succeeded', 'drift_detected', 'partial')
     and new.status is distinct from old.status
     and new.approved_by is null then
    raise exception
      'not_ready: a card mutation that reached the vendor must record who approved it (status %)', new.status
      using errcode = 'FG011';
  end if;
  return new;
end;
$$;

drop trigger if exists efs_card_mutation_evidence_frozen on efs_card_mutations;

create trigger efs_card_mutation_evidence_frozen
  before update on efs_card_mutations
  for each row execute function efs_card_mutation_evidence_frozen();
