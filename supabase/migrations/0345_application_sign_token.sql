-- 0345 — a second token, so the approval email can carry a link (HIRING-MODULE-PLAN A5a).
--
-- ── COLUMN ONLY. THE READER IS A5b, AND THAT IS THE RULE, NOT AN OVERSIGHT ─────────────────────
-- Railway serves a merge about 2m44s before `migrate.yml` has applied its schema, so a column and
-- its first reader ship in two merges (`lint:migration-ordering`, `docs/MIGRATION-DISCIPLINE.md`).
-- Nothing in this repository reads `sign_token_hash` until A5b lands. A column nothing reads looks
-- like dead schema for exactly one merge; a reader deployed against a column that does not exist yet
-- is an outage, and this repo has had one.
--
-- ── WHAT IT IS FOR ────────────────────────────────────────────────────────────────────────────
-- F4 made the application a two-visit document (0336): the driver hands it over, the office reads
-- and corrects it, the driver comes back and CERTIFIES what now stands. `applicationApprovalNotice`
-- tells them it is ready — and today it can only tell them to go and find the earlier email,
-- because 0220 stores a SHA-256 of the invitation token and the plaintext existed once, at mint.
--
-- ── ⚠ IT DOES NOT ROTATE, AND THE DIFFERENCE IS THE WHOLE DESIGN (D-AX14, Q-AX4) ───────────────
-- The abandonment sweep's answer to "there is no link to send" is to mint a new token and rotate
-- `token_hash` to match (0232). That answer was REJECTED for the approval email, in writing, in
-- three places — `applicationApprovalNotice.ts`'s header, `renderApplicationApprovedEmail`, and the
-- waiting screen's promise that "this link is where you will sign, and it still works". The reason
-- holds: a nudge that misfires costs a driver an unfinished form, whereas an approval that rotated
-- the token and then failed to send would cost them a COMPLETED application they can no longer
-- reach.
--
-- A SECOND hash takes the objection apart rather than overruling it. `token_hash` is untouched and
-- the old link keeps working, so the promise stays true and nobody is locked out; `sign_token_hash`
-- is minted fresh at approval and is what the new email carries. Both doors open the same
-- invitation. A5b amends those three headers to say so, with a decision id — a repository holding
-- comments that argue against its own behaviour is worse than one holding no comments at all.
--
-- ── WHY NULLABLE, AND WHY A PARTIAL UNIQUE INDEX RATHER THAN A CONSTRAINT ──────────────────────
-- Nullable because it is minted at approval and most invitations have never been approved: every
-- row alive today has none, and an unapproved application having no sign token is the normal state
-- rather than a backlog.
--
-- ⚠ Unique because `resolveInvitation` will look an invitation up BY this hash. Two rows sharing a
-- value would make that lookup's `.maybeSingle()` answer neither of them — a driver holding a
-- perfectly good link told their link is invalid, with no trace of why. Postgres would let a plain
-- UNIQUE constraint hold any number of NULLs, so the two differ in nothing but what they say; the
-- partial index says out loud that it governs the rows that HAVE a sign token, and indexes only
-- those, which is also every row the lookup will ever match.

alter table public.application_invitations
  add column if not exists sign_token_hash text;

create unique index if not exists application_invitations_sign_token_hash_key
  on public.application_invitations (sign_token_hash)
  where sign_token_hash is not null;

comment on column public.application_invitations.sign_token_hash is
  'SHA-256 of a SECOND token, minted when the office approves the application and sent in the approval email (A5a/A5b, amending D-AX14). ⚠ It does not replace `token_hash`: the applicant''s original link keeps working, because the waiting screen promised it would and an approved applicant locked out of a completed application has no way back. Null until approval, and on every row approved before this existed.';
