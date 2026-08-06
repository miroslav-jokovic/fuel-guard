import { z } from "zod";
import type { UserRole } from "./constants.js";

/**
 * HazmatGuard API DTOs (plan H4). App-layer contracts live in `@fuelguard/shared`, NEVER in `@hazmat/*`,
 * so the engine + data packages stay dependency-free and extractable (D3/G5).
 */

// ── /hazmat/calc — stateless placard calculator (also the H12 licensed-API surface) ──────────────
export const hazmatCalcRequestSchema = z.object({
  datasetVersion: z.string().optional(),
  load: z.record(z.string(), z.unknown()),
});
export type HazmatCalcRequest = z.infer<typeof hazmatCalcRequestSchema>;

export interface HazmatCalcResponse {
  engineVersion: string;
  datasetVersion: string;
  datasetProvisional: boolean;
  /** M7: the placard-art release version — provisional (SPECIMENS) until M10 (§11.7). */
  placardArtVersion?: string;
  verdict: unknown;
}

// ── GET /hazmat/products — HMT product lookup for the manual pickers (plan H5) ────────────────────
// The web app cannot import @hazmat/data (Node-only, ~2–4 MB whole-file JSON), so the picker resolves
// products through the API. One row per (HMT entry × pg-row) so a selection yields a canonical `hmtRef`
// directly (no second PG step in the common case). With no `q`, the curated fuel shortlist is returned
// (D4 launch scope); with `q`, the full HMT is searched by UN/NA number, PSN, or 'or'-alternate name.
export const hazmatProductsQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type HazmatProductsQuery = z.infer<typeof hazmatProductsQuerySchema>;

export interface HazmatProduct {
  /** Canonical engine reference `${entryId}#${pg ?? 'none'}` — drop straight into a LoadInput line. */
  hmtRef: string;
  entryId: string;
  idPrefix: "UN" | "NA";
  idNumber: string;
  /** Display id, e.g. "UN1203". */
  idLabel: string;
  /** Proper shipping name as printed (§172.101(c)). */
  psn: string;
  hazardClass: string | null;
  subsidiaryClasses: string[];
  pg: "I" | "II" | "III" | null;
  symbols: string[];
  /** Human-readable one-line label for the picker, e.g. "UN1203 · Gasoline · Class 3 · PG II". */
  label: string;
  /** true when this is one of the curated common-fuel rows (the no-query default set). */
  isFuelCommon: boolean;
}

export interface HazmatProductsResponse {
  datasetVersion: string;
  products: HazmatProduct[];
}

// ── role sets ─────────────────────────────────────────────────────────────────
// The `hazmat` SECTION (auth.ts) gates general management (loads CRUD, documents). Clearing + review is
// TIGHTER — separation of duties (D6): dispatchers create loads, they do NOT clear them.
export const HAZMAT_REVIEW_ROLES: readonly UserRole[] = ["admin", "fleet_manager", "safety_manager"];

// Cargo-tank profile WRITES must match the 0092 table RLS (admin/fleet_manager/safety_manager). A
// dispatcher "manages" the hazmat section (creates loads) but NOT equipment config — gating profile
// writes with the generic canManage would let a dispatcher write through the service-role API what RLS
// denies them directly. Keep these two sets in lockstep with the migration.
export const HAZMAT_EQUIPMENT_WRITE_ROLES: readonly UserRole[] = ["admin", "fleet_manager", "safety_manager"];

// ── shared enums (mirror the migration check constraints) ─────────────────────
export const hazmatTankStateSchema = z.enum(["loaded", "residue_uncleaned", "cleaned_and_purged"]);
export const hazmatCarrierRelationshipSchema = z.enum([
  "carrier_supplied_cargo_tank", "shipper_supplied_common_carrier", "private_carrier", "unknown",
]);
export const hazmatDocKindSchema = z.enum(["bol", "securement", "placard_photo", "special_permit", "other"]);

// ── POST /hazmat/loads ─────────────────────────────────────────────────────────
export const hazmatCreateLoadRequestSchema = z.object({
  id: z.string().uuid(), // client-generated (idempotency, 02 §10.2)
  vehicleId: z.string().uuid().nullable().default(null),
  trailerId: z.string().uuid().nullable().default(null),
  driverId: z.string().uuid().nullable().default(null),
  tankState: hazmatTankStateSchema.default("loaded"),
  carrierRelationship: hazmatCarrierRelationshipSchema.default("unknown"),
  plannedPickupAt: z.string().nullable().default(null),
  declaredLines: z.array(z.record(z.string(), z.unknown())).default([]), // LoadInput.lines
  specialPermitNumbers: z.array(z.string()).default([]),
  claimedNoPlacards: z.boolean().default(false),
  supersedesLoadId: z.string().uuid().nullable().default(null),
});
export type HazmatCreateLoadRequest = z.infer<typeof hazmatCreateLoadRequestSchema>;

// ── PATCH /hazmat/loads/:id (draft only — enforced by the state machine `canEditLoad`) ──────────
export const hazmatUpdateLoadRequestSchema = z
  .object({
    vehicleId: z.string().uuid().nullable().optional(),
    trailerId: z.string().uuid().nullable().optional(),
    driverId: z.string().uuid().nullable().optional(),
    tankState: hazmatTankStateSchema.optional(),
    carrierRelationship: hazmatCarrierRelationshipSchema.optional(),
    plannedPickupAt: z.string().nullable().optional(),
    declaredLines: z.array(z.record(z.string(), z.unknown())).optional(),
    specialPermitNumbers: z.array(z.string()).optional(),
    claimedNoPlacards: z.boolean().optional(),
  })
  .strict();
export type HazmatUpdateLoadRequest = z.infer<typeof hazmatUpdateLoadRequestSchema>;

// ── GET /hazmat/loads?status=&cursor=&limit= (keyset-paginated, 01 §9) ──────────
export const hazmatListLoadsQuerySchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(), // opaque: the created_at of the last row on the previous page
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** "asc" = oldest-first (the review queue: longest-waiting at the top); default newest-first. */
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type HazmatListLoadsQuery = z.infer<typeof hazmatListLoadsQuerySchema>;

// ── POST /hazmat/loads/:id/cancel — reason required (plan H4 state machine) ─────
export const hazmatCancelRequestSchema = z.object({ reason: z.string().min(1) });
export type HazmatCancelRequest = z.infer<typeof hazmatCancelRequestSchema>;

// ── POST /hazmat/loads/:id/documents → registers a row + returns a signed upload URL ────────────
export const hazmatRegisterDocumentRequestSchema = z.object({
  id: z.string().uuid(), // client-generated document id (idempotent replay)
  kind: hazmatDocKindSchema,
  page: z.number().int().min(1).default(1),
  sha256: z.string().min(1),
  contentType: z.string().default("image/webp"),
  /** M6 driver capture provenance (DCE §7). Optional — managers registering documents omit it. */
  capture: z
    .object({
      configVersion: z.string(),
      mode: z.enum(["system_scanner", "raw_capture", "expo_camera"]),
      osEnhanced: z.boolean(),
      integrityHash: z.string().min(1),
      quality: z.record(z.string(), z.unknown()),
      ocrEvidence: z.record(z.string(), z.unknown()).nullable().default(null),
    })
    .optional(),
});
export type HazmatRegisterDocumentRequest = z.infer<typeof hazmatRegisterDocumentRequestSchema>;

export interface HazmatRegisterDocumentResponse {
  documentId: string;
  storagePath: string;
  /** Supabase signed upload URL + token; the client PUTs the image to it. */
  uploadUrl: string;
  token: string;
}

// ── GET/PUT /hazmat/policy (admin-only write; H8 locks the OrgHazmatPolicy shape) ───────────────
/**
 * OrgHazmatPolicy — LOCKED (M5.1). Two keys exist because two behaviors exist; a key with no
 * consuming code is a lie waiting to be believed. `strictObject` makes PUT reject unknown keys —
 * a typo'd knob must 400, never be silently stored and silently ignored.
 *
 *   extractionEnabled           — the org-level kill-switch the extraction orchestrator reads.
 *   extractionMonthlyTokenBudget — the D17 monthly budget (null = unlimited).
 *
 * Engine-side policy semantics (thresholds, auto-clear preferences) are a SEPARATE, later lock —
 * the engine's LoadInput.policy stays null in v1 and is audited as not_evaluated if provided
 * (M5.3), so nothing can smuggle behavior through an untyped bag.
 */
export const orgHazmatPolicySchema = z.strictObject({
  extractionEnabled: z.boolean().default(true),
  extractionMonthlyTokenBudget: z.number().int().positive().nullable().default(null),
});
export type OrgHazmatPolicy = z.infer<typeof orgHazmatPolicySchema>;

export const hazmatPolicyPutRequestSchema = z.strictObject({ policy: orgHazmatPolicySchema });
export type HazmatPolicyPutRequest = z.infer<typeof hazmatPolicyPutRequestSchema>;

// ── cargo-tank profiles (plan H5) — capacity + compartment plan per truck/trailer ────────────────
// Feeds the engine `vehicle` block. NOTE (verified 2026-07-31): the engine does not yet READ capacity or
// compartments — those rules are H2 (capacity → ID-display threshold; compartments → per-compartment math).
// Captured now so the data + audit trail exist and take effect when that logic lands. Exactly one of
// vehicleId/trailerId (mirrors the 0092 check constraint).
export const hazmatCompartmentSchema = z.object({
  index: z.number().int().min(1),
  capacityGal: z.number().nonnegative(),
});
export type HazmatCompartment = z.infer<typeof hazmatCompartmentSchema>;

export const hazmatCargoTankProfileCreateSchema = z
  .object({
    id: z.string().uuid(), // client-generated (idempotent replay)
    vehicleId: z.string().uuid().nullable().default(null),
    trailerId: z.string().uuid().nullable().default(null),
    cargoCapacityGal: z.number().nonnegative().nullable().default(null),
    compartments: z.array(hazmatCompartmentSchema).default([]),
  })
  .refine((v) => (v.vehicleId === null) !== (v.trailerId === null), {
    message: "Provide exactly one of vehicleId or trailerId.",
  });
export type HazmatCargoTankProfileCreateRequest = z.infer<typeof hazmatCargoTankProfileCreateSchema>;

// Equipment binding is immutable once set (it's the profile's identity); only capacity/compartments edit.
export const hazmatCargoTankProfileUpdateSchema = z
  .object({
    cargoCapacityGal: z.number().nonnegative().nullable().default(null),
    compartments: z.array(hazmatCompartmentSchema).default([]),
  })
  .strict();
export type HazmatCargoTankProfileUpdateRequest = z.infer<typeof hazmatCargoTankProfileUpdateSchema>;

export interface HazmatCargoTankProfileRow {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  cargo_capacity_gal: number | null;
  compartments: HazmatCompartment[];
  created_at: string;
  updated_at: string;
}
export interface HazmatCargoTankProfilesResponse {
  profiles: HazmatCargoTankProfileRow[];
}


// ── POST /hazmat/loads/:id/analyze — kicks off the in-process manual analysis (202 + runId) ─────
export interface HazmatAnalyzeResponse {
  runId: string;
}

// ── load + run read shapes (GET /hazmat/loads, /loads/:id, /loads/:id/runs) — plan H5 workspace ──
// Typed views of the DB rows (snake_case as returned by the service). The web app reads these; the
// verdict is the engine's Verdict (opaque here to keep @fuelguard/shared free of @hazmat/* deps).
export interface HazmatLoadRow {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  status: string;
  tank_state: string;
  carrier_relationship: string;
  planned_pickup_at: string | null;
  declared_lines: unknown[];
  bol_fields: unknown | null;
  special_permit_numbers: string[] | null;
  claimed_no_placards: boolean;
  supersedes_load_id: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HazmatRunQualFinding {
  /** e.g. `driver_unqualified:medical`, `org_unqualified:phmsa_registration`. */
  code: string;
  message: string;
  citation: string;
}
/** §5 qualification-gate evidence recorded on a run (M3). */
export interface HazmatRunQualification {
  evalDate: string;
  usedFallback: boolean;
  driver: HazmatRunQualFinding[];
  org: HazmatRunQualFinding[];
}

/** A non-blocking advisory recorded on a run (D3): an engine conditional/warning/info finding, or the
 *  §10.3 "qualification evaluated at analysis time" note. Rendered as reviewer decision-support. */
export interface HazmatRunAdvisory {
  ruleId: string;
  tier: string;
  message: string;
  citations?: unknown[];
}
/** Extraction evidence recorded on a photo run (D3): what the model read, both vision passes, and the
 *  cross-validation flags — the audit trail behind a photo verdict. Null on manual runs. */
export interface HazmatRunExtraction {
  usable: boolean;
  usabilityReasons: string[];
  passA: unknown | null;
  passB: unknown | null;
  engineLineCount: number;
  flags: string[];
  engineLines: unknown[];
}

export interface HazmatRunRow {
  id: string;
  load_id: string;
  engine_version: string;
  dataset_version: string;
  /** The engine Verdict (or `{ error }` when analysis threw). Opaque at the shared boundary. */
  verdict: unknown;
  outcome: "green" | "flagged";
  flags: string[];
  input_hash: string;
  created_at: string;
  /** §5 qualification-gate evidence (M3): driver/org findings with citations. Null on pre-gate runs. */
  qualification?: HazmatRunQualification | null;
  /** Non-blocking advisories (D3): conditional/warning/info findings + the §10.3 eval-at-now note. */
  advisories?: HazmatRunAdvisory[] | null;
  /** Extraction evidence (D3, photo runs only): usability, both vision passes, cross-validation flags. */
  extraction?: HazmatRunExtraction | null;
}

export interface HazmatLoadsListResponse {
  loads: HazmatLoadRow[];
  nextCursor: string | null;
}
export interface HazmatRunsResponse {
  runs: HazmatRunRow[];
}

// ── GET /hazmat/loads/:id/documents — signed download urls for review evidence (plan H7) ──────────
export interface HazmatDocumentRow {
  id: string;
  kind: string;
  page: number;
  contentType: string | null;
  /** Short-lived signed download url (null if signing failed). */
  url: string | null;
}
export interface HazmatDocumentsResponse {
  documents: HazmatDocumentRow[];
}

// ── POST /hazmat/loads/:id/review — reviewer field action (the clear itself is POST /clear) ─────
export const hazmatReviewActionSchema = z.enum(["field_confirmed", "field_corrected", "cant_read", "rejected", "override"]);
export const hazmatReviewRequestSchema = z.object({
  runId: z.string().uuid(),
  action: hazmatReviewActionSchema,
  fieldPath: z.string().optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
});
export type HazmatReviewRequest = z.infer<typeof hazmatReviewRequestSchema>;

// ── POST /hazmat/loads/:id/clear — the server enforces the full clearing gate (provisional block,
// unusable-read block, SP attestation, override reason) via checkHazmatClear AND composes the stored
// attestation itself via buildHazmatAttestation (D4) — a client-authored attestation string is never
// stored. `attestation` is accepted for backward compatibility and ignored server-side.
export const hazmatClearRequestSchema = z.object({
  runId: z.string().uuid(),
  /** Deprecated (D4): ignored — the server composes the attestation from the verified gate result. */
  attestation: z.string().optional(),
  overrideReason: z.string().nullable().default(null),
  spAcknowledged: z.boolean().default(false),
});
export type HazmatClearRequest = z.infer<typeof hazmatClearRequestSchema>;
