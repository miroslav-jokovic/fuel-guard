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
  verdict: unknown;
}

// ── role sets ─────────────────────────────────────────────────────────────────
// The `hazmat` SECTION (auth.ts) gates general management (loads CRUD, documents). Clearing + review is
// TIGHTER — separation of duties (D6): dispatchers create loads, they do NOT clear them.
export const HAZMAT_REVIEW_ROLES: readonly UserRole[] = ["admin", "fleet_manager", "safety_manager"];

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
export const hazmatPolicyPutRequestSchema = z.object({ policy: z.record(z.string(), z.unknown()) });
export type HazmatPolicyPutRequest = z.infer<typeof hazmatPolicyPutRequestSchema>;


// ── POST /hazmat/loads/:id/analyze — kicks off the in-process manual analysis (202 + runId) ─────
export interface HazmatAnalyzeResponse {
  runId: string;
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

// ── POST /hazmat/loads/:id/clear — named attestation required; refused on a provisional dataset ─
export const hazmatClearRequestSchema = z.object({
  runId: z.string().uuid(),
  attestation: z.string().min(1),
});
export type HazmatClearRequest = z.infer<typeof hazmatClearRequestSchema>;
