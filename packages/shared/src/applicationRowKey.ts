import { recordId } from "./recordId.js";

/**
 * The stable id of one row of a list the office corrects row by row (APPLICATION-FIX-PLAN Q-AM15 (a),
 * owner 2026-11-11): addresses, licences, equipment, accidents and convictions, as the employers have
 * had since AW1 (D-AW8). An office correction names the row by it — `["addresses", "<key>", "city"]` —
 * so a row the DRIVER later deletes or reorders on their phone takes nothing with it but itself, where a
 * recorded position would point the correction at its neighbour. Minted by the form when a row is added
 * (and, for a draft from before keys, by the form on load or the office's first write).
 *
 * Nullish, never required: every application filed before Q-AM15 has none and must go on parsing, and
 * a filing from the form leaves it out (`toApplication`), because the key addresses a draft, not an answer.
 */
export const applicationRowKeySchema = recordId().nullish();
