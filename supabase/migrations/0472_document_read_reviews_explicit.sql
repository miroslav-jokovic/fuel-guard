-- 0472 — whether a dispatcher's review of a read field was an explicit act or a Calculate press that
-- left the prefilled value untouched (DOCUMENT-READER-PLAN §6, D-DR24, owner ruling 2026-10-14).
--
-- ── WHY THE TWO ARE KEPT APART ─────────────────────────────────────────────────────────────────────
-- Plan §6 records every untouched prefilled field as `confirmed` when the dispatcher presses Calculate.
-- That is a true record of what was sent to the calculator, but not evidence that anybody compared the
-- field with the paper: a click-through and a careful check write the same row. D-DR5 graduates a field
-- from Check to Read on its count of error-free confirmations (300 / 600, ≈ 1 % / 0.5 % false-accept
-- bounds by the rule of three), so counting click-throughs would graduate a field on rubber stamps — the
-- external audit of 2026-10-14 named exactly this. The owner ruled (a): keep the implicit confirmations,
-- mark them, and let graduation count only explicit ones. A field the readers dispute can never be
-- implicit: Calculate stays disabled until the dispatcher picks, corrects or marks it unreadable.
--
-- `explicit` defaults to false so a writer that does not say counts for nothing. The table has no rows
-- (nothing has posted a review yet — measured on production 2026-10-14), so there is no backfill.
--
-- A column and its first reader ship in two merges (`lint:migration-ordering`): the API starts writing
-- `explicit` in the merge after this one.

alter table public.document_read_reviews
  add column if not exists explicit boolean not null default false;

comment on column public.document_read_reviews.explicit is
  'true when the dispatcher acted on this field (picked, typed, marked unreadable, or ticked it); false '
  'for a prefilled value left untouched at Calculate. Graduation (D-DR5) counts only explicit rows (0472, D-DR24).';
