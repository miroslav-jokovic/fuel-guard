import { MedstopClient, MedstopError, medstopPoolRow, type MedstopErrorKind } from "./client.js";

/**
 * Does this key open the account — asked BEFORE it is stored, as FleetPal's door does: the vendor
 * shows a key once, so the moment the admin pastes it is the only moment a typo is cheap.
 *
 * `/Random/pools` because it is small (two pools a year) and the sweep needs it: a key whose
 * security groups cannot read it is a key the sweep cannot use.
 */
export type ProbeOutcome = { ok: true; ms: number } | { ok: false; kind: MedstopErrorKind; message: string };

export async function probeApiKey(apiKey: string, baseUrl: string, fetchImpl?: typeof fetch): Promise<ProbeOutcome> {
  const client = new MedstopClient({ apiKey, baseUrl, timeoutMs: 15_000, maxRetries: 0, fetchImpl });
  const started = Date.now();
  try {
    await client.list("/Random/pools", medstopPoolRow, 5);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof MedstopError) return { ok: false, kind: e.kind, message: e.message };
    return { ok: false, kind: "transport", message: e instanceof Error ? e.message : String(e) };
  }
}
