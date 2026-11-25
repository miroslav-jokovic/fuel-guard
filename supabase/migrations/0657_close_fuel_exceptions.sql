-- 0657 — close named reconciliation findings, with the reason, in one audited act
-- (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §5, "the invoice check carries forward").
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────
-- `sync_fuel_exceptions` (0320) closes what a run no longer finds, but only INSIDE the period that run read.
-- Measured on production 2026-11-25, that leaves three things nothing can close:
--
--   1. A fill Pilot billed a week LATE. Week 1's check files "in our records, not on Pilot's bill"; week 2's
--      invoice carries the fill, but week 2 reads its own week, so week 1's finding stays open for good.
--      89 `recon_missing_on_report` findings are open today, across ten weekly checks.
--   2. A bill line whose fill we recorded LATE (a late EFS post). Its "on Pilot's bill, not in our records"
--      finding is in a week no later check reads.
--   3. What a RE-CHECK of the same invoice no longer produces, when the re-check reads a different period.
--      INV-59656 was first checked as 11/16–11/23 (the 2026-11 layout prints no period and the first reader
--      took the span of its line dates); 62 of its 66 findings are fills dated 11/23, which belong to next
--      week's bill. Re-checked as the billing week 11/16–11/22, the 11/23 findings are outside the new period.
--
-- The API now decides each of these from the evidence (fuelReconCarry.ts) and names the findings to close.
-- This function closes them — set-based, audited, and with the reason as the event's note, so the history of
-- a $9,000 dispute says WHY it closed: "Billed on invoice INV-59660", not "it stopped appearing".
--
-- ── WHAT IT WILL NOT TOUCH ───────────────────────────────────────────────────────────────────────
-- Only `open` and `investigating` rows move. `disputed`, `credited` and `dismissed` are a person's decision
-- (D-FX10) and are left exactly as they are, which is the same rule `sync_fuel_exceptions` keeps. A closed row
-- reopens on its own if a later run produces it again (0320's `resolved_by_reingest` → `open`).
-- Only the kinds the caller names, so a reconciliation can never close a policy or contract finding.
--
-- service_role only, like every definer RPC since 0411: the browser has no write path into this ledger.
--
-- ⚠ DEPLOY WINDOW: a new function, called by nothing in this merge. Its first caller ships in the next one
-- (held by hand: `lint:migration-ordering` cannot see a function, [[hold-a-function-reader-behind-its-migration]]).
--
-- cross-module-waiver: like `sync_fuel_exceptions`, it writes its own `audit_logs` row (org module) beside the
-- `fuel_exceptions` change — a definer RPC under the service role is invisible to the JWT-based audit triggers,
-- so `p_actor` is the only witness to who ran it.
--
-- Rollback: `drop function close_fuel_exceptions(uuid, text[], text[], text, uuid, uuid)`.

create or replace function close_fuel_exceptions(
  p_org          uuid,
  p_fingerprints text[],
  p_kinds        text[],
  p_note         text,
  p_actor        uuid default null,
  p_run          uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed int := 0;
begin
  if p_org is null then
    raise exception 'close_fuel_exceptions requires an org' using errcode = 'FE011';
  end if;
  if p_kinds is null or cardinality(p_kinds) = 0 then
    raise exception 'close_fuel_exceptions requires the kinds the caller is authoritative for' using errcode = 'FE013';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 or length(p_note) > 500 then
    raise exception 'close_fuel_exceptions requires a reason of 1 to 500 characters' using errcode = 'FE014';
  end if;
  if p_fingerprints is null or cardinality(p_fingerprints) = 0 then
    return 0;
  end if;

  with closed as (
    update fuel_exceptions e
       set status = 'resolved_by_reingest',
           resolved_at = now(),
           resolved_by = p_actor
     where e.org_id = p_org
       and e.kind = any (p_kinds)
       and e.fingerprint = any (p_fingerprints)
       and e.status in ('open', 'investigating')
    returning e.id
  )
  insert into fuel_exception_events (org_id, exception_id, kind, to_status, actor_id, note)
  select p_org, c.id, 'closed_by_reingest', 'resolved_by_reingest', p_actor, p_note
    from closed c;
  get diagnostics v_closed = row_count;

  insert into audit_logs (org_id, actor_id, action, entity, meta)
  values (p_org, p_actor, 'fuel.exceptions_closed', 'fuel_exceptions',
          jsonb_build_object('run', p_run, 'closed', v_closed, 'asked', cardinality(p_fingerprints),
                             'kinds', p_kinds, 'note', p_note));
  return v_closed;
end
$$;

revoke all on function close_fuel_exceptions(uuid, text[], text[], text, uuid, uuid) from public;
grant execute on function close_fuel_exceptions(uuid, text[], text[], text, uuid, uuid) to service_role;
