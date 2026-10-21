-- 0509 — a review row says whether it is a person's word on the PAGE or on the LOAD (READER-CORRECTNESS-PLAN
-- Q-RC5, owner 2026-10-21: the paper audit takes what a person confirmed).
--
-- Until now every review came from one place: the Placard calculator's Calculate press (consumer
-- `hazmat_calculator`, D-DR24) — each field it sent, confirmed or corrected against pass A. Q-RC5 has the
-- paper audit take what a person said the page prints, so a field it could not judge stops asking. But a
-- Calculate correction is not always that: a weight typed in, or a product picked from the list, may be the
-- LOAD's — the dispatcher placarding for what is aboard — while the paper prints something else. Judging the
-- paper by it would pass a misprinted shipping name or an RQ the paper owes: the audit's whole job.
--
-- So the acts that ARE about the page — "Yes, the page says …", a picked reading, a choice under a finding — are
-- recorded as they are made under their own consumer, `paper_check`, and only those reach the audit. Both are
-- explicit labels for graduation (D-DR5), which reports per consumer.
--
-- DEPLOY ORDER. A CHECK widening: no code writes the word yet; its first writer ships in the next merge, so on
-- staging and in the release the migration is in place before anything sends it. `REVIEW_CONSUMERS` mirrors the
-- list; `document-reader-tables.test.mjs` holds the two equal.

alter table public.document_read_reviews drop constraint if exists document_read_reviews_consumer_check;
alter table public.document_read_reviews add constraint document_read_reviews_consumer_check
  check (consumer in ('hazmat_calculator', 'paper_check'));
