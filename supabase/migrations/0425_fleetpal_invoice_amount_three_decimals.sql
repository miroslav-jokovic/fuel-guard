-- 0425: FleetPal invoice amounts keep their third decimal, and the two already rounded are re-read.
--
-- MAINTENANCE-MONEY-CONTROL-PLAN.md step C1b, option (a), accepted by the owner on 2026-10-04.
-- 0424 made payments and order lines numeric(14,3) because the vendor sends up to three decimals,
-- and recorded that 0351's `fleetpal_po_invoices.amount` had the same defect. This is that fix.
--
-- ── MEASURED BEFORE WRITING (live account and production, 2026-10-04) ───────────────────────────
-- A walk of all 4,095 live invoices finds exactly two with a third decimal, and production already
-- holds both ROUNDED (the first sweep staged them at 15:17Z):
--   · `cqUW4Msw` (`X101239989:01`): FleetPal 108.489, ours 108.49, vendor `updated` 2025-12-31.
--   · `7uUeeoFb` (`X101211349:01`): FleetPal 188.774, ours 188.77, vendor `updated` 2025-06-13.
-- No view or rule depends on the column in production (`pg_depend` through `pg_rewrite`: none).
--
-- ── ⚠ WIDENING ALONE WOULD NOT CORRECT EITHER ROW ────────────────────────────────────────────────
-- Both sit behind the `purchase-order-invoices` watermark (2026-10-03 18:00:38Z in production), and
-- `updated_after` is EXCLUSIVE, so the sweep never asks for them again unless the vendor edits them.
-- The column would say 108.490 for ever. So this migration also clears THAT ONE resource's
-- watermark. NULL is 0334's own meaning for "never run": the next sweep walks all 4,095 invoices
-- once (~21 pages) and the idempotent stage function rewrites both from FleetPal's own value. The
-- figure still comes from the vendor; nothing here types a number in (D-FP16 — option (c), a
-- hand-written UPDATE of the two amounts, was rejected for exactly that).
--
-- Every other resource's position is untouched. Where no key is set (staging, a fresh database)
-- the clear changes no row.
--
-- ⚠ A sweep already running when this applies can write its own watermark over the clear. The
-- post-release check therefore reads the two AMOUNTS, not the watermark (plan §8, 2026-10-04).
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- Old code against the new schema: it sends the same JSON, and a wider recordset type accepts
-- everything a narrower one did. New code is unchanged. No reader or writer changes in this file.
--
-- raw-access-waiver: `fleetpal_po_invoices` and `fleetpal_sync_state` are raw-layer tables of the
-- fleetpal module; the only function this file touches is that module's own stage function.
--
-- Written to be re-applied safely: the type change, the `create or replace`, the grants and the
-- clear are each idempotent, and the matrix re-runs this file against seeded positions to prove the
-- clear touches one resource only.
--
-- Rollback: alter the column back to numeric(14,2) (rounds the two rows again) and restore 0351's
-- function body. The cleared watermark needs no rollback; the next sweep sets it.

alter table fleetpal_po_invoices alter column amount type numeric(14,3);

comment on column fleetpal_po_invoices.amount is
  'numeric(14,3): the vendor sends up to three decimals (2 of 4,095 on 2026-10-04). CREDIT carries a POSITIVE amount; the sign is invoice_type (0351).';

-- 0351's body, with only the recordset's `amount` type changed. Every column still appears in both
-- the INSERT and the DO UPDATE (never a partial upsert), and the tenant still comes from `p_org`.
create or replace function public.stage_fleetpal_po_invoices(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare written int;
begin
  insert into public.fleetpal_po_invoices as t (
    org_id, fleetpal_id, purchase_order_fleetpal_id, invoice_type, invoice_number, invoice_date,
    amount, payable_to_fleetpal_id, payment_term_fleetpal_id, vendor_created_at, vendor_updated_at
  )
  select p_org, r.fleetpal_id, r.purchase_order_fleetpal_id, r.invoice_type, r.invoice_number,
         r.invoice_date, r.amount, r.payable_to_fleetpal_id, r.payment_term_fleetpal_id,
         r.vendor_created_at, r.vendor_updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           fleetpal_id text, purchase_order_fleetpal_id text, invoice_type text,
           invoice_number text, invoice_date timestamptz, amount numeric(14,3),
           payable_to_fleetpal_id text, payment_term_fleetpal_id text,
           vendor_created_at timestamptz, vendor_updated_at timestamptz)
  on conflict (org_id, fleetpal_id) do update
    set purchase_order_fleetpal_id = excluded.purchase_order_fleetpal_id,
        invoice_type = excluded.invoice_type, invoice_number = excluded.invoice_number,
        invoice_date = excluded.invoice_date, amount = excluded.amount,
        payable_to_fleetpal_id = excluded.payable_to_fleetpal_id,
        payment_term_fleetpal_id = excluded.payment_term_fleetpal_id,
        vendor_created_at = excluded.vendor_created_at,
        vendor_updated_at = excluded.vendor_updated_at, updated_at = now();
  get diagnostics written = row_count;
  return written;
end;
$$;

-- `create or replace` keeps the existing ACL; restated so the file says who may call it, as 0424
-- does.
revoke all on function public.stage_fleetpal_po_invoices(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stage_fleetpal_po_invoices(uuid, jsonb) to service_role;

-- The re-read. One resource, every org that has one; `window_end` is not this resource's position
-- and stays as it is.
update fleetpal_sync_state
   set watermark = null
 where resource = 'purchase-order-invoices'
   and watermark is not null;
