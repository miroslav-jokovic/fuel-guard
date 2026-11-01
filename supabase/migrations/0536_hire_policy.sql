-- 0536 — whether this carrier's hire waits for the signed handbook is the carrier's switch
-- (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P12, §8.2 "Settings → Recruiting", Q-WF6). The reader is the
-- second half of P12: Settings → Recruiting's "Before we hire", `hireApplicant.ts` and `HireDrawer`.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- §9 P4 took the handbook out of `HIRE_REFUSES_WITHOUT` on Q-WF6 as assumed: nothing that is not one
-- of the six federal checks blocks the hire. D-HB5 (2026-09-25) had put it IN on the owner's word for
-- this carrier. Both are defensible for SOME carrier, which is the audit's point (§8.2): which
-- non-federal steps block the hire is a carrier's policy, not a ruling the product makes for all of
-- them. The six federal checks are not a policy — they stay in code, locked, with their regulation.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- `recruiting_settings.handbook_blocks_hire boolean not null default false`.
--
-- ⚠ A COLUMN DEFAULT, where 0379's three columns refused one. 0379's reason was that each of its
-- numbers already had a home in a shared constant a default would drift from. Here the default IS
-- the product's answer (Q-WF6: off), and `not null` over rows that already exist needs a value: an
-- org that saved its link lifetime last month has a row, and that row must read "off", not fail. The
-- reader's no-row fallback is the same `false` and lives in `recruitingSettingsContract.ts`.
-- Old code's insert (the three 0379 answers) keeps working through the deploy window because of it.
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────
-- · §9 P12 also names `orientation_blocks_hire` and `videos_block_hire`. NOT ADDED. Both steps have
--   `evidence: null` in `hiringSteps.ts` — no table records an orientation day or a watched video
--   (§4.8, HW8 builds them) — so the checklist can never read either as done, and a carrier who
--   switched one on could never hire anybody again. A switch whose "on" position is a dead end is
--   not a policy. They are one-line migrations beside HW8's evidence tables, recorded in §7.
-- · A generic `blocks_hire text[]` of step keys: it would let a carrier make PSP or the
--   employment investigation block the hire, which §391.23(c)(1)'s 30 days and the voluntary PSP
--   make wrong, and a CHECK could not keep the list to the steps that may be switched. One named
--   column per switch, each argued.
--
-- RLS: unchanged — 0379's deny-all; the api is the one door.
-- ⚠ DEPLOY WINDOW: an added column with a default. Old code never names it.

alter table public.recruiting_settings
  add column if not exists handbook_blocks_hire boolean not null default false;

comment on column public.recruiting_settings.handbook_blocks_hire is
  '§9 P12 (0536): when true, the hire refuses until the driver handbook is signed (D-HB5 as a carrier''s choice). Default false (Q-WF6). The six federal checks are not settings.';
