-- 0355: the 53 reserved unit numbers stop claiming to be part of the fleet.
-- FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md **F5** (D-FC10). No schema changes — this file is entirely
-- data, and it is the plan's "audited data act, human-reviewed before it runs": the review is this
-- PR, and every row it touches writes itself into `audit_logs`.
--
-- ⚠ **F4 was in this file and has been REMOVED. It was built on a wrong reading of unit 732.**
-- The plan's §1.7 called 732 "two rows, one truck"; an earlier draft of this migration "corrected"
-- that to two physical trucks, on the strength of Samsara naming one record `732 - OLD`. The carrier
-- says otherwise and the vendor data agrees with the carrier: `- OLD` is what this fleet renames a
-- Samsara record to when a GATEWAY IS REPLACED, and the `732 - OLD` record carries
-- `gateway: {serial: "", model: "none"}` — no device — while the live `732` record carries gateway
-- G6AA-5HS-XTC and a static assigned driver. **One truck, one device swap.** A rename is therefore
-- the wrong act: the two rows have to be merged, which decides where 102 fuel transactions, 217
-- spend-days and a learned 240-gallon tank capacity end up, and that is not a decision to take as a
-- side effect of this file. F4 returns when the merge has an owner's answer behind it.
--
-- cross-module-waiver: `vehicles` is roster-owned and `audit_logs` is org-owned (infra). The audit
-- row is not a cross-module READ — it is the record of the act, written by the act, which is the one
-- shape D-ARC3 asks an evidence write to take. Nothing here reads org's tables.
--
-- ── WHAT THESE ROWS ARE ─────────────────────────────────────────────────────────────────────────
-- Measured against McLeod on 2026-09-22: 54 of its 247 `service_status = 'A'` tractors carry neither
-- a purchase date nor a model year, have never been dispatched, hold no driver and no gateway, and
-- share one `inservice_date`. They are unit numbers reserved against an order. 53 of them reached
-- our roster as `active` under the old predicate; the 54th is McLeod's own test row MCTEST, which
-- never did (verified: zero matching rows here).
--
-- Nothing else will fix them. 0353 added the `ordered` value and merge 4 (#963) taught the sweep to
-- derive a status, but P4 no longer SELECTS a reserved unit number at all — correctly, since it is
-- not a truck — so the sweep will never see these 53 again.
--
-- They cannot be left as they are, and it is not only a matter of counting:
--
--   · every fleet count is 53 trucks too high, which is the inflated denominator this plan exists to
--     remove;
--   · and the moment anybody runs a `reconcile`-mode sweep, `reconcileAbsentFromTms` will RETIRE all
--     53 — they are linked rows absent from P4's active list, which is exactly its trigger. `retired`
--     is the wrong word for a truck that was never in service (D-FC10 rejected it for that reason),
--     and `IN_SERVICE_VEHICLE_STATUSES` makes `ordered` the state that stops the sweep touching them.
--     **So this file wants to land before the next reconcile sweep, not after it.**
--
-- ── WHY THE SELECTION IS McLEOD'S LIST AND NOT A RULE OVER OUR OWN COLUMNS ──────────────────────
-- The obvious predicate — `purchased_at is null and year is null`, the same question
-- `deriveVehicleStatus` asks — selects **60** rows here, not 53. The extra seven are units 804, 805,
-- 806, 807, 808, 809 and 811: real trucks bought on 2026-09-14 whose gateways went in over the last
-- five days, six of them with idle data recorded today. Our copy of McLeod's purchase date is simply
-- stale on them, because the identity sweep has not run since they arrived. Marking those seven
-- `ordered` would have taken seven working trucks out of the operating fleet — out of the §396.17
-- inspection roster with them — under the banner of a cleanup.
--
-- Adding "no gateway, no fills, no positions" as a guard does not save it either: unit 811 is a
-- purchased truck still waiting for its gateway, and D-FC4 is explicit that such a truck IS a truck.
-- The discriminator lives in McLeod and nowhere else, so the ids below are McLeod's own answer, read
-- from `dbo.tractor` on 2026-09-22 and pinned here. That is a restatement of a measurement, which is
-- normally the thing to avoid — it is acceptable here only because this is a ONE-OFF correction of
-- rows a retired predicate created, not a rule that has to keep being true.
--
-- The three same-table guards are the safety belt for the gap between measuring and applying: a
-- reservation that became a real truck in the meantime will have gained a gateway or a purchase date
-- and is skipped, silently and correctly.

with marked as (
  update vehicles
     set status = 'ordered'
   where mcleod_tractor_id = any (array[
           '812','813','814','815','816','817','818','819','820','821','822','823','824','825',
           '826','827','828','829','830','831','832','833','834','835','836','837','838','839',
           '840','841','842','843','844','845','846','847','848','849','850','851','852','853',
           '854','855','856','857','858','859','860','861','862','863','864'
         ])
     and status = 'active'          -- never re-open a row somebody has already moved
     and samsara_vehicle_id is null -- a gateway means a truck, whatever the list says
     and purchased_at is null       -- as does a purchase date
     and year is null
  returning id, org_id, unit_number
)
insert into audit_logs (org_id, actor_id, action, entity, entity_id, meta)
select org_id,
       null,
       'roster.vehicle_marked_ordered',
       'vehicles',
       id,
       jsonb_build_object(
         'unit_number', unit_number,
         'from', 'active',
         'to', 'ordered',
         'reason', 'reserved unit number: McLeod carries no purchase_date and no model_year',
         'measured_at', '2026-09-22',
         'migration', '0355',
         'plan', 'FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md F5'
       )
  from marked;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────
-- A plain UPDATE, reversible by hand from its own audit rows, which carry the before and after value
-- per row. Nothing is deleted, no row is merged, no child row moves.
