/**
 * Source B — the independent HUMAN TRANSCRIPTION of the in-scope §172.101 fuel rows (Phase H1, D5 v5).
 * `import/diff.ts` compares this against Source A (the eCFR-XML parser) and the release gate requires
 * zero unexplained disagreements. This is the ONLY genuinely independent check on the parsed data, so
 * how it is produced matters:
 *
 *   TRANSCRIPTION DISCIPLINE
 *   1. Read ONLY the official GovInfo Title-49 legal PDF (fetch it with
 *      `GOVINFO_API_KEY=… npx tsx import/govinfoSmoke.ts`, which downloads the §172.101 PDF and prints
 *      its provenance). Do NOT open `fixtures/section-172-101.xml`, the parser output, or
 *      `parseHmt.test.ts` while transcribing — reading the same source the parser read defeats the check.
 *   2. Transcribe EXACTLY what is printed for each row. Record the words shown in ROMAN as the shipping
 *      name; where the table joins names with an italic "or", each name is a separate `psnAlternates`
 *      entry; any OTHER italic text (a qualifier like "with more than 10% ethanol", a "(No. 1, 2, …)"
 *      parenthetical, or a "see also …" cross-reference) goes in `italicText`, never in the name.
 *   3. Fill every column of every packing-group sub-row: (1) symbols, (2) name, (3) class, (5) PG,
 *      (6) label codes, (7) special provisions, (9C) bulk packaging, (9A/9B) quantity limits,
 *      (10A/10B) vessel stowage. A blank printed cell → `null` (scalars) or `[]` (lists). PG is `null`
 *      for Class 2 gases (no packing group). "None" in the label column → `[]`.
 *   4. Set `status: "done"` and fill `source` (package + section + page) and `transcriber` for each row
 *      you finish. Leave the rest `pending`. Then run `npx tsx import/diff.ts` (or the diff test).
 *
 * Only the row IDENTITY (prefix, number, printed name) is pre-filled below — that is the SCOPE, not the
 * answer. Everything the diff verifies is blank until you transcribe it. A filled row looks like:
 *
 *   {
 *     status: "done",
 *     idPrefix: "UN", idNumber: "1223", psnPrinted: "Kerosene",
 *     symbols: [], psnAlternates: [], italicText: null,
 *     hazardClass: "3", subsidiaryClasses: [],
 *     pgRows: [
 *       { pg: "III", labelCodes: ["3"], specialProvisions: ["144", "B1", "IB3", "T2", "TP2"],
 *         bulkPackagingRef: "242",
 *         quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
 *         vesselStowage: { location: "A", other: [] } },
 *     ],
 *     source: "GovInfo CFR-2025-title49-vol2 §172.101 p.###", transcriber: "<name>", transcribedOn: "2026-08-01", notes: null,
 *   },
 */

import type { TranscribedRow } from "../diff.js";

const pending = (idPrefix: "UN" | "NA", idNumber: string, psnPrinted: string): TranscribedRow => ({
  status: "pending",
  idPrefix,
  idNumber,
  psnPrinted,
  symbols: [],
  psnAlternates: [],
  italicText: null,
  hazardClass: null,
  subsidiaryClasses: [],
  pgRows: [],
  source: "",
  transcriber: "",
  transcribedOn: null,
  notes: null,
});

/**
 * The 13 in-scope fuel entries (the 12 ERG fuel IDs; diesel/heating-oil appear under both UN1202 and
 * NA1993). Replace each `pending(...)` stub with a fully-filled `{ status: "done", … }` literal as you
 * transcribe it from the official PDF. Keep the identity fields exactly as shown so the diff can pair
 * each row with its parsed counterpart.
 */
export const HAND_VERIFIED_ROWS: TranscribedRow[] = [
  pending("UN", "1203", "Gasoline"),
  pending("UN", "1202", "Diesel fuel"),
  pending("NA", "1993", "Diesel fuel"),
  pending("NA", "1993", "Fuel oil"),
  pending("UN", "3475", "Ethanol and gasoline mixture"),
  pending("UN", "1170", "Ethanol"),
  pending("UN", "1987", "Alcohols, n.o.s."),
  pending("UN", "1863", "Fuel, aviation, turbine engine"),
  pending("UN", "1268", "Petroleum distillates, n.o.s."),
  pending("UN", "1223", "Kerosene"),
  pending("UN", "1075", "Petroleum gases, liquefied"),
  pending("UN", "1978", "Propane"),
  pending("UN", "3257", "Elevated temperature liquid, n.o.s."),
];
