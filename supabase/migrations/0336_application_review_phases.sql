-- 0336 — the phases a reviewed application passes through (APPLY-EXPERIENCE-PLAN F4/F5, D-AX11–13).
--
-- ── WHAT CHANGES, IN ONE SENTENCE ──────────────────────────────────────────────────────────────
-- The driver stops being the last person to touch the application before it is filed. They fill it
-- in and send it for REVIEW; the office reads it, corrects it and approves it; and only then is the
-- driver asked for the §391.21(b)(12) certification — of the document that will actually be filed.
--
-- ── WHY THE SIGNING SPLITS RATHER THAN MOVES (D-AX11, owner 2026-09-11) ────────────────────────
-- The four instruments in `APPLICATION_RELEASE_ORDER` stay where they are, at the front. They are
-- not ceremony: `SCREENING_PREREQUISITES` gates `psp_record` on `psp` + `fcra_disclosure`,
-- `mvr_order` on `fcra_disclosure`, and `previous_employer_inquiry` on `previous_employer`. Those
-- signatures are exactly what let the office run the checks it is reviewing WITH. Moving them behind
-- the review would mean reviewing blind, which is the opposite of what a review is for.
--
-- So the driver signs twice, and the second touch buys something the first cannot: a certification
-- of the corrected document. ⚠ This is a deliberate reversal of **D-APP4**, which put all signing
-- before the form because "a second touch loses people". That reasoning still holds for the
-- authorizations — which is why they have not moved — and does not hold for the certification,
-- because a certification of answers the office has since corrected certifies something else.
--
-- ── WHY `submitted_at` IS NOT REUSED, AND MUST NOT BE ──────────────────────────────────────────
-- ⚠ `submitted_at` already means one thing and it is load-bearing: the application was CERTIFIED and
-- filed, the link is spent, and `GET /:token` answers "your application is in" for ever after
-- (D-APP1, 0225). `submitApplication` refuses a second one on it. Overloading it with "the driver
-- has finished typing" would make the spent-link refusal fire before anybody had signed anything,
-- and a driver who sent their form for review would be told they had already applied.
--
-- `review_requested_at` is therefore its own column. The phases now read, in order:
--
--   consented_at          15 U.S.C. 7001(c), before anything is written        (0227)
--   releases_completed_at the four authorizations — unchanged, still first     (0228)
--   review_requested_at   the driver has finished; the office's turn           (here)
--   approved_at           the office has read it, corrected it, released it back
--   submitted_at          the driver certified the corrected document; it is filed
--   copy_released_at      the office let the driver have their copy            (F5)
--
-- ── AND WHY THIS MIGRATION CARRIES NO TABLE ───────────────────────────────────────────────────
-- `application_edits` — who changed which answer, from what, to what (D-AX13) — is the next
-- migration's, together with the code that writes it. Two reasons, and they pull in opposite
-- directions, which is why they are worth stating:
--   · a COLUMN and its first reader must ship in two merges (`lint:migration-ordering`), because
--     Railway serves a merge before `migrate.yml` has applied its schema — so these columns land
--     here, alone, and are read next time;
--   · a TABLE with no writer fails `lint:table-producers`, which is right: schema nothing writes is
--     a promise nobody is keeping. So the table cannot come here, where there is no code.

alter table public.application_invitations
  add column if not exists review_requested_at timestamptz,
  add column if not exists approved_at         timestamptz,
  -- Nullable and `on delete set null`, like every other actor reference in this schema: a recruiter
  -- who leaves the company does not un-approve the applications they approved.
  add column if not exists approved_by         uuid references auth.users(id) on delete set null,
  add column if not exists copy_released_at    timestamptz,
  add column if not exists copy_released_by    uuid references auth.users(id) on delete set null;

comment on column public.application_invitations.review_requested_at is
  'The applicant finished filling the form and sent it to the carrier to read (F4). NOT a certified application — `submitted_at` is that, and conflating the two would tell a driver who asked for a review that they had already applied.';

comment on column public.application_invitations.approved_at is
  'The carrier read the application, made any corrections, and released it back to the applicant to certify (F4). Until this is set the certify step refuses: the driver must not sign a document still being edited.';

comment on column public.application_invitations.approved_by is
  'Who approved it. Null for rows approved before this column existed, and for an approver whose account has since been deleted.';

comment on column public.application_invitations.copy_released_at is
  'The carrier released the filed copy to the applicant (F5, D-AX9). ⚠ Deliberately NOT implied by `submitted_at`: the owner''s rule is that sending the driver their copy is a decision somebody makes, never something that happens on its own.';

comment on column public.application_invitations.copy_released_by is
  'Who released the copy. Same nullability rule as `approved_by`.';
