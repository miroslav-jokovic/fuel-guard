-- FuelGuard — 0193 backfill capability promotions (execution plan Step 4.2)
--
-- 0191 created `efs_capability_promotions` and deliberately put nothing in it. This migration fills
-- it, and it MUST ship in the same change as the gate that reads it.
--
-- ── Why the ordering is load-bearing ────────────────────────────────────────────────────────────
-- Step 4.2 makes `loadCardControlAccess` refuse any capability whose promotion is not `enabled`. The
-- default for a row that does not exist is "not promoted". So between a deploy that enforces the gate
-- and a backfill that grants it, EVERY card operation in production is refused — lock, unlock,
-- override, prompts — for orgs that have been using them for weeks. The backfill is not bookkeeping;
-- it is the only thing that makes the gate safe to introduce, which is why the plan says to write
-- them together and why 0191 explicitly declined to do it early.
--
-- ── What is backfilled, and what deliberately is not ────────────────────────────────────────────
-- The FIVE capabilities that are live today, for every org whose `write_entitlement` is already
-- 'confirmed' — that flag is the account-level permission the pre-capability world used, so
-- inheriting from it grants exactly what was already reachable and nothing more. An org that never
-- had write access does not acquire it here.
--
-- `delete_override` is NOT backfilled. It is the alternative override-clear mechanism, gated by
-- `EFS_CARD_DELETE_OVERRIDE_ENABLED` and still unproven — the guide documents what the op does but
-- not what it writes into the override trio (finding D1). It stays `not_promoted` until a proof run
-- says otherwise, which is precisely the state this table exists to express.

insert into efs_capability_promotions (org_id, capability_key, state, reason, promoted_at)
select s.org_id, cap.key, 'enabled',
       'backfilled from Phase B write_entitlement (migration 0193)', now()
  from efs_card_control_settings s
 cross join (values
     ('card_lock'), ('card_unlock'), ('override_grant'), ('override_clear'), ('prompts_set')
   ) as cap(key)
 where s.write_entitlement = 'confirmed'
on conflict (org_id, capability_key) do nothing;

-- `do nothing` rather than `do update`: re-running this must never resurrect a capability an
-- operator has since SUSPENDED. A backfill that un-suspends is a backfill that re-enables a write
-- path somebody switched off on purpose, and suspension is the one control that has to be trusted
-- at two in the morning.
