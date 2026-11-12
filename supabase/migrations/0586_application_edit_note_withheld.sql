-- 0586 — an office correction can carry the office's reason, and can be recorded without its values
-- (APPLICATION-FIX-PLAN.md F3; owner's Q-AM13 ruling, 2026-11-10).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- F3's "Applicant facts" card opens every answer the driver gave to the office's correction, before
-- signing (D-AM7, Q-AM2 → b). Two kinds of answer cannot be recorded by 0337's row as it stands:
--
--   1. **The driver's own drug-and-alcohol statements** — §40.25(j) (a positive test or refusal in the
--      last two years) and the three §382.301(b) testing-program answers. The regulation has the
--      employer ASK these, so the answer is the applicant's statement, not a fact the office knows.
--      The owner ruled they are editable anyway ("drivers make mistakes and we need control over any
--      mistake"), on two conditions: the office says WHY, and the driver accepts the change on the
--      signing screen (3.1). The why has nowhere to go: `audit_logs.meta` carries names, never free
--      text (`apps/api/CLAUDE.md`), and a separate table would be a second record of one act.
--   2. **The answers nobody deciding the hire may read** — the Med-Stop donor gender and the EEO
--      answers. The owner ruled them REPLACE-ONLY: the office may overwrite them, never see them. A
--      0337 row stores `before` and `after`, and the office's own drawer lists every row's values
--      ("What you changed"), so writing one would put the value on the screen the rule keeps it off.
--      Writing NO row would make the change invisible to the driver, which is what 0337 exists to
--      prevent.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
--   note      the office's reason, in its words. Null for an ordinary correction; the service requires
--             it on the four statements. 1–1000 characters once trimmed — an empty reason is no reason.
--   withheld  true when the row deliberately records THAT an answer changed and not what to or from.
--             Both values are then null, enforced here rather than trusted to the writer: a row that
--             says "withheld" and still carries the value is the leak this column exists to prevent.
--             The driver's signing screen says "the office replaced this answer"; they gave it, and
--             they can see their own answer on the document itself.
--
-- ── WHY NOT A `kind` ENUM ──────────────────────────────────────────────────────────────────────
-- Considered: `kind in ('set','statement','withheld')`. A statement edit IS a set with a reason, and the
-- reason's presence is the whole difference — a third state would be a second way to say "has a note",
-- and the two would drift. Which facts are statements and which are replace-only is the fact
-- catalogue's to say (`packages/shared/src/applicantFacts.ts`), never this table's.
--
-- cross-module-waiver: none — recruiting's table, written and read by recruiting.
--
-- ⚠ DEPLOY WINDOW: two columns, both safe for old code — `note` is nullable, `withheld` defaults to
-- false, and the old writer names neither. Their first writer AND reader ship in the NEXT merge
-- (`lint:migration-ordering`), so the API never names a column the database it talks to lacks.

alter table public.application_edits
  add column if not exists note text,
  add column if not exists withheld boolean not null default false;

alter table public.application_edits
  drop constraint if exists application_edits_note_check;
alter table public.application_edits
  add constraint application_edits_note_check
  check (note is null or char_length(btrim(note)) between 1 and 1000);

alter table public.application_edits
  drop constraint if exists application_edits_withheld_check;
alter table public.application_edits
  add constraint application_edits_withheld_check
  check (not withheld or (before is null and after is null));

comment on column public.application_edits.note is
  'The office''s reason for the correction (0586). Required by the service on the driver''s own drug-and-alcohol statements (§40.25(j), §382.301(b); owner Q-AM13); null on an ordinary correction.';

comment on column public.application_edits.withheld is
  'True when the row records only THAT an answer was replaced (0586): donor gender and EEO are replace-only and never shown to the office (Q-AM13), so before and after are null by CHECK.';
