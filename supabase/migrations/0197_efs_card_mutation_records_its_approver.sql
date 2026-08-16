-- FuelGuard — 0197 a card mutation that reached the vendor must record who approved it
-- (docs/28-EFS-EXECUTION-PLAN.md Step 5.3)
--
-- THE GAP. `efs_card_mutations.approved_by` has existed since migration 0177 and nothing has ever
-- written it. Its header said so plainly — "Reserved for maker-checker (Phase C). Nothing writes it
-- yet" — which means every card write in the product's history can answer "who asked" and cannot
-- answer "who said yes". Step 5.3 closes that.
--
-- WHY A TRIGGER AND NOT JUST THE SERVICE. Migration 0142 already made this argument for loads, in
-- almost these words: "an invariant enforced only by the one caller that remembers is not an
-- invariant". `ledger.ts#markSent` now stamps the approver, but `efs_card_mutations` is written by a
-- service-role client that bypasses RLS, so the database is the only place the rule cannot be
-- forgotten by a future writer.
--
-- THE RULE, AND WHY IT IS SCOPED THE WAY IT IS. A row may be created `pending` with no approver —
-- that is the maker's half, and Phase C's approval route depends on that state existing. What it may
-- NOT do is leave `pending` without one. By the time a mutation is `sent` the write has gone to the
-- vendor, and an unattributable write to a customer's fuel card is exactly the thing being
-- prevented. Terminal states are covered by the same clause because they are all reached through
-- `sent`.
--
-- WHAT THIS DOES NOT DO. It does not require the approver to be a DIFFERENT person from the
-- requester. Plan and apply are one request today, so demanding a second principal would refuse
-- every card write in the product. 0142 handles the same question with an org-level
-- `require_separate_approver` flag, and the equivalent for card control belongs with Phase C's
-- approval route, where a second person can actually exist. The column being truthful is the
-- precondition for that; this migration establishes it.
--
-- Existing rows are left alone. They were written before anything stamped the column, and back-
-- filling them with a guess would manufacture approvals that never happened. The trigger fires on
-- update only, so history stays as it is and stays honest.
--
-- Rollback:
--   drop trigger efs_card_mutation_requires_approver on efs_card_mutations;
--   drop function efs_card_mutation_requires_approver();

create or replace function efs_card_mutation_requires_approver()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from 'pending' and new.approved_by is null then
    raise exception
      'not_ready: a card mutation that leaves pending must record who approved it (status %)', new.status
      using errcode = 'FG011';
  end if;
  return new;
end;
$$;

comment on function efs_card_mutation_requires_approver() is
  'Step 5.3: efs_card_mutations.approved_by must be set by the time a mutation leaves pending. '
  'A row may be created pending with no approver — that is the maker half, and Phase C''s approval '
  'route needs that state — but once status is sent the write has reached the vendor, and an '
  'unattributable write to a customer''s fuel card is what this prevents.';

drop trigger if exists efs_card_mutation_requires_approver on efs_card_mutations;

create trigger efs_card_mutation_requires_approver
  before update on efs_card_mutations
  for each row execute function efs_card_mutation_requires_approver();
