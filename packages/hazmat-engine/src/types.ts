import { z } from "zod";

/**
 * @hazmat/engine — the locked I/O contract (plan H2). Breaking changes bump the minor version.
 * The engine is pure: no I/O, no clock (caller supplies `evaluatedAt`), Zod-only. It cannot import
 * @hazmat/data (boundary), so it reads the dataset through a minimal consumer view (`datasetRefSchema`)
 * — the full dataset is passed through; the engine reads only what a given phase needs.
 */
export const ENGINE_VERSION = "0.15.0";

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
  /** The offeror's LIMITED QUANTITY declaration (§172.203(b) paper notation / §172.315 mark) —
   *  INPUT, never inferred, same posture as reclassedCombustible. Since 0.10.0 (H-LQ) the engine
   *  VERIFIES the claim against HMT column 8A + the 30 kg/66 lb per-package cap and either applies
   *  §172.500(b)(2) (excepted from the whole placarding subpart) or refuses it fail-closed. */
  isLimitedQuantity: z.boolean().default(false),
  /**
   * The declared net quantity. NULLABLE on purpose: the calculator form used to coerce a blank field
   * to `0`, which made "the dispatcher did not state a quantity" indistinguishable from "the BOL says
   * zero" — the opposite of the fail-closed posture `grossWeightLb` already had, and a value the
   * security-plan threshold downstream would have read as a real declaration.
   */
  quantity: z.object({ value: z.number().nullable().default(null), unit: quantityUnitSchema }),
  grossWeightLb: z.number().nullable().default(null),
  compartmentIndex: z.number().int().nullable().default(null),
  isResidueLine: z.boolean().default(false),
  flashPointF: z.number().nullable().default(null),
  ethanolPct: z.number().nullable().default(null),
  packagingKind: packagingKindSchema,
  packageCount: z.number().int().nullable().default(null),
  /**
   * §171.8: percent by weight of the marine-pollutant component, when the line is a SOLUTION OR
   * MIXTURE. Null means the material itself, or a mixture nobody measured — both of which stay
   * classified as a marine pollutant, so the field can only ever remove a requirement when someone
   * actually states the number (0.14.0).
   */
  marinePollutantConcentrationPct: z.number().nullable().default(null),
  /**
   * §172.322(d)(1): the NET QUANTITY in each single package, or in each inner packaging of a
   * combination packaging — not the outer package, and not a capacity.
   *
   * The UNIT carries the phase, which is why value and unit travel together: §172.322(d)(1)(i) is a
   * 5 L limb for liquids and (d)(1)(ii) a 5 kg limb for solids, and `phaseForHazardClass` cannot
   * tell them apart (it only ever answers "gas" or "liquid" — hazard class does not state phase).
   * Litres means the liquid limb; kilograms the solid one. Null leaves the mark required (0.15.0).
   */
  marinePollutantPerPackage: z
    .object({ value: z.number(), unit: z.enum(["L", "kg"]) })
    .nullable()
    .default(null),
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
  /**
   * 0.11.0 (H-MX): does the vehicle carry ANY freight beyond the declared hazmat lines — hazardous or
   * otherwise? `true` = mixed load, `false` = the lines above are the whole load, `null` = unknown
   * (the conservative default, which preserves pre-0.11 behavior exactly).
   *
   * Read by ONE rule: the §172.301(a)(3) non-bulk single-material ID display, whose fourth condition
   * is that the vehicle "contains no other material, hazardous or otherwise". It must NEVER feed the
   * §172.504(c) aggregate — the CFR counts hazardous materials only, so adding other freight there
   * would over-placard, and that arithmetic is correct today without this field.
   */
  otherFreightAboard: z.boolean().nullable().default(null),
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
/**
 * How an identification number may be displayed on a transport vehicle.
 *  · `on_placard`          — across the center area of the placard itself, §172.332(c)
 *  · `orange_panel`        — the 160 × 400 mm orange panel, §172.332(b)
 *  · `white_square_on_point` — a plain white square-on-point the size of a placard, §172.336(b);
 *                            explicitly NOT a placard.
 */
export type IdDisplayFormat = "on_placard" | "orange_panel" | "white_square_on_point";

export interface PlacardOutput {
  required: Array<{ placard: PlacardName; positions: "each_side_and_each_end"; because: Citation[] }>;
  /**
   * Placards that are NOT required but MAY be displayed — §172.502(c). A carrier under the 1,001 lb
   * Table 2 aggregate is entitled to placard anyway, and many do as a matter of policy. Reporting this
   * as an empty required-set with no further comment reads as "no placards", which is a different and
   * misleading statement.
   */
  permitted: Array<{ placard: PlacardName; because: Citation[] }>;
  optionalSubstitutions: Array<{ instead: PlacardName; use: PlacardName; because: Citation[] }>;
  prohibited: Array<{ placard: PlacardName; because: Citation[] }>;
  idDisplays: Array<{
    idNumber: string;
    /**
     * The display the engine RECOMMENDS. An identification number is one requirement with several
     * lawful presentations, and the engine used to hardcode `orange_panel` as if it were the only
     * one — so a Class 8 van came back as "worded CORROSIVE placard + separate orange panel" when
     * the display that actually rolls down the road is a single CORROSIVE diamond reading 1789
     * across its center (§172.332(c)). `alternateFormats` carries the rest; nothing here is a
     * statement that the others are unlawful.
     */
    format: IdDisplayFormat;
    /** Every lawful presentation for this number on THIS load, recommended first (§172.334 applied). */
    alternateFormats: Array<{ format: IdDisplayFormat; because: Citation[]; note?: string }>;
    /**
     * When `on_placard` is available: the required placards this number may be displayed across.
     * §172.334 removes RADIOACTIVE, every EXPLOSIVES division, DANGEROUS and any placard shown for
     * a subsidiary hazard, so an empty list means the number needs its own panel.
     */
    onPlacards: PlacardName[];
    positions: string;
    because: Citation[];
  }>;
  ergGuides: Array<{ idNumber: string; guide: string }>;
  marks: Array<{ mark: "MARINE_POLLUTANT" | "LIMITED_QUANTITY" | "HOT"; positions: string; because: Citation[] }>;
  /**
   * The arithmetic the placarding decision actually ran on. It existed only inside a trace node's
   * `inputs`, so the UI could report "44,307 lb" buried in one finding's prose but could not show the
   * reviewer WHICH lines were counted, which were excluded, and how the total sat against the three
   * bars that matter. A verdict a dispatcher cannot check is a verdict they will not trust.
   */
  aggregate?: {
    /** Non-bulk Table-2 lines that count toward the §172.504(c) 1,001 lb threshold. */
    countedLines: number;
    /** §172.202(a)(7) package count over the counted lines; null when any line left it blank. */
    countedPackages: number | null;
    /** Their aggregate gross weight in pounds; null when any counted line left the weight blank. */
    countedGrossWeightLb: number | null;
    thresholdMet: boolean;
    /** Lines that placard regardless of the aggregate — bulk packaging or a §172.505 subsidiary. */
    alwaysPlacardLines: number;
    /** Residue-only non-bulk lines excluded by §172.504(d) / §173.29(c). */
    residueExcludedLines: number;
    /** The three bars, so the UI never has to hardcode them. */
    thresholds: { placardLb: number; dangerousCategoryLb: number; nonBulkIdDisplayLb: number };
  };
  /**
   * 0.11.0 (H-MX): what kind of load this is, stated so the UI never re-derives it. `packaging` is the
   * §171.8 profile of the RESOLVED hazmat lines (a cargo tank is bulk by definition);
   * `otherFreightAboard` echoes the input tri-state so "mixed hazmat + general freight" is sayable.
   */
  loadProfile?: {
    packaging: "bulk" | "non_bulk" | "mixed";
    hazmatLines: number;
    distinctPlacardCategories: number;
    otherFreightAboard: boolean | null;
  };
}
export interface Verdict {
  engineVersion: string;
  datasetVersion: string;
  placards: PlacardOutput;
  /** The engine is a pure function with NO clearing concept — clearing is the app's call (H4/H7).
   *  Since 0.8.0 (M5.2) `eligible` is REACHABLE: every check clean + every provided input
   *  evaluated + dataset complete enough to check everything. */
  eligibility: { status: "eligible" | "blocked" | "not_checked"; blocks: Finding[] };
  /**
   * Everything the engine concluded that does NOT gate the load (0.13.0).
   *
   * `eligibility.blocks` carries only `conditional` and `violation`, because those are what decide
   * eligibility. Until now `info` findings were simply DROPPED on the floor of `evaluateLoad` — so
   * sixteen rules computed an explanation and threw it away, and `computeAdvisories` in the API
   * promised reviewers "conditional/warning/info" context it could never have received.
   *
   * What was lost is precisely the reasoning behind a QUIET answer: why no placard is required below
   * 1,001 lb, why a residue line left the aggregate, why a Limited Quantity line is excepted from the
   * whole subpart, why a marine pollutant needs no mark on an already-placarded vehicle, and — from
   * the two early-exit gates, which discarded their finding without even reaching the ladder — that
   * the load declares no hazardous materials at all, or that a cleaned-and-purged tank must not be
   * placarded. A verdict that says "nothing is required" and cannot say why is the one a reviewer has
   * least reason to trust.
   *
   * Segregation findings are NOT duplicated here: they have their own array and the UI renders it.
   * Optional so a verdict recorded before 0.13.0 still parses.
   */
  notices?: Finding[];
  segregation: Finding[];
  /** Since 0.8.0 (G2): the §172.202 basic descriptions the shipping paper must carry. */
  bol?: { lines: Array<{ hmtRef: string; basicDescription: string; additionalRequired: string[] }> };
  trace: TraceNode[];
}

export function emptyPlacards(): PlacardOutput {
  return { required: [],
    permitted: [], optionalSubstitutions: [], prohibited: [], idDisplays: [], ergGuides: [], marks: [] };
}
