-- 0147 — retire the three compliance tables nothing has ever read (Safety/DQF plan, DQ0).
--
-- Separate from 0146 on purpose: 0146 is additive and 0147 is destructive, and a reader six months
-- from now should be able to see which is which without reading the diff.
--
-- WHAT WAS VERIFIED BEFORE WRITING THIS. A grep for each table name across apps/, packages/,
-- scripts/ and supabase/tests returned, in total: three entries in `schemaCheck.ts`'s probe list and
-- four prose comments. No route, no service, no query, no test, no UI. The nightly `compliance_scan`
-- job that 0101 describes as the sole writer of `compliance_items` was never written, so that table
-- is not merely unread — it has never held a row this product produced.
--
--   compliance_items      (0101) a derived alert index whose producer does not exist. Derived data:
--                         nothing is lost by dropping it, and the Safety page computes status from
--                         `certifications` and `documents`, which are the real sources.
--   master_documents      (0101) a pointer into a Storage bucket that was never created. It is the
--                         decoy `documents` (0146) replaces; leaving both standing is how the next
--                         person files a medical card into the one nothing reads.
--   driver_endorsements   (0098) 0098:86-87 claims the hazmat qualification gate reads it. The gate
--                         reads `certifications` with kind='endorsement' and a qualifier letter,
--                         which is the model that survived. The claim in 0098 was already false.
--
-- If any of these ever comes back it comes back with a consumer written in the same change. That is
-- the rule this migration exists to restate.

drop table if exists public.compliance_items cascade;
drop table if exists public.master_documents cascade;
drop table if exists public.driver_endorsements cascade;
