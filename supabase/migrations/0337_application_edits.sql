-- 0337 — what the office changed on an applicant's answers, and who changed it (F4, D-AX13).
--
-- ── WHY AN EDIT IS A ROW AND NOT AN OVERWRITE ──────────────────────────────────────────────────
-- §391.21(b)(12) is the APPLICANT's statement that the entries on the application are true and
-- complete. Once the carrier can correct an answer before that statement is made, the document the
-- driver signs is no longer only theirs — and the first question an auditor or a plaintiff's lawyer
-- asks is *what did the carrier change, and did the applicant see it*.
--
-- D-AX12 answers the second half on the screen: the certify step marks every edited answer and shows
-- what it was. This table answers the first half, permanently, and is what that screen reads.
--
-- ⚠ The corrected value lives in `application_drafts.payload`, which is mutable and prunable by
-- design. That is the right home for it — it is not yet a filed application — but it means the
-- payload alone cannot say what an answer USED to be. Without this table an edit is invisible the
-- moment it is made.
--
-- ── WHY THE PATH IS JSONB AND NOT A STRING ─────────────────────────────────────────────────────
-- It is the contract path exactly as the validator produces it — `["employers", 0, "city"]` — mixed
-- strings and integers, which is what `fieldLabels.ts` already turns into "Employer 1 · City" for the
-- driver and into a DOM id for the control. Flattening it to `employers.0.city` would mean a second
-- parser on the way back and a second opinion about what a field is called.
--
-- ── WHY IT CARRIES NO `driver_id` ──────────────────────────────────────────────────────────────
-- The invitation has one, and an edit belongs to the SESSION rather than to the person: a rehire's
-- second application is a second invitation, and its edit history must not merge with the first.
-- Reaching the driver is one join; conflating two applications is not recoverable.

create table if not exists public.application_edits (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  -- The contract path, as the validator reports it: ["employers", 0, "city"].
  path          jsonb not null,
  -- Both nullable, and both meaningful: a null `before` is an answer the applicant left blank, and a
  -- null `after` is the office clearing one. "Changed to nothing" is a change.
  before        jsonb,
  after         jsonb,
  -- Who. `on delete set null` for the same reason every other actor column has it: a recruiter who
  -- leaves does not un-make the corrections they made.
  edited_by     uuid references auth.users(id) on delete set null,
  edited_at     timestamptz not null default now()
);

-- The service role bypasses RLS and every read here carries its own org filter; there are no client
-- policies, so this is deny-all from a browser on purpose. An applicant must never read it — the
-- marked-up view they are shown at signing is composed server-side from the draft plus these rows.
alter table public.application_edits enable row level security;

-- The one access pattern: every edit on one application, newest first, for the signing screen and
-- the office's own history panel.
create index if not exists ix_application_edits_invitation
  on public.application_edits (org_id, invitation_id, edited_at desc);

comment on table public.application_edits is
  'Append-only. Every correction the carrier made to an applicant''s answers before they certified (F4, D-AX13). §391.21(b)(12) is the applicant''s own statement that the entries are true, so what the carrier changed — and that the applicant was shown it — has to survive the edit.';

comment on column public.application_edits.path is
  'The contract path as the validator produces it: ["employers", 0, "city"]. Kept as jsonb rather than a dotted string so `fieldLabels.ts` can turn it into a label and a control id without a second parser.';

comment on column public.application_edits.before is
  'The applicant''s own answer. Null means they left it blank — which is a real prior state, not a missing record.';

comment on column public.application_edits.after is
  'What the carrier put there. Null means the carrier cleared it; "changed to nothing" is a change.';
