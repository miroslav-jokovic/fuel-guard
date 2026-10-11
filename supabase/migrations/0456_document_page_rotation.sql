-- 0456 — a page's verdict says how far to turn it, beside what it is (DOCUMENT-READER-PLAN.md §7A P2,
-- Q-DR19 (a)).
--
-- THE GAP THIS CLOSES. One of the ten office samples is a landscape form scanned into a portrait page with
-- no `/Rotate` (Q-DR19, 2026-10-10): the normaliser renders it as stored — `/Rotate` and EXIF are the only
-- orientation a file declares — so the reader is sent text running top to bottom. Photos from a cab are
-- worse: a phone held sideways over a clipboard records whatever EXIF it likes. Only something that LOOKS
-- at the page can say which way is up, and P2's classifier already looks at every page once, so it
-- answers both questions in the one call (Q-DR19's recommendation (a)).
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────────
--   rotation   PAGE_ROTATIONS — 0 | 90 | 180 | 270: the degrees CLOCKWISE the stored page must be turned
--              for its text to read upright. On the verdict, not on the page: the page row is the
--              file's rendering and append-only (0448), and a turn is a judgement about it — the
--              classifier's, which a dispatcher may override exactly as they override the class, as a
--              newer row of the same ledger (0449). The reader turns a DERIVED copy; the original is
--              never touched (D-DR15: geometry only, from the original, in one resample).
--   null       not answered: every verdict written before 0456, and a person's verdict that set the class
--              alone. The reader then turns nothing — the behaviour before this migration. A person's
--              class-only override would otherwise erase the classifier's turn, so the route that writes
--              one (Step 3.4) carries the current rotation forward; the fold stays "newest row wins".
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────────
--   • Any angle (skew, 7°): deskew is P3's (rectify, one warp with the crop); a classifier's degree
--     guess would be a second, coarser warp. Four right angles are lossless turns.
--   • NOT NULL default 0: a verdict that did not look at orientation would claim it did.
--   • A separate `document_page_rotations` ledger: two folds a reviewer edits in one gesture, and two
--     "current" answers that can come from different moments for the same page.
--
-- A nullable column with no default: old code inserts verdicts without it and keeps working; its first
-- writer and reader (the P2 classifier) ship in the next merge (`lint:migration-ordering`).
-- `document_page_current_class` returns `setof document_page_classes`, so it carries the column with no
-- change. The table stays append-only and RETENTION_FORBIDDEN; RLS unchanged.

alter table public.document_page_classes add column if not exists rotation smallint;

alter table public.document_page_classes drop constraint if exists document_page_classes_rotation_check;
alter table public.document_page_classes add constraint document_page_classes_rotation_check
  check (rotation in (0, 90, 180, 270));

comment on column public.document_page_classes.rotation is
  '0456, Q-DR19 (a): degrees clockwise the stored page must be turned to read upright (PAGE_ROTATIONS); '
  'null = not answered (verdicts before 0456, a person''s class-only verdict) — the reader turns nothing.';
