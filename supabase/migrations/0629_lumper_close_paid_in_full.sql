-- 0629 — Lumper fees: a case can be closed because the broker paid the invoice in full
-- (docs/plans/dispatch-loads/LUMPER-REVISED-RC-PLAN.md D-LRC15).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The first production read (2026-11-17) opened 78 cases "Billed, no revised RC" going back to August.
-- No revised RC had been filed in 360 yet, because 360 did not exist for it; most of those invoices
-- were paid by the broker long ago, and for them the revised RC no longer decides anything. 0600's four
-- reasons all mean "will not be billed", so a person clearing that backlog had no true reason to pick.
--
-- ── WHY A PERSON'S STATEMENT, NOT A READ ─────────────────────────────────────────────────────────
-- Whether the broker paid is in McLeod's receivables tables, which the connector's login does not read;
-- reading them is a new request to the carrier's IT. The reason is a person's word, kept with their
-- name and time on the case and on the Audit page, and the API takes it only on an invoiced order.
--
-- ⚠ DEPLOY WINDOW: the CHECK widens; nothing existing changes. Code that offers the new reason may
-- serve for a few minutes on staging before this applies, and a close with it then fails visibly and
-- can be repeated; a release applies migrations first. The page is shown to admins only during the
-- silent weeks (D-LRC9).
--
-- Rollback: restore 0600's four-value CHECK (only after no row holds 'broker_paid_in_full').

alter table public.lumper_cases drop constraint if exists lumper_cases_close_reason_check;
alter table public.lumper_cases add constraint lumper_cases_close_reason_check
  check (close_reason in ('broker_paid_in_full', 'broker_paid_directly', 'broker_refused', 'included_in_rate', 'not_a_lumper'));
