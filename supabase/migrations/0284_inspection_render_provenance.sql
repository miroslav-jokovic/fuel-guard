-- Record WHICH DRAWING produced a filed §396.17 report (D-AVI7, D-AVI14).
--
-- ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────
-- A final report serves its STORED bytes and is never re-rendered — `documents.sha256` is a claim
-- about those exact bytes, and §390.32(c) wants a filed document reproducible. That rule is right
-- and stays. What was missing is the other half of it: nothing recorded which renderer drew them.
--
-- On 2026-08-31 the renderer's drawing changed materially (section headings added, header block
-- moved to bold at the office's own sizes, ink changed from red to black) and again on 2026-09-01
-- (the sixteen coloured bands, the OK column heading and the legend marks the template export had
-- lost, plus three tick boxes that were printing on top of their labels). One report was filed
-- between the two — 2026-09-01 04:01 UTC, half an hour before the first of them landed.
--
-- The office reported the result as "the preview has the section names and the print does not", and
-- they were looking at exactly that: a preview drawn by today's renderer beside a filing drawn by
-- an older one, with nothing on either page or in any row to say they were different documents.
--
-- So the row records it. `catalogue_version` was already pinned per report for the same reason —
-- this extends that to the other two things a rendered page depends on.
--
-- ── NULL MEANS "FILED BEFORE THIS COLUMN EXISTED" ─────────────────────────────────────────────
-- Deliberately not backfilled with a guess. A report filed before this migration was drawn by some
-- renderer we did not write down, and inventing "1.0.0" for it would be asserting a fact nobody
-- measured. NULL is the honest answer and reads as "unknown, and older than 2.0.0" — which is all
-- the UI needs in order to say the filing may not match the preview.
--
-- Evidence tables stay append-only: this adds columns to the report row, and touches no filed
-- document, certification or audit entry (RETENTION_FORBIDDEN is unaffected).

alter table public.vehicle_inspections
  add column if not exists renderer_version  text,
  add column if not exists template_revision text;

comment on column public.vehicle_inspections.renderer_version is
  'Version of the PDF renderer that drew the filed bytes. NULL = filed before 0284, drawing unknown.';
comment on column public.vehicle_inspections.template_revision is
  'The Keller form revision the filed bytes were stamped onto, e.g. jjkeller-14834-rev-1-22.';
