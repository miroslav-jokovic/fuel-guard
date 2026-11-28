/**
 * One truck's fault codes, read fresh for a maintenance follow-up's drawer and never stored
 * (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27 §7, D-ORM8/D-ORM9). Two GETs with the org's own token: the
 * truck's latest reading (`/fleet/vehicles/stats`) and its readings over the window
 * (`/fleet/vehicles/stats/history`). Both run in parallel — measured 243 ms and ≤ 483 ms.
 *
 * Parsing a Samsara code lives here and only here (docs/ARCHITECTURE.md §2). `parseFaultCode` is also
 * what the collector's lamp row keeps (`truckLamps`, D-ORM10), so the drawer's fallback reads the same
 * shape the live read returns.
 *
 * The CALLER (modules/followups) checks the truck belongs to a follow-up of the caller's org before
 * this is asked; the token is the org's, so Samsara itself cannot answer with another org's truck.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TruckFaultCode, TruckFaultSnapshot, TruckLampState } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { NoSamsaraTokenError } from "../samsaraVehicleSync.js";
import { fetchFaultCodeHistory, fetchFaultCodes, type WarningFetchContext } from "./warningFetch.js";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Samsara's words for an SPN the engine maker defines (155 of 290 live codes, 2026-11-27). */
const MAKER_SPECIFIC = "Manufacturer Assignable SPN";

/** One `diagnosticTroubleCodes[]` item. Refused (null) without an SPN — there is nothing to look up. */
export function parseFaultCode(raw: unknown): TruckFaultCode | null {
  const c = obj(raw);
  const spn = count(c?.spnId);
  if (!c || spn === null) return null;
  const description = text(c.spnDescription);
  const makerSpecific = description === MAKER_SPECIFIC;
  return {
    module: count(c.txId),
    moduleName: text(c.sourceAddressName),
    spn,
    fmi: count(c.fmiId),
    description: makerSpecific ? null : description,
    fmiDescription: text(c.fmiDescription),
    makerSpecific,
    occurrences: count(c.occurrenceCount),
  };
}

/** The codes of one `faultCodes` value (`{ j1939: { diagnosticTroubleCodes, checkEngineLights } }`). */
export function parseFaultReading(value: unknown): { codes: TruckFaultCode[]; lamps: TruckLampState | null } {
  const j = obj(obj(value)?.j1939);
  const codes = (Array.isArray(j?.diagnosticTroubleCodes) ? j.diagnosticTroubleCodes : [])
    .map(parseFaultCode)
    .filter((c): c is TruckFaultCode => c !== null);
  const l = obj(j?.checkEngineLights);
  const lamps = l
    ? { stop: l.stopIsOn === true, warning: l.warningIsOn === true, emissions: l.emissionsIsOn === true, protect: l.protectIsOn === true }
    : null;
  return { codes, lamps };
}

export interface TruckFaultCodesRead {
  /** When Samsara took the latest reading; null when it has none for this truck. */
  asOf: string | null;
  lamps: TruckLampState | null;
  now: TruckFaultCode[];
  history: TruckFaultSnapshot[];
}

const isoOf = (v: unknown): string | null => {
  const s = text(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null;
};

export async function readTruckFaultCodes(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  vehicleSamsaraId: string,
  window: { sinceIso: string; untilIso: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<TruckFaultCodesRead> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const ctx: WarningFetchContext = { env, token, priority: "live", fetchImpl: opts.fetchImpl };
  const [latest, readings] = await Promise.all([
    fetchFaultCodes(ctx, [vehicleSamsaraId]),
    fetchFaultCodeHistory(ctx, vehicleSamsaraId, window.sinceIso, window.untilIso),
  ]);
  const mine = latest.map(obj).find((v) => String(v?.id ?? "") === vehicleSamsaraId);
  const current = obj(mine?.faultCodes);
  const parsed = parseFaultReading(current);
  const history: TruckFaultSnapshot[] = [];
  for (const r of readings) {
    const at = isoOf(obj(r)?.time);
    if (at) history.push({ at, codes: parseFaultReading(r).codes });
  }
  return { asOf: isoOf(current?.time), lamps: current ? parsed.lamps : null, now: parsed.codes, history };
}
