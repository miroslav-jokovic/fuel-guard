import { z } from "zod";

/**
 * @hazmat/engine — the locked I/O contract (plan H2). Breaking changes bump the minor version.
 * The engine is pure: no I/O, no clock (caller supplies `evaluatedAt`), Zod-only. It cannot import
 * @hazmat/data (boundary), so it reads the dataset through a minimal consumer view (`datasetRefSchema`)
 * — the full dataset is passed through; the engine reads only what a given phase needs.
 */
export const ENGINE_VERSION = "0.4.0";

export const datasetRefSchema = z
  .object({ version: z.string(), provisional: z.boolean().default(false) })
  .loose();
export type DatasetRef = z.infer<typeof datasetRefSchema>;

// ── inputs ──────────────────────────────────────────────────────────────────
export const vehicleKindSchema = z.enum(["cargo_tank", "van_or_flatbed"]);
export const tankStateSchema = z.enum(["loaded", "residue_uncleaned", "cleaned_and_purged"]);
export const packagingKindSchema = z.enum(["bulk", "non_bulk"]);
export const quantityUnitSchema = z.enum(["gal", "lb", "kg", "L"]);

export const lineSchema = z.object({
  /** Canonical resolution `${entryId}#${pg ?? 'none'}` — from a picker or resolveHmtLine() (H6). */
  hmtRef: z.string(),
  /** The offeror's §173.150(f) election — INPUT, never inferred. */
  reclassedCombustible: z.boolean().default(false),
  quantity: z.object({ value: z.number(), unit: quantityUnitSchema }),
  grossWeightLb: z.number().nullable().default(null),
  compartmentIndex: z.number().int().nullable().default(null),
  isResidueLine: z.boolean().default(false),
  flashPointF: z.number().nullable().default(null),
  ethanolPct: z.number().nullable().default(null),
  packagingKind: packagingKindSchema,
  packageCount: z.number().int().nullable().default(null),
});
export type HazmatLine = z.infer<typeof lineSchema>;

export const vehicleSchema = z.object({
  kind: vehicleKindSchema,
  cargoTankCapacityGal: z.number().nullable().default(null),
  compartments: z
    .array(z.object({ index: z.number().int(), capacityGal: z.number() }))
    .nullable()
    .default(null),
});

export const claimedExceptionsSchema = z.object({
  shipperClaimsNoPlacards: z.boolean().default(false),
  claimedSpecialPermits: z.array(z.string()).default([]),
});

export const portContextSchema = z.object({
  vesselConnected: z.boolean().nullable().default(null),
  imdgPapers: z.boolean().nullable().default(null),
});

export const tripContextSchema = z.object({
  previousOrCurrentBusinessDayIds: z.array(z.string()).nullable().default(null),
  carrierRelationship: z
    .enum(["carrier_supplied_cargo_tank", "shipper_supplied_common_carrier", "private_carrier", "unknown"])
    .default("unknown"),
});

export const loadInputSchema = z.object({
  evaluatedAt: z.string(),
  vehicle: vehicleSchema,
  tankState: tankStateSchema.default("loaded"),
  lines: z.array(lineSchema).default([]),
  claimedExceptions: claimedExceptionsSchema.default({ shipperClaimsNoPlacards: false, claimedSpecialPermits: [] }),
  portContext: portContextSchema.default({ vesselConnected: null, imdgPapers: null }),
  tripContext: tripContextSchema.default({ previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" }),
  /** OrgHazmatPolicy — null → pure calculator mode. H8 locks the shape; opaque here. */
  policy: z.unknown().nullable().default(null),
  dataset: datasetRefSchema,
});
export type LoadInput = z.infer<typeof loadInputSchema>;

// ── outputs ─────────────────────────────────────────────────────────────────
export type Citation = { cfr: string; interpretation?: string };
export type FindingTier = "violation" | "conditional" | "warning" | "info";
export interface Finding {
  ruleId: string;
  tier: FindingTier;
  message: string;
  citations: Citation[];
  evidence: Record<string, unknown>;
}
export type PlacardName =
  | "FLAMMABLE" | "GASOLINE" | "COMBUSTIBLE" | "FUEL_OIL" | "FLAMMABLE_GAS" | "NON_FLAMMABLE_GAS"
  | "OXYGEN" | "POISON_GAS" | "FLAMMABLE_SOLID" | "SPONTANEOUSLY_COMBUSTIBLE" | "DANGEROUS_WHEN_WET"
  | "OXIDIZER" | "ORGANIC_PEROXIDE" | "POISON" | "POISON_INHALATION_HAZARD" | "CORROSIVE"
  | "RADIOACTIVE" | "CLASS_9" | "DANGEROUS"
  | "EXPLOSIVES_1_1" | "EXPLOSIVES_1_2" | "EXPLOSIVES_1_3" | "EXPLOSIVES_1_4" | "EXPLOSIVES_1_5" | "EXPLOSIVES_1_6";
export interface TraceNode {
  ruleId: string;
  fired: boolean;
  inputs: Record<string, unknown>;
  citations: Citation[];
  note?: string;
}
export interface PlacardOutput {
  required: Array<{ placard: PlacardName; positions: "each_side_and_each_end"; because: Citation[] }>;
  optionalSubstitutions: Array<{ instead: PlacardName; use: PlacardName; because: Citation[] }>;
  prohibited: Array<{ placard: PlacardName; because: Citation[] }>;
  idDisplays: Array<{ idNumber: string; format: "on_placard" | "orange_panel" | "white_square_on_point"; positions: string; because: Citation[] }>;
  ergGuides: Array<{ idNumber: string; guide: string }>;
  marks: Array<{ mark: "MARINE_POLLUTANT" | "LIMITED_QUANTITY" | "HOT"; positions: string; because: Citation[] }>;
}
export interface Verdict {
  engineVersion: string;
  datasetVersion: string;
  placards: PlacardOutput;
  /** The engine is a pure function with NO clearing concept — clearing is the app's call (H4/H7). */
  eligibility: { status: "eligible" | "blocked" | "not_checked"; blocks: Finding[] };
  segregation: Finding[];
  trace: TraceNode[];
}

export function emptyPlacards(): PlacardOutput {
  return { required: [], optionalSubstitutions: [], prohibited: [], idDisplays: [], ergGuides: [], marks: [] };
}
