import { z } from "zod";

/**
 * @hazmat/data — dataset schema (Phase H1, deliverable 1). The machine-readable shape of every
 * regulatory table the engine needs, modeled at two granularities because the printed 172.101 table
 * is not flat: one entry can span multiple PG sub-rows, carry several legal 'or'-alternate names, and
 * duplicate across UN/NA and D/I symbol variants (verified against live eCFR). PG is NULL for entries
 * with an empty PG column (all Class 2 gases have NO packing group). Content is populated by the
 * human-reviewed, dual-source import (deliverables 2/3/6) — this file is only the contract.
 */

export const idPrefixSchema = z.enum(["UN", "NA"]);
export type IdPrefix = z.infer<typeof idPrefixSchema>;

export const packingGroupSchema = z.enum(["I", "II", "III"]);
export type PackingGroup = z.infer<typeof packingGroupSchema>;

export const pgRowSchema = z.object({
  /** null for entries with an empty PG column — Class 2 gases (UN1075/UN1978 have NO packing group). */
  pg: packingGroupSchema.nullable(),
  labelCodes: z.array(z.string()).default([]),
  specialProvisions: z.array(z.string()).default([]),
  /** Column 8A — the §173.* EXCEPTIONS section for this row ("150" → §173.150), or null when the
   *  printed cell is "None"/blank. The key LQ trigger (H-LQ). OPTIONAL (not defaulted) on purpose:
   *  datasets minted before 2026.08.0 don't carry it, and a zod default would inject the field into
   *  their parsed form and break their stored content checksums. */
  exceptionsRef: z.string().nullable().optional(),
  /** Column 8B — the §173.* NON-BULK packaging section. Same optionality reasoning as 8A. */
  nonBulkPackagingRef: z.string().nullable().optional(),
  bulkPackagingRef: z.string().nullable().default(null),
  quantityLimits: z
    .object({
      passengerAircraftRail: z.string().nullable().default(null),
      cargoAircraft: z.string().nullable().default(null),
    })
    .optional(),
  vesselStowage: z
    .object({
      location: z.string().nullable().default(null),
      other: z.array(z.string()).default([]),
    })
    .optional(),
});
export type PgRow = z.infer<typeof pgRowSchema>;

export const hmtEntrySchema = z.object({
  /** Stable synthetic id (the canonical key; NOT the UN number, which is not unique across UN/NA/D/I). */
  entryId: z.string(),
  /** §172.101(b) symbols: +, A, D, G, I, W … */
  symbols: z.array(z.string()).default([]),
  psnPrinted: z.string(),
  /** 'or'-alternate legal names ("Gas oil" / "Diesel fuel" / "Heating oil, light" → one UN1202 entry). */
  psnAlternates: z.array(z.string()).default([]),
  /** §172.101(c)(2): italic text is stored separately and is never part of the PSN. */
  italicText: z.string().nullable().default(null),
  hazardClass: z.string().nullable(),
  subsidiaryClasses: z.array(z.string()).default([]),
  idPrefix: idPrefixSchema,
  idNumber: z.string(),
  pgRows: z.array(pgRowSchema).min(1),
});
export type HmtEntry = z.infer<typeof hmtEntrySchema>;

/** Derived at build time: one record per (alternate name × pg-row). See buildMatchRecords(). */
export const hmtMatchRecordSchema = z.object({
  normalizedPsn: z.string(),
  idPrefix: idPrefixSchema,
  idNumber: z.string(),
  pg: packingGroupSchema.nullable(),
  entryId: z.string(),
});
export type HmtMatchRecord = z.infer<typeof hmtMatchRecordSchema>;

export const placardSpecSchema = z.object({
  classOrDivision: z.string(),
  table: z.union([z.literal(1), z.literal(2)]),
  placardName: z.string(),
  designRef: z.string().nullable().default(null),
  /** Alternate wordings: GASOLINE (§172.542(c)), FUEL OIL (§172.544(c)). */
  wordingOptions: z.array(z.string()).default([]),
});
export type PlacardSpec = z.infer<typeof placardSpecSchema>;

/** One cell of the §177.848(d) segregation grid. */
export const segregationCellSchema = z.object({
  rowClass: z.string(),
  colClass: z.string(),
  value: z.enum(["X", "O", "*"]).nullable(),
  notes: z.string().nullable().default(null),
});
export type SegregationCell = z.infer<typeof segregationCellSchema>;

/** Appendix A to §172.101 — hazardous-substances / RQ table. */
export const hazSubstanceSchema = z.object({
  name: z.string(),
  nameNormalized: z.string(),
  casNumber: z.string().nullable().default(null),
  rqPounds: z.number(),
  rqKg: z.number(),
});
export type HazSubstance = z.infer<typeof hazSubstanceSchema>;

/** Appendix B to §172.101 — marine pollutants. `severe` = the "PP" column. */
export const marinePollutantSchema = z.object({
  name: z.string(),
  nameNormalized: z.string(),
  severe: z.boolean(),
});
export type MarinePollutant = z.infer<typeof marinePollutantSchema>;

export const ergEntrySchema = z.object({ idNumber: z.string(), guideNumber: z.string() });
export type ErgEntry = z.infer<typeof ergEntrySchema>;

export const specialProvisionTextSchema = z.object({ id: z.string(), text: z.string() });
export type SpecialProvisionText = z.infer<typeof specialProvisionTextSchema>;

export const datasetSchema = z.object({
  /** Calendar version, e.g. "2026.07.0" — stored on every verdict for reproducibility (D9/G6). */
  version: z.string(),
  /** true until two-source verification lands; a provisional dataset may never CLEAR a load (H1.6/H4). */
  provisional: z.boolean().default(false),
  sourceEcfrDate: z.string().nullable().default(null),
  sourceSecondaryRef: z.string().nullable().default(null),
  effectiveDate: z.string().nullable().default(null),
  checksum: z.string().nullable().default(null),
  entries: z.array(hmtEntrySchema).default([]),
  placards: z.array(placardSpecSchema).default([]),
  segregation: z.array(segregationCellSchema).default([]),
  hazSubstances: z.array(hazSubstanceSchema).default([]),
  marinePollutants: z.array(marinePollutantSchema).default([]),
  erg: z.array(ergEntrySchema).default([]),
  specialProvisions: z.array(specialProvisionTextSchema).default([]),
});
export type Dataset = z.infer<typeof datasetSchema>;

/** Validate a raw dataset (from JSON) against the schema — the engine's data boundary. Throws on drift. */
export function parseDataset(raw: unknown): Dataset {
  return datasetSchema.parse(raw);
}
