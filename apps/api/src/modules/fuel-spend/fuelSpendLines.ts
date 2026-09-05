/**
 * Reading a window of fuel as `SpendLine[]`, and reading the policy it is judged against.
 *
 * These two lived inside `fuelSpendReport.ts` until C6, which was fine while the PDF was their only
 * consumer and stopped being fine the moment a second one arrived. The nightly policy scan needs the
 * same month of fills and the same `route_fuel_settings` row, and a data reader is not part of a
 * document renderer: copying either of them here would have given the product two answers to "what did
 * this fleet buy" that drift the first time one of them is fixed.
 *
 * Both are ORG-FILTERED EXPLICITLY. `admin` is the service role and bypasses RLS, so the `p_org`
 * argument and the `.eq("org_id", …)` are the only tenant boundary this code has — the hard rule in
 * CLAUDE.md, stated as D-FC1 in migration 0247 after `fuel_spend_lines` returned every carrier in the
 * database and mixed a test org's 267 fills into a real carrier's report.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fuelPolicyFromSettings, type FuelPolicy, type FuelPolicyRow, type SpendLine } from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";

/**
 * ⚠ `p_org` IS NOT OPTIONAL HERE, whatever its default says.
 *
 * This comment used to read "fuel_spend_lines scopes itself: it is security-invoker over org-scoped
 * tables". The first half is true and the second does not follow. Security-invoker means RLS decides —
 * and `admin` is the SERVICE ROLE, which bypasses RLS. The function took no org, so this read returned
 * every carrier in the database and the document below mixed a test org's 267 fills into a real
 * carrier's exception and discount sections. That is the hard rule in CLAUDE.md: a service query
 * org-filters itself or it is wrong. See D-FC1 in migration 0247.
 */
export async function readSpendLines(admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[]): Promise<SpendLine[]> {
  const out: SpendLine[] = [];
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin
        .rpc("fuel_spend_lines", {
          p_from: from,
          p_to: to,
          p_vehicles: vehicleIds.length > 0 ? vehicleIds : null,
          p_org: orgId,
        })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        out.push({
          tranDate: str(r.tran_date),
          brand: str(r.brand),
          state: str(r.state),
          site: str(r.site),
          city: str(r.city),
          unit: str(r.unit),
          driver: str(r.driver),
          product: "diesel",
          tank: r.tank === "reefer" ? "reefer" : "tractor",
          gallons: n(r.gallons),
          netAmount: r.net_amount == null ? null : n(r.net_amount),
          // Null when no quote was in range — never 0, which would read as a fill billed exactly at
          // contract rather than as one nobody could measure.
          retailAmount: r.retail_amount == null ? null : n(r.retail_amount),
          contractAmount: r.contract_amount == null ? null : n(r.contract_amount),
          quoteStaleDays: r.quote_stale_days == null ? null : n(r.quote_stale_days),
        });
      }
    },
  );
  return out;
}

/**
 * The org's fuel policy. Org-filtered explicitly: `admin` is the SERVICE ROLE and bypasses RLS, so the
 * `.eq("org_id", …)` here is the only tenant boundary this read has — the same rule 0247's D-FC1 states
 * for `fuel_spend_lines`, and the reason `expectOrgScoped` asserts it.
 */
export async function readFuelPolicy(admin: SupabaseClient, orgId: string): Promise<FuelPolicy> {
  const { data } = await admin
    .from("route_fuel_settings")
    .select("avoid_states, avoid_brands, preferred_brands")
    .eq("org_id", orgId)
    .maybeSingle();
  return fuelPolicyFromSettings(data as FuelPolicyRow | null);
}
