-- 0240: drivers.status gets the CHECK it never had (roster plan R9)
--
-- `drivers.status` is plain `text` with no constraint. The vocabulary has only ever lived in
-- `packages/shared/src/constants.ts` as DRIVER_STATUSES, which means it has been enforced by whichever
-- code paths happened to import it and by nothing else.
--
-- That was survivable while every writer was a hand-written service. It stops being survivable at the
-- milestone where a SYNC starts writing the column from another vendor's vocabulary: McLeod says
-- 'Y'/'N', the agent maps that onto ours, and a mapping bug would write a novel value that no query
-- rejects. The damage would be silent in the worst way — every `status = 'active'` filter in the
-- product (the roster, the DQ queue, `auth_driver_id()`, the driver-session gate) would simply stop
-- returning those drivers, and nothing would raise.
--
-- Safe to add: production was surveyed on 2026-08-24 and holds only 'active', 'inactive', 'terminated'
-- and 'applicant' across all 271 rows. 'on_leave' is in the vocabulary and unused, and is admitted here
-- because `complianceOverview` already queries for it.
--
-- Deliberately NOT a Postgres enum. A CHECK can be widened in one statement by a later migration;
-- an enum drags a type dependency through every view and function that touches the column, and this
-- vocabulary has already grown twice (0204 added 'efs' to the neighbouring provenance column).

alter table drivers drop constraint if exists drivers_status_check;
alter table drivers add constraint drivers_status_check
  check (status in ('applicant', 'active', 'inactive', 'on_leave', 'terminated'));

comment on column drivers.status is
  'Employment status, matching DRIVER_STATUSES in packages/shared/src/constants.ts. Constrained since
   0240 because the McLeod roster sync writes it from a mapped vendor vocabulary, and an unconstrained
   novel value would be excluded by every status=''active'' query in the product without raising.';
