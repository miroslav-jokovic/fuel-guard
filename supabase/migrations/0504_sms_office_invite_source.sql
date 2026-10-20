-- 0504 — a consent SOURCE for an invitation the office sends by text, and an outbox REASON for the
-- text it sends (APPLICATION-FLOW-V2-PLAN Q-AW55, ruled (a) by the owner 2026-10-20; SMS-OPT-IN-PLAN
-- D-SMS11).
--
-- ── WHY A NEW SOURCE AND NOT `office` ───────────────────────────────────────────────────────────
-- Every text this product has sent so far followed a box the APPLICANT ticked on their own link
-- (D-SMS1–D-SMS3): the consent row is their act, in their words, on the number they typed. An
-- invitation by text is the other way round — the first message IS the first contact, and nobody has
-- ticked anything. What makes it lawful to send is that the person asked a recruiter to text them the
-- link (47 CFR §64.1200(a)(2): prior express consent, which may be given orally, is what an
-- informational text needs; the written form is for telemarketing). What the carrier must be able to
-- SHOW is that they asked, and 0233's table is where "may we text this number" is answered. So the
-- recruiter's attestation — "this person asked us to text them the link" — is written as a consent row
-- on that number, under its own source, so that:
--   · the opt-out machinery covers the number from the very first message: an inbound STOP finds the
--     row (`revoke_sms_consent`), the suppression lands, and `sendApplicationSms` refuses thereafter;
--   · the application link (D-SMS7), the reminder (A10) and every later text ride the same row, so the
--     applicant is not asked a second time for something they already asked for;
--   · and the row is READABLE as what it is. `office` was reserved by 0233 for a consent the office
--     records on the applicant's behalf after a call; an attestation is a different instrument, with a
--     different wording and a different signer (the recruiter, named by the audit row written at the
--     same instant: `compliance.applicant_invited_by_text`). One value for both would be a copy with
--     the meaning dropped, which is what the no-workarounds rule refuses.
-- The wording the recruiter affirms is a versioned platform constant (`SMS_OFFICE_INVITE_ATTESTATION`),
-- stored on the row like every other instrument, and counsel memo Q12 carries the question of whether a
-- recorded attestation is enough documentation of oral consent (COUNSEL-REVIEW-PACKAGE).
--
-- ── WHY AN OUTBOX REASON ────────────────────────────────────────────────────────────────────────
-- The invite text goes through `sms_outbox` (Q-AW29): a recruiter at their desk at 08:00 Chicago is
-- inside their day and outside the strict all-US window, and a text DROPPED there would be the
-- recruiter's own words ("we will text you the link") made false. Queued, it goes at the window and its
-- link is minted then on the invitation's text token (0378), like the reminder's. The reason column
-- names what the text was for; filing it under `other` (the approval notice's) would hide the one
-- message kind whose consent story is different from every other row's.
--
-- ── WIDENED ONE MERGE BEFORE ITS WRITER ─────────────────────────────────────────────────────────
-- 0397, 0465, 0483 and 0499's discipline: in a release the new code may meet a database that has not
-- migrated, and a value the CHECK refuses fails the insert — the consent row would not land and the
-- text would go on nothing. The writer (`applicationInviteText.ts`), the drawer's number field and the
-- attestation checkbox follow in the next merge. Mirrors `SMS_CONSENT_SOURCES` (smsConsentContract.ts)
-- and `SMS_TEMPLATES` (smsOutbox.ts); the lists move together or not at all.

alter table public.sms_consents drop constraint if exists sms_consents_source_check;
alter table public.sms_consents add constraint sms_consents_source_check
  check (source in ('application', 'lead_form', 'office', 'office_invite'));

comment on column public.sms_consents.source is
  'Where the consent was taken. application = the applicant''s own box on their link (D-SMS1); lead_form = R1''s lead form; office = recorded by the office on the applicant''s behalf; office_invite = the recruiter''s attestation that the applicant asked to be texted the application link (Q-AW55, 0504) — the recruiter is named by the audit row compliance.applicant_invited_by_text written at the same instant.';

alter table public.sms_outbox drop constraint if exists sms_outbox_reason_check;
alter table public.sms_outbox add constraint sms_outbox_reason_check
  check (reason in ('nudge', 'application_sent', 'signing_link', 'drug_test_site', 'consent_confirm', 'invite', 'other'));
