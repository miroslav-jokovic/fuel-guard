import { z } from "zod";
import { isoDateSchema } from "./rosterContract.js";

/**
 * Driver-qualification export contract — `/api/compliance/exports/*` (DQ-BINDER-PLAN).
 *
 * Two shapes, one ledger. A **binder** is an auditor's named sample assembled into ONE PDF (D-BD2)
 * by a background job (D-BD3); a **document** export is a single requirement for a single driver,
 * stamped and streamed for the outward case — a broker asking for a CDL before releasing a load
 * (D-BD10). Both write a `dq_exports` row, because a record of who pulled a medical card out of the
 * system is the point (D-BD9).
 *
 * The names and numbers here are shared so the API that enforces them, the job that honours them and
 * the screen that explains them cannot drift onto three different answers.
 */

/** The private Storage bucket a finished binder lands in (migration 0152). Never client-readable. */
export const DQ_EXPORT_BUCKET = "compliance-exports";

/**
 * Sample ceiling. An auditor's sample is typically five to fifteen drivers; twenty-five is roughly
 * 450 scans and a file large enough that the cap is a kindness. Mirrored by the `dq_exports_sample_size`
 * check constraint, so a caller that forgets it is refused by the database rather than by nobody.
 */
export const DQ_EXPORT_MAX_DRIVERS = 25;

/** How long the BYTES live (D-BD4). The ledger row is permanent; the aggregate is not. */
export const DQ_EXPORT_TTL_DAYS = 7;

/** Signed-URL lifetime for a finished binder — long enough to download, short enough to not forward. */
export const DQ_EXPORT_URL_TTL_SECONDS = 300;

/** Storage key. folder[1] is the org, matching every other bucket's tenancy convention. */
export const dqExportStoragePath = (orgId: string, exportId: string): string =>
  `${orgId}/${exportId}.pdf`;

export const DQ_EXPORT_KINDS = ["binder", "document"] as const;
export const dqExportKindSchema = z.enum(DQ_EXPORT_KINDS);
export type DqExportKind = (typeof DQ_EXPORT_KINDS)[number];

export const DQ_EXPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export const dqExportStatusSchema = z.enum(DQ_EXPORT_STATUSES);
export type DqExportStatus = (typeof DQ_EXPORT_STATUSES)[number];

/**
 * `POST /api/compliance/exports/binder` — build a binder for a named sample.
 *
 * `asAt` is the whole point of D-BD7: the auditor asks for the file as it stood on the day of the
 * audit, and `buildDqFile` has always taken the evaluation date as a parameter. Omitted means today.
 */
export const binderRequestSchema = z.object({
  driverIds: z.array(z.uuid()).min(1).max(DQ_EXPORT_MAX_DRIVERS),
  asAt: isoDateSchema,
  /** Include §382.401/§391.53 restricted kinds (Phase G, D-DQ15). Privileged roles only — the API
   *  refuses it otherwise, and the ask is recorded on the export ledger row. */
  includeRestricted: z.boolean().optional(),
});
export type BinderRequest = z.infer<typeof binderRequestSchema>;

/**
 * `POST /api/compliance/exports/document` — one requirement, stamped, streamed.
 *
 * Keyed by the REQUIREMENT rather than the document id: the caller is answering "send me his medical
 * card", not "send me document 4f2a…". The server resolves which document currently proves that
 * requirement, which is also what makes the stamp truthful — it can state the validity dates because
 * it looked them up rather than being told them.
 */
export const documentExportRequestSchema = z.object({
  driverId: z.uuid(),
  requirementKey: z.string().min(1).max(64),
  asAt: isoDateSchema,
});
export type DocumentExportRequest = z.infer<typeof documentExportRequestSchema>;

/** A ledger row as the history list reads it. `storage_path` is deliberately not exposed. */
export interface DqExportRow {
  id: string;
  kind: DqExportKind;
  status: DqExportStatus;
  as_at: string;
  driver_ids: string[];
  /** Resolved names, so a six-month-old row still reads as people rather than uuids. */
  driver_names: string[];
  requirement_key: string | null;
  drivers_count: number | null;
  documents_count: number | null;
  gaps_count: number | null;
  pages: number | null;
  bytes: number | null;
  error: string | null;
  requested_by_email: string | null;
  created_at: string;
  completed_at: string | null;
  /** True once the seven-day sweep has removed the bytes — the row stays, the download does not. */
  purged: boolean;
  /** False when there is nothing to download: still building, failed, purged, or never stored. */
  downloadable: boolean;
}

export const dqExportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type DqExportListQuery = z.infer<typeof dqExportListQuerySchema>;
