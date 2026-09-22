-- 0358 — drop the IFTA unique key that assumed one device per truck per month.
--
-- 0357 added `uq_samsara_ifta_miles_device` (…, samsara_vehicle_id, …) beside it, and this merge's
-- writer (`samsaraIftaSync.ts`) upserts on the wide key. Served before this file applies, the writer
-- is fine: the wide index exists, and the narrow one can only refuse a second device on one truck,
-- which no row holds until 0359 merges unit 732. After it applies, a truck may carry one row per
-- device per month per jurisdiction — which is what a mid-month gateway swap produces. Every reader
-- sums (see 0357), so no total moves.
alter table public.samsara_ifta_jurisdiction_miles drop constraint if exists samsara_ifta_miles_unique;
