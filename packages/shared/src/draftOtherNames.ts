import { z } from "zod";
import { applicationRowKeySchema } from "./applicationRowKey.js";

/**
 * The other names in the DRAFT: `{ name, key }`, keyed like the five lists of objects (Q-AM22 (b), owner
 * 2026-11-13).
 *
 * ── WHY THE DRAFT ONLY ────────────────────────────────────────────────────────────────────────
 * Q-AM15 keyed the rows of the object lists, so an office correction names its row by key and a driver who
 * deletes or reorders rows on the phone never moves a correction onto a neighbour. The other names were
 * plain strings, with nowhere to hold a key, so a deletion after a correction still moved it. The key
 * addresses a DRAFT row, never an answer: the filed document (`driverApplicationObject.other_names`), the
 * packet, the employer inquiry and `drivers.other_names` keep plain names, and the draft's names are
 * handed on as names wherever a draft becomes an application (`toApplication`, `otherNamesAsFiled`).
 *
 * ⚠ A draft saved before this holds plain strings, and may for as long as it is open. Every reader takes
 * both: a string is a row with no key, which the driver's next load (`fromDraftPayload`) or the office's
 * first write (`withRowKeys`) keys.
 */
export interface DraftOtherName {
  name: string;
  key?: string;
}

/**
 * A draft's other name, either shape. A blank name is a box the driver just added, as every list's blank
 * row is; `toApplication` drops it. The key's shape is the other lists' (`applicationRowKeySchema`).
 */
export const draftOtherNameSchema = z.union([
  z.string().min(1).max(120),
  z.object({ name: z.string().max(120), key: applicationRowKeySchema }).strict(),
]);

/** The words of one row, whichever shape it was saved in. */
export function otherNameText(row: unknown): string {
  if (typeof row === "string") return row;
  if (row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string") return (row as { name: string }).name;
  return "";
}

/** The names as the application files them: words only, trimmed, blanks dropped. */
export const filedOtherNames = (rows: unknown): string[] =>
  Array.isArray(rows) ? rows.map(otherNameText).map((n) => n.trim()).filter((n) => n !== "") : [];

/** A draft payload with its other names as the application files them — for any reader that treats a draft as one. */
export function otherNamesAsFiled<T extends Record<string, unknown>>(payload: T): T {
  return Array.isArray(payload.other_names) ? { ...payload, other_names: filedOtherNames(payload.other_names) } : payload;
}
