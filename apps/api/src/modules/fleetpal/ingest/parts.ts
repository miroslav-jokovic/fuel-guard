import { fleetpalPartSchema, mapFleetpalUnit, type FleetpalPart } from "@silvicom/shared";
import { syncFleetpalPart, type FleetpalPartCandidate } from "../../maintenance/index.js";
import { FleetpalError } from "../errors.js";
import { advance, getSyncState, recordFailure } from "../syncState.js";
import type { IngestContext, IngestResult } from "./types.js";

/**
 * The parts catalogue (FLEETPAL-INTEGRATION-PLAN.md F12; owner 2026-10-27, Q-MX2: "why are we not
 * populating parts" from FleetPal).
 *
 * ── NOT A `stage_*` RESOURCE ──────────────────────────────────────────────────────────────────
 * Every other collection lands in a `fleetpal_*` mirror through `runIngest` and a set-based RPC.
 * Parts do not: they ARE the shop's catalogue, the `parts` table the Parts page, the scanner and the
 * count session already read, and a mirror beside it would be a second catalogue nobody could keep
 * in step. So each row goes through maintenance's own writer (`syncFleetpalPart`, D-FP2), one at a
 * time, idempotently — and the position moves the way `runIngest` moves it: only past timestamps
 * none of whose rows are still unwritten, because `updated_after` is exclusive.
 *
 * ── WHAT IS LEFT OUT, MEASURED 2026-10-28 (7,590 parts) ─────────────────────────────────────
 *   - 4,031 entries have no number. They are `VENDOR_HIDDEN` lines — what arrived on a vendor's
 *     quote, which FleetPal keeps so a work order can price a line, and which no shelf ever holds.
 *     A catalogue entry without a number is not a part anybody can pick, so they are skipped, not
 *     invented a number for.
 *   - Seven numbers appear on two entries each; the first in is written, the second reported
 *     (`syncFleetpalPart`'s duplicate outcome), never merged.
 *   - A description over 240 characters (the longest is 322) is cut to the column; a blank one
 *     (15) becomes the number, because a part with no description reads as a bug on every screen.
 *   - `manufacturer` is a FleetPal ID and `component` a VMRS id; neither is a word yet, and neither
 *     is written over a name the shop typed. `serialized_part` is false on every row.
 */
const DESCRIPTION_MAX = 240;
const UPC_MAX = 32;

export function toCandidate(row: FleetpalPart): FleetpalPartCandidate | null {
  const number = (row.number ?? "").trim();
  if (number === "" || number.length > 64) return null;
  const description = row.description.trim();
  const upc = row.universal_product_code.trim();
  return {
    fleetpalId: row.id,
    partNumber: number,
    description: (description === "" ? number : description).slice(0, DESCRIPTION_MAX),
    unitOfMeasure: mapFleetpalUnit(row.unit_of_measure),
    fleetpalUnit: row.unit_of_measure?.trim() || null,
    upc: upc === "" || upc.length > UPC_MAX ? null : upc,
  };
}

export const PARTS_RESOURCE = "parts";

export async function ingestParts(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const state = await getSyncState(admin, orgId, PARTS_RESOURCE);
  const since = state?.watermark ?? null;
  try {
    const rows = await client.walk("/v1/parts/", fleetpalPartSchema, since ? { updated_after: since } : {}, 20_000);
    if (rows.length === 0) return { resource: PARTS_RESOURCE, fetched: 0, staged: 0, advancedTo: null, error: null };
    const ordered = rows
      .map((row) => ({ row, updated: typeof row.updated === "string" && row.updated !== "" ? row.updated : null }))
      .sort((a, b) => (a.updated ?? "").localeCompare(b.updated ?? ""));
    let staged = 0;
    let advancedTo: string | null = null;
    for (let i = 0; i < ordered.length; i++) {
      const candidate = toCandidate(ordered[i]!.row);
      if (candidate) {
        const result = await syncFleetpalPart(admin, orgId, candidate);
        if ("error" in result) {
          await recordFailure(admin, orgId, PARTS_RESOURCE, result.error);
          return { resource: PARTS_RESOURCE, fetched: rows.length, staged, advancedTo, error: result.error };
        }
        if (result.outcome !== "skipped_duplicate_number") staged += 1;
      }
      // The position may move only to a timestamp every row of which has been handled — the rule
      // `runIngest` states for the same exclusive `updated_after`.
      const u = ordered[i]!.updated;
      const next = ordered[i + 1]?.updated ?? null;
      if (u !== null && u !== next && (since === null || u > since) && (i === ordered.length - 1 || i % 200 === 199)) {
        const moved = await advance(admin, orgId, PARTS_RESOURCE, { kind: "watermark", at: u }, i + 1);
        if ("error" in moved) return { resource: PARTS_RESOURCE, fetched: rows.length, staged, advancedTo, error: moved.error };
        advancedTo = u;
      }
    }
    return { resource: PARTS_RESOURCE, fetched: rows.length, staged, advancedTo, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, PARTS_RESOURCE, message);
    return { resource: PARTS_RESOURCE, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}
