import { fleetpalShopSchema } from "@silvicom/shared";
import { FleetpalClient } from "./client.js";
import { FleetpalError, type FleetpalErrorKind } from "./errors.js";

/**
 * Does this key open the account — asked BEFORE it is stored (FLEETPAL-INTEGRATION-PLAN.md §8,
 * 2026-10-04, the connection door).
 *
 * The vendor shows a key once and keeps no copy we can read back, so the moment the admin pastes it
 * is the only moment a typo is cheap. Stored unchecked, a bad key surfaces an hour later as a red
 * sweep on a page nobody is looking at, and the cause reads as "FleetPal is down".
 *
 * `/v1/shops/` because it is the smallest collection the key's role must be able to read (one row on
 * the live account, F4) and the sweep reads it anyway — a key that cannot is a key the sweep cannot
 * use. One retry, short deadline: an admin is waiting on the answer, and a vendor outage is reported
 * as such rather than retried for two minutes behind a spinner.
 */
export type ProbeOutcome =
  | { ok: true; ms: number }
  | { ok: false; kind: FleetpalErrorKind; message: string };

export async function probeApiKey(
  apiKey: string,
  baseUrl: string,
  fetchImpl?: typeof fetch,
): Promise<ProbeOutcome> {
  const client = new FleetpalClient({ apiKey, baseUrl, timeoutMs: 15_000, maxRetries: 1, fetchImpl });
  const started = Date.now();
  try {
    await client.walk("/v1/shops/", fleetpalShopSchema, {}, 2);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof FleetpalError) return { ok: false, kind: e.kind, message: e.message };
    return { ok: false, kind: "transport", message: e instanceof Error ? e.message : String(e) };
  }
}
