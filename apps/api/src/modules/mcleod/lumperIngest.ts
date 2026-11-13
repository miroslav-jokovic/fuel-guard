import type { SupabaseClient } from "@supabase/supabase-js";
import type { LumperSweepPayload } from "@silvicom/shared";

/**
 * One lumper sweep into `mcleod_lumper_*` (LUMPER-REVISED-RC-PLAN.md LRC2, migration 0600).
 *
 * ONE function call, on purpose. The sweep replaces what 360 holds for its window: it writes the
 * rows it carries and deletes the charges, settlement lines and bills McLeod no longer has. Done as
 * separate statements from here, a failure between the delete and the insert would leave every open
 * case reading "charge removed" until the next sweep. `lumper_sweep_apply` does all of it in one
 * transaction and opens a case for each order it has not seen before.
 *
 * The function is scoped by the org and company passed here; the org comes from the ingest token,
 * never from the body.
 */
export interface LumperSweepResult {
  orders: number;
  charges: number;
  payments: number;
  bills: number;
  chargesRemoved: number;
  paymentsRemoved: number;
  billsRemoved: number;
  casesOpened: number;
}

export async function ingestLumperSweep(admin: SupabaseClient, orgId: string, payload: LumperSweepPayload): Promise<LumperSweepResult> {
  const { data, error } = await admin.rpc("lumper_sweep_apply", {
    p_org: orgId,
    p_company: payload.company_id,
    p_since: payload.since,
    p_orders: payload.orders,
    p_charges: payload.charges,
    p_payments: payload.payments,
    p_bills: payload.bills,
  });
  if (error) throw new Error(`[lumper] sweep not recorded: ${error.message}`);
  const r = (data ?? {}) as Partial<LumperSweepResult>;
  return {
    orders: Number(r.orders ?? 0),
    charges: Number(r.charges ?? 0),
    payments: Number(r.payments ?? 0),
    bills: Number(r.bills ?? 0),
    chargesRemoved: Number(r.chargesRemoved ?? 0),
    paymentsRemoved: Number(r.paymentsRemoved ?? 0),
    billsRemoved: Number(r.billsRemoved ?? 0),
    casesOpened: Number(r.casesOpened ?? 0),
  };
}
