import { z } from "zod";
import { INTAKE_LIMITS } from "./documentReadingContract.js";
import { recordId } from "./recordId.js";

/**
 * Scanned stacks of paper driver files (DRIVER-PAPER-INTAKE-PLAN PI2; tables 0572). The office uploads
 * one PDF of several folders, each under its cover sheet (PI1); the worker cuts it into pieces of one
 * driver's pages that the reader (PI3) can take.
 */

/** The bucket's cap (0572), which is the project's per-file upload limit; a larger number could never be used. */
export const PAPER_STACK_MAX_BYTES = 50 * 1024 * 1024;
/**
 * Pages in one stack. A Brother feeder at 300 dpi grayscale saves roughly 100–200 KB a page, so 50 MB
 * is ~250–500 pages; 600 is a sanity ceiling on a file that claims more (a corrupt page tree), not the
 * working limit — that is the byte cap.
 */
export const PAPER_STACK_MAX_PAGES = 600;
/** A piece is at most what the document reader takes in one read (`INTAKE_LIMITS.maxPages`), read rather than restated. */
export const PAPER_PART_MAX_PAGES = INTAKE_LIMITS.maxPages;

export const PAPER_STACK_STATUSES = ["uploading", "queued", "splitting", "split", "failed"] as const;
export type PaperStackStatus = (typeof PAPER_STACK_STATUSES)[number];

/** Why a stack could not be split, in the office's words — the API stores the code, the page shows these. */
export const PAPER_STACK_FAILURES = {
  not_uploaded: "The file never finished uploading. Upload it again.",
  bytes_changed: "The uploaded file does not match what was sent. Upload it again.",
  encrypted_pdf: "The PDF is password-protected. Save it from the scanner without a password.",
  decode_failed: "The file could not be opened as a PDF. Save it from the scanner as a PDF and upload it again.",
  too_many_pages: `The file has more than ${PAPER_STACK_MAX_PAGES} pages. Scan fewer folders at a time.`,
} as const;
export type PaperStackFailure = keyof typeof PAPER_STACK_FAILURES;

export const paperStackRegisterSchema = z.object({
  batchId: recordId(),
  fileName: z.string().trim().min(1).max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive().max(PAPER_STACK_MAX_BYTES),
});
export type PaperStackRegisterRequest = z.infer<typeof paperStackRegisterSchema>;

export interface PaperStackRegisterResponse {
  stackId: string;
  /** Null when the org already uploaded these exact bytes: nothing to send, `duplicate` is true. */
  uploadUrl: string | null;
  /** What `storage.uploadToSignedUrl(path, token, file)` takes in the browser — null with `uploadUrl`. */
  storagePath: string | null;
  token: string | null;
  duplicate: boolean;
}

/**
 * One review row of a batch (PI4): a paper the reader found in one piece, or pages it could not place.
 * `pages` are the STACK's page numbers — what the person sees on the scan they made.
 */
export interface PaperIntakeItemDto {
  id: string;
  stackId: string;
  partIndex: number;
  pages: number[];
  /** Pages within the piece's own PDF, for its preview. */
  pieceFrom: number;
  pieceTo: number;
  driverId: string | null;
  driverName: string | null;
  /** `scope` = under that driver's cover sheet; `cdl` / `name` = proposed by the matcher; null = nobody. */
  basis: string | null;
  kind: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  /** The paper's own printed heading, as the reader transcribed it. */
  title: string | null;
  /** True when the reader could not read the piece at all: the row is the whole piece, unclassified. */
  unread: boolean;
  status: "pending" | "filed" | "discarded" | "duplicate";
}

export interface PaperBatchResponse {
  stacks: PaperStackDto[];
  items: PaperIntakeItemDto[];
}

export interface PaperStackPartDto {
  partIndex: number;
  driverId: string | null;
  /** The driver's name now, or null — none on the sheet, or a driver no longer on file. */
  driverName: string | null;
  basis: "cover_sheet" | "none";
  stackPages: number[];
}

export interface PaperStackDto {
  id: string;
  batchId: string;
  fileName: string;
  status: PaperStackStatus;
  failure: string | null;
  pageCount: number | null;
  coverSheetCount: number | null;
  blankPageCount: number | null;
  createdAt: string;
  /** Once split: how many of its pieces the reader has finished, is still on, or could not read (PI3). */
  reading: { done: number; pending: number; failed: number } | null;
  parts: PaperStackPartDto[];
}

// ── the planner: which pages go to whom, in pieces the reader takes ──────────────────────────────────

export interface PlannedPart {
  driverId: string | null;
  basis: "cover_sheet" | "none";
  /** 1-based stack page numbers, ascending, at most `PAPER_PART_MAX_PAGES`. */
  pages: number[];
}

/**
 * Cut a stack of `pageCount` pages into pieces. Pure, so every rule is pinned by a test rather than by a
 * scanned file:
 * - a cover sheet starts a driver; its own page is never part of anything;
 * - pages before the first sheet (or in a stack with none) belong to nobody yet (`basis: "none"`);
 * - blank pages are left out wherever they fall — a duplex scan's backs;
 * - a driver's pages are cut into consecutive pieces of at most `maxPages`;
 * - two sheets for the same driver in one stack are two runs, not merged — the office scanned that
 *   folder twice, and review should see both.
 * A sheet with nothing after it before the next sheet yields no piece: a folder with no papers.
 */
export function planParts(
  pageCount: number,
  sheets: ReadonlyArray<{ page: number; driverId: string }>,
  blankPages: ReadonlySet<number>,
  maxPages: number = PAPER_PART_MAX_PAGES,
): PlannedPart[] {
  const sheetAt = new Map(sheets.map((s) => [s.page, s.driverId]));
  const runs: Array<{ driverId: string | null; pages: number[] }> = [{ driverId: null, pages: [] }];
  for (let page = 1; page <= pageCount; page++) {
    const driverId = sheetAt.get(page);
    if (driverId) runs.push({ driverId, pages: [] });
    else if (!blankPages.has(page)) runs[runs.length - 1]!.pages.push(page);
  }
  const parts: PlannedPart[] = [];
  for (const run of runs) {
    for (let i = 0; i < run.pages.length; i += maxPages) {
      parts.push({ driverId: run.driverId, basis: run.driverId ? "cover_sheet" : "none", pages: run.pages.slice(i, i + maxPages) });
    }
  }
  return parts;
}

/**
 * Is a scanned page blank — the fraction of its pixels darker than mid-grey, against a threshold.
 *
 * Measured, not guessed (2026-11-06, letter pages painted at the scan's 150 dpi, 2,103,750 pixels; pinned
 * by "drops blank duplex backs and keeps a page with a single short line or a lone signature" in
 * apps/api's findCoverSheets.test.ts):
 *   empty back 0 % · four dust specks 0.0007 % · a lone "Page 3" at 10 pt 0.014 % · a single signature
 *   0.046 % · one line of 14-pt text 0.12 % · a full page of text 8 %.
 * The first guess here, 0.15 %, would have dropped the signature, the short line AND the one-line page —
 * the exact failure this must never have. 0.004 % sits below every mark and above the specks.
 * A duplex back's bleed-through is light grey, above the 128 cut, so it does not count. When in doubt
 * the page is KEPT: a blank page in review costs a click, a dropped page costs a paper. The office
 * trial (PI6) measures real scanner noise against this number.
 */
export const BLANK_PAGE_DARK_FRACTION = 0.00004;
export function isBlankPage(grey: Uint8Array, darkBelow = 128): boolean {
  let dark = 0;
  for (let i = 0; i < grey.length; i++) if (grey[i]! < darkBelow) dark++;
  return grey.length > 0 && dark / grey.length < BLANK_PAGE_DARK_FRACTION;
}

// ── filing (PI5): what a reviewed paper becomes ──────────────────────────────────────────────────────

/** A paper filed from intake: the reviewer's word on whose it is, what it is, and its dates. */
export const paperFileRequestSchema = z.object({
  driverId: recordId("Choose the driver this paper belongs to"),
  kind: z.string().trim().min(1, "Say which paper this is").max(80),
  /** The day it was issued, or the day the thing it records happened (a test, a review). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});
export type PaperFileRequest = z.infer<typeof paperFileRequestSchema>;

export const paperDiscardRequestSchema = z.object({ reason: z.enum(["not_dq_paper", "duplicate_page", "unreadable", "other"]) });
export type PaperDiscardRequest = z.infer<typeof paperDiscardRequestSchema>;

/**
 * The kinds a paper filed from intake may be, and what each writes (DRIVER-PAPER-INTAKE-PLAN PI5).
 *   certification — CDL, medical card: dated by expiry (or issue), the supersede chain decides "current".
 *   record        — the dated §391.51 events, `occurred_on` = the paper's date, `detail.source = "paper_intake"`.
 *   document      — `other`: kept on the driver's file as a paper, proving no requirement.
 * Every one files the scan first (D-DQ10); a record or certification always cites it.
 */
export const PAPER_FILE_CERTIFICATION_KINDS = ["cdl", "medical_card"] as const;
export const PAPER_FILE_RECORD_KINDS = [
  "employment_application", "mvr", "annual_mvr_review", "road_test", "cdl_equivalency",
  "previous_employer_inquiry", "previous_employer_response", "clearinghouse_full", "clearinghouse_limited",
  "eldt", "medical_registry_verification", "drug_test", "alcohol_test",
] as const;
export const PAPER_FILE_KINDS = [...PAPER_FILE_CERTIFICATION_KINDS, ...PAPER_FILE_RECORD_KINDS, "other"] as const;

/**
 * The two papers only the hiring ceremony may write for an APPLICANT (`CEREMONY_OWNED_KINDS`, A-9), which
 * Q-PI3 (a) lets intake file for a driver already HIRED: the signed paper of a driver hired years ago is
 * the evidence §391.21 and §391.31 ask for, and nothing else could ever file it.
 */
export const PAPER_FILE_HIRED_ONLY_KINDS = ["employment_application", "road_test"] as const;

/**
 * Why a kind is NOT fileable from intake, said where the reviewer will act on it — each of these has its
 * own path in the driver's file, and intake must not become a second door to it.
 */
export const PAPER_FILE_ELSEWHERE: Readonly<Record<string, string>> = {
  psp_report: "File a PSP report from the driver's Employment tab, which records where it came from.",
  handbook: "The handbook is signed on the applicant's link; a scanned one can be kept as an other paper.",
  endorsement: "Record an endorsement from the driver's qualification file, where its letter is chosen.",
  hazmat_training: "Record hazmat training from the driver's qualification file, which asks for its provider.",
  return_to_duty: "Record return-to-duty paperwork from the driver's qualification file.",
};

export type PaperFilePath = "certification" | "record" | "document";

export function paperFilePlan(
  req: Pick<PaperFileRequest, "kind" | "date" | "expiresOn">,
  driver: { status: string },
): { ok: true; path: PaperFilePath } | { ok: false; message: string } {
  const kind = req.kind;
  if (kind in PAPER_FILE_ELSEWHERE) return { ok: false, message: PAPER_FILE_ELSEWHERE[kind]! };
  if (!(PAPER_FILE_KINDS as readonly string[]).includes(kind)) return { ok: false, message: "That is not a paper a driver's file holds. Keep it as an other paper, or discard it." };
  if (kind === "other") return { ok: true, path: "document" };
  if ((PAPER_FILE_HIRED_ONLY_KINDS as readonly string[]).includes(kind) && driver.status === "applicant") {
    return { ok: false, message: "An applicant's application and road test are filed by their own signing steps, not from a scan." };
  }
  if ((PAPER_FILE_CERTIFICATION_KINDS as readonly string[]).includes(kind)) {
    return req.expiresOn || req.date ? { ok: true, path: "certification" } : { ok: false, message: "Enter the expiry date printed on it." };
  }
  return req.date ? { ok: true, path: "record" } : { ok: false, message: "Enter the date printed on it — the day it was signed or the thing happened." };
}
