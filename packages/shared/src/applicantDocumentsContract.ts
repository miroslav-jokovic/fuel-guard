import { z } from "zod";
import {
  APPLICATION_CAPTURE_DOCUMENT_KIND,
  APPLICATION_CAPTURE_PAGE,
  APPLICATION_CAPTURE_REQUESTED,
  type ApplicationCaptureSlot,
  type PromotedCaptureSlot,
} from "./applicationCaptureContract.js";
import { DOCUMENT_CONTENT_TYPES, type DocumentKind } from "./complianceContract.js";
import { recordId } from "./recordId.js";

/**
 * The applicant's papers on their record, and the office's upload beside them (HIRING-WORKFLOW-AUDIT
 * -2026-10-31 §3.5/§4.7, §9 P9).
 *
 * ── ONE LIST FOR BOTH SIDES ──────────────────────────────────────────────────────────────────
 * The office offers exactly what the applicant's "Your documents" list offers — `APPLICATION_CAPTURE_
 * REQUESTED`, by slot — and a slot becomes a `documents.kind` and page through the SAME table a
 * promoted capture uses (`APPLICATION_CAPTURE_DOCUMENT_KIND`/`_PAGE`). So "the office uploads a TWIC"
 * and "the applicant sends a TWIC" file the same row shape, and a fourth paper added to the
 * applicant's list is offered to the office by that one edit.
 *
 * ── WHY THE REQUEST NAMES A SLOT AND NEVER A KIND ─────────────────────────────────────────────
 * The door is `/api/recruitment/*`, because a recruiter is `roster: view` and every `/api/compliance`
 * write refuses them (memory: a recruiter cannot write the roster section; `hiringEvidence.ts` and
 * `pspImport.ts` are the precedents). A door onto an evidence table that took a caller's `kind` would
 * let a drug-test result be filed as anything; the kind is composed server-side from this allow-list.
 */

/** What the office may file from the applicant's record — the applicant's own list. */
export const APPLICANT_DOCUMENT_SLOTS = APPLICATION_CAPTURE_REQUESTED as readonly PromotedCaptureSlot[];

/** The kind and page a slot files under — the promotion's table, read rather than restated. */
export const applicantDocumentKind = (slot: PromotedCaptureSlot): DocumentKind => APPLICATION_CAPTURE_DOCUMENT_KIND[slot];
export const applicantDocumentPage = (slot: PromotedCaptureSlot): number => APPLICATION_CAPTURE_PAGE[slot];

/** Every kind the list can produce — what the record's read shows from the driver's file. */
export const APPLICANT_DOCUMENT_KINDS: readonly DocumentKind[] = [...new Set(APPLICANT_DOCUMENT_SLOTS.map(applicantDocumentKind))];

/**
 * The slot a filed paper answers, from its kind and page — the inverse of the table above, so an
 * office upload of a licence's back reads "Back of your licence" as the applicant's own does. Null for
 * a kind the list does not produce.
 */
export function applicantDocumentSlot(kind: string, page: number): PromotedCaptureSlot | null {
  return APPLICANT_DOCUMENT_SLOTS.find((s) => applicantDocumentKind(s) === kind && applicantDocumentPage(s) === page)
    ?? APPLICANT_DOCUMENT_SLOTS.find((s) => applicantDocumentKind(s) === kind)
    ?? null;
}

/**
 * What the OFFICE calls each paper. The applicant's labels speak to the driver ("Front of your
 * licence"); the record speaks about them. Total over the promoted slots so a new paper on the list
 * cannot reach the record unnamed.
 */
export const APPLICANT_DOCUMENT_OFFICE_LABELS: Record<PromotedCaptureSlot, string> = {
  cdl_front: "Licence, front",
  cdl_back: "Licence, back",
  medical_card: "Medical examiner's certificate",
  twic: "TWIC card",
  passport: "Passport",
  work_authorization: "Green card or work permit",
  ssn_card: "Social Security card",
  hazmat_endorsement: "Hazmat endorsement",
  road_test_certificate: "Road test certificate (past job)",
  training_certificate: "Training certificate",
  other: "Other document",
  signature_mark: "Signature picture",
  initials_mark: "Initials picture",
};

/** `POST /api/recruitment/applicants/:driverId/documents` — register one paper; the browser PUTs it. */
export const applicantDocumentUploadSchema = z.object({
  /** Client-generated, as every document registration's is: a retried register is the same row. */
  document_id: recordId(),
  slot: z.enum(APPLICANT_DOCUMENT_SLOTS as unknown as [PromotedCaptureSlot, ...PromotedCaptureSlot[]]),
  content_type: z.enum(DOCUMENT_CONTENT_TYPES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "A sha256 is 64 hexadecimal characters"),
  bytes: z.number().int().positive().nullish(),
});
export type ApplicantDocumentUpload = z.infer<typeof applicantDocumentUploadSchema>;

/** One paper on the record: sent by the applicant (staged or filed) or added by the office. */
export interface ApplicantDocument {
  id: string;
  slot: ApplicationCaptureSlot | null;
  kind: string;
  contentType: string;
  /** When it reached us — the capture's time for the applicant's, the registration's for the office's. */
  at: string;
  /** `applicant`: from the link (staged, or filed at Part 1 / filing). `office`: uploaded here or in the file. */
  source: "applicant" | "office";
  /** The office member who added it, by name or email; null for the applicant's own. */
  addedBy: string | null;
  /** Still in the link's staging bucket — sent, and not yet filed with Part 1 or the application. */
  staged: boolean;
  /** A five-minute URL to the image or PDF. Null when it could not be signed — or is withheld below. */
  url: string | null;
  /** Q-WF4: the caller may see the row and not the picture (`canSeePaperImage`). */
  imageWithheld: boolean;
}

export interface ApplicantDocumentsResponse {
  documents: ApplicantDocument[];
}

/** `POST …/documents` — where to PUT the bytes, as every document registration answers. */
export interface ApplicantDocumentUploadResponse {
  documentId: string;
  storagePath: string;
  uploadUrl: string;
  token: string;
}
