/**
 * The open fuel findings, one row per kind — the Fuel Costs savings strip's data (FS-STRIP, Q-FSV15
 * ruling 1). The ranking is `summariseOpportunities` in shared; this file only reads and gates.
 *
 * ── SAME POPULATION AS THE INBOX THE ROWS LINK TO ────────────────────────────────────────────────
 * "Open" is the queue states the inbox calls open, investigating and working, translated through
 * `exceptionStatusesIn` rather than restated, and the window and truck filters are the inbox's own
 * (`occurred_on` between the dates; trucks resolved to unit numbers because `fuel_exceptions.vehicle_id`
 * is never written). A row that said 12 and opened an inbox showing 9 would be worse than no row.
 *
 * ── PAGED, NOT CAPPED ────────────────────────────────────────────────────────────────────────────
 * The inbox read stops at 500 rows because it is a screenful. A count must not: PostgREST would cap a
 * bare select at 1,000 and the strip would report a ceiling as a total. `fetchAllPaged` reads to the end.
 *
 * ── WHO MAY ASK IS THE ROUTE'S QUESTION ──────────────────────────────────────────────────────────
 * `requireSection("fuel", "view")` gates the route (`routes/opportunities.ts`), and every kind in this
 * ledger belongs to the fuel section, so a caller that reaches this read may see all of it. The first
 * version answered `null` to a caller without the section, copying `/findings/summary`; that answer exists
 * there because the Dashboard has no gate, and `routeGateLedger.test.ts` rightly refused an open route
 * here. Gating the route is the exact fix and leaves no unreachable branch behind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEUE_EXCEPTION_KINDS,
  exceptionStatusesIn,
  summariseOpportunities,
  type FindingQueueState,
  type FuelOpportunity,
  type OpenExceptionRow,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { fleetScope } from "./findingsRead.js";

export interface OpportunityFilters {
  from?: string | null;
  to?: string | null;
  vehicleIds?: string[] | null;
}

export async function readFuelOpportunities(
  admin: SupabaseClient,
  orgId: string,
  f: OpportunityFilters = {},
): Promise<FuelOpportunity[]> {
  const openStates: FindingQueueState[] = ["open", "investigating", "working"];
  const statuses = [...new Set(openStates.flatMap((s) => exceptionStatusesIn(s)))];

  const fleet = f.vehicleIds?.length ? await fleetScope(admin, orgId, f.vehicleIds) : null;
  // A truck filter that matches no vehicle is nothing, not everything (the inbox's rule).
  if (fleet && fleet.units.length === 0) return [];

  const rows = await fetchAllPaged<OpenExceptionRow>((from, to) => {
    let q = admin
      .from("fuel_exceptions")
      .select("kind, amount, occurred_on")
      .eq("org_id", orgId)
      .in("status", statuses)
      // The queue's kinds only (9b): each row links to Fuel problems, which no longer lists buying habits.
      .in("kind", [...QUEUE_EXCEPTION_KINDS]);
    if (fleet) q = q.in("unit_number", fleet.units);
    if (f.from) q = q.gte("occurred_on", f.from);
    if (f.to) q = q.lte("occurred_on", f.to);
    // A stable order is what makes `.range()` pages disjoint.
    return q.order("occurred_on", { ascending: true }).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{
      data: OpenExceptionRow[] | null;
      error: { message: string } | null;
    }>;
  });
  return summariseOpportunities(rows);
}
