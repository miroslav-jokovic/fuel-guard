-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0182 — declines carry a DERIVED driver, and say so.
--
-- WHY. `CardManagementEP_getTranRejects` does not return driver identity. Verified against the live
-- production endpoint on 2026-08-12: 110 records, ten fields each — tranDate, cardNum, invoice,
-- locId, locName, locCity, locState, errorCode, errorDesc, unit. No driverName, no driverId, no
-- infos array. The `"Driver ID": null, "Driver Name": null` in efsSoap.ts rejectedRows() was
-- CORRECT; nothing was being dropped in our mapping. The EFS *portal* enriches its reject export
-- with the card's driver prompt before rendering, which is why the manual XLSX has names the feed
-- can never carry.
--
-- Consequence: every decline this org has (3,251 rows, 2026-02-04 → 2026-08-12, 100% from the SOAP
-- feed) has a null driver_name, and no amount of re-polling will change that. The name has to be
-- DERIVED on our side, from the card.
--
-- WHAT THIS ADDS. `driver_name_source` records where a decline's driver_name came from, so a derived
-- name is never mistaken for a vendor-supplied one:
--
--   'efs_report'     — the driver name EFS itself printed on an uploaded reject report (faithful)
--   'card_mirror'    — the card's assigned driver from efs_cards (getCardSummaries), matched on the
--                      full PAN via card_ref_hmac. The card's driver, NOT proof of who was at the pump.
--   'posted_history' — the driver EFS reported on APPROVED transactions for this same card.
--
-- That distinction is the product, not pedantry: a decline is precisely the case where the card may
-- not be with its assigned driver, and the derived name must never read as evidence that it was.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table declined_transactions add column if not exists driver_name_source text;

-- Constraint added defensively: Postgres has no `add constraint if not exists`, and this migration
-- must stay re-runnable (docs/22 records a migration being silently skipped by a ledger version
-- collision, then applied by hand — a re-run must not error).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.declined_transactions'::regclass
      and conname  = 'declined_transactions_driver_name_source_check'
  ) then
    alter table declined_transactions
      add constraint declined_transactions_driver_name_source_check
      check (driver_name_source is null
             or driver_name_source in ('efs_report', 'card_mirror', 'posted_history'));
  end if;
end $$;

-- Existing rows that already carry a name can only have got it from an uploaded EFS report — the
-- feed has never supplied one. Tag them so the UI does not label vendor truth as derived.
update declined_transactions
   set driver_name_source = 'efs_report'
 where driver_name_source is null
   and driver_name is not null
   and btrim(driver_name) <> '';

-- Supports "which declines still have no resolvable driver?" without a sequential scan.
create index if not exists idx_declined_driver_source
  on declined_transactions (org_id, driver_name_source);
