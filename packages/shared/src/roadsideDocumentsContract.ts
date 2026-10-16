import { z } from "zod";
import { documentRegisterSchema, type RoadsideDocumentKind } from "./complianceContract.js";

/**
 * An inspection's paper — `GET`/`POST /api/roadside-inspections/:id/documents` (INSPECTION-CHALLENGE-PLAN
 * IC2, migration 0476). The table, bucket, hashing and signed-URL shape are `documents`' (0146); this
 * file says only what the `safety` section's route accepts on top of them (D-IC12).
 *
 * ── A DOCUMENT IS THE INSPECTION'S, NOT ONE VIOLATION'S ────────────────────────────────────────
 * Measured on production 2026-10-15: of 155 inspections with a citation number, 12 carry it on more
 * than one violation and 5 have two different tickets. So which violation a court result answers is
 * recorded by IC4's disposition record citing the document, never by the upload.
 */

/**
 * What a person uploads. The two DataQs kinds of 0476 are left out: IC4's filing writes the packet
 * itself and records the correspondence with the request it answers, so neither is a free upload.
 */
export const ROADSIDE_UPLOAD_KINDS = ["citation", "court_disposition", "roadside_inspection_report"] as const satisfies readonly RoadsideDocumentKind[];
export type RoadsideUploadKind = (typeof ROADSIDE_UPLOAD_KINDS)[number];

/** Every kind's name on the page — all six, since a filed DataQs packet will be listed with the rest. */
export const ROADSIDE_DOCUMENT_KIND_TEXT: Record<RoadsideDocumentKind, string> = {
  citation: "Citation (ticket)",
  court_disposition: "Court result",
  roadside_inspection_report: "Officer's inspection report",
  dataqs_packet: "DataQs packet",
  dataqs_correspondence: "DataQs correspondence",
  roadside_repair_record: "Repair record (from FleetPal)",
};

/**
 * `POST /api/roadside-inspections/:id/documents`. The compliance register's own fields, derived rather
 * than restated: the subject comes from the path, a file is always page 1 of an original (a multi-page
 * ticket is one PDF), and the kind is one of the three above.
 */
export const roadsideDocumentRegisterSchema = documentRegisterSchema
  .omit({ subjectType: true, subjectId: true, kind: true, page: true, variant: true })
  .extend({ kind: z.enum(ROADSIDE_UPLOAD_KINDS) });
export type RoadsideDocumentRegisterRequest = z.infer<typeof roadsideDocumentRegisterSchema>;
