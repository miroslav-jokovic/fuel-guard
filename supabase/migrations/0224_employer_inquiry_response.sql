-- 0224 — what the previous employer actually said (EMPLOYER-INQUIRY-PLAN E4).
--
-- 0223 recorded the asking. This records the answer: §391.23(c)(2)'s third element, "the information
-- received about the driver from the previous employer".
--
-- ── WHY A JSONB COLUMN AND NOT A TABLE OF ACCIDENTS ────────────────────────────────────────────
-- The answer belongs to the attempt that produced it — one reply, one row, no second key to join on
-- and no way for a reply to drift away from the letter it answers. The accidents inside it are the
-- §390.15(b)(1) elements in the SAME shape the applicant's own §391.21(b)(7) declaration uses
-- (`applicationAccidentSchema`), which is what makes the two comparable later; splitting them into a
-- table would create a second accident model that the application's own list does not share.
--
-- Validation lives in `employerResponseSchema`, not in a CHECK: the shape is a document the API
-- composes and stores whole, exactly as `driver_applications.payload` is.
--
-- ── THE APPEND-ONLY TRIGGER ALREADY COVERS THIS CORRECTLY ──────────────────────────────────────
-- 0223's guard freezes what was SENT — the wording, the address, the date, the manner. It does not
-- freeze the outcome, and it must not freeze this: a reply that arrives after a documented
-- non-response is a real sequence of events, and the row has to be able to say so. What can never
-- change is the question we asked.
--
-- The whole row is already pinned in RETENTION_FORBIDDEN and restricted by 0223's §391.23(k)(2)
-- policy; the answer inherits both, which is the point of putting it here.

alter table public.employer_inquiries
  add column if not exists response jsonb;

comment on column public.employer_inquiries.response is
  'The information received (§391.23(c)(2)), as employerResponseSchema: employment confirmation, the dates the EMPLOYER gives, and §390.15(b)(1) accident elements in the same shape the applicant''s own §391.21(b)(7) declaration uses. NULL until they answer.';
