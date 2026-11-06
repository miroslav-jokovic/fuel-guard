import { z } from "zod";
import { DQ_EXPORT_MAX_DRIVERS } from "./dqExportContract.js";
import { isRecordId, recordId } from "./recordId.js";

/**
 * The cover sheet that goes on top of one driver's paper folder before the stack is scanned
 * (DRIVER-PAPER-INTAKE-PLAN PI1, Q-PI2 (a)). Intake (PI2) finds these pages in a scanned PDF and cuts
 * the file at each one: every page after a sheet, up to the next, is that driver's.
 *
 * ── WHY THE QR CARRIES THE DRIVER'S ID, NOT A `SIL1:` TAG (D-PI1) ────────────────────────────────
 * The plan proposed a `DRV` tag kind with a code table, as trucks have (`unit_tags`, 0531). Measured
 * against what a cover sheet is, the table buys nothing and costs a known trap:
 * - A tag is a LABEL: stuck on a truck for years, read aloud when scuffed, so it needs a short code
 *   that never changes. A cover sheet is a SEPARATOR: printed for one scan, recycled after. A full id
 *   on a letter page scans as easily as six characters on a 1-inch label.
 * - A table keyed to `drivers(id)` must be added to `merge_driver`'s list in the same migration, or a
 *   merge destroys it silently — it has happened twice (memory `merge-driver-cascade-trap`). No table,
 *   no list to forget.
 * - Nothing in the shop scans a driver; the tag resolver would have answered nobody.
 * A sheet naming a driver that a merge has since folded away is reported by intake as "this sheet
 * names a driver no longer on file", and the reviewer assigns the pages — loud, never a wrong owner.
 *
 * The prefix keeps it apart from every other code: `parseTag` refuses it (two fields, not three), and
 * no retail barcode starts with letters. The id is not a secret — intake checks the driver is the
 * uploader's own organization's before a page is assigned.
 */
export const COVER_SHEET_PREFIX = "SILDQF1";

/** The QR payload for one driver's sheet. The only place the string is built. */
export function formatCoverSheetPayload(driverId: string): string {
  if (!isRecordId(driverId)) throw new Error(`Refusing to print a cover sheet for "${driverId}": not a driver id.`);
  return `${COVER_SHEET_PREFIX}:${driverId.toLowerCase()}`;
}

/** The driver id a scanned cover sheet names, or null when the text is not one of our sheets. */
export function parseCoverSheetPayload(text: string): string | null {
  const [prefix, id, ...rest] = text.trim().split(":");
  if (rest.length || prefix?.toUpperCase() !== COVER_SHEET_PREFIX || !id || !isRecordId(id)) return null;
  return id.toLowerCase();
}

/**
 * `POST /api/compliance/cover-sheets`. The cap is the Drivers selection's own (`DQ_EXPORT_MAX_DRIVERS`,
 * the binder bar's), read rather than restated; a stack of that many folders is already more than one
 * scan file holds (PLAN §4: about 5–10 folders per file).
 */
export const coverSheetRequestSchema = z.object({
  driverIds: z.array(recordId()).min(1).max(DQ_EXPORT_MAX_DRIVERS),
});
export type CoverSheetRequest = z.infer<typeof coverSheetRequestSchema>;
