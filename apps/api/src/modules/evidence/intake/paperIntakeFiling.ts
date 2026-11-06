import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  canReadRestrictedKind,
  paperFilePlan,
  type DocumentKind,
  type PaperDiscardRequest,
  type PaperFileRequest,
  type UserRole,
} from "@silvicom/shared";
import { readOfBytes } from "../../document-reading/index.js";
import { insertCertification, insertQualificationRecord } from "../compliance.js";
import { fileGeneratedDocument } from "../generatedDocuments.js";
import { PAPER_INTAKE_BUCKET } from "./paperIntake.js";

/**
 * Filing a reviewed paper into a driver's file (DRIVER-PAPER-INTAKE-PLAN PI5). THE FILE THAT DECIDES
 * `file_intake_items` rows (filed / discarded / duplicate).
 *
 * ── WHAT FILING WRITES, IN ORDER ────────────────────────────────────────────────────────────────
 * 1. The paper's pages, cut out of the ORIGINAL stack (never out of the re-encoded piece), as one PDF
 *    filed on the driver (`fileGeneratedDocument`) — the scan first, so the record can cite a document
 *    that exists (D-DQ10).
 * 2. Then, by `paperFilePlan`: a certification (CDL, medical card) through the supersede chain, or a dated
 *    qualification record with `detail.source = "paper_intake"`, or nothing more for an `other` paper.
 * 3. The row: `filed`, who and when, the document and certification ids, and `changed` — whether the
 *    person altered anything the reader proposed (D-UF8's measurement, the only evidence that would ever
 *    justify filing without review).
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────────────────────────
 * The document, the certification and the record all take the ROW's id, so a request retried after a
 * dropped response files onto the same three rows instead of filing the paper twice. An evidence table
 * is append-only; a second copy of a paper would be a correction nobody asked for.
 *
 * ── WHO MAY ──────────────────────────────────────────────────────────────────────────────────────
 * The route asks `roster: manage`. A restricted paper (a drug or alcohol test, a Clearinghouse query)
 * is filed only by a role that may read it (`canReadRestrictedKind`, D-DQ15) — the same rule the
 * qualification-record door applies, so intake is not a way around it.
 */

export type FilingError = { code: "not_found" | "already_decided" | "refused" | "forbidden" | "piece_missing" | "failed"; error: string };
const fail = (code: FilingError["code"], error: string): FilingError => ({ code, error });

interface ItemRow {
  id: string;
  batch_id: string;
  source_id: string;
  page_from: number;
  page_to: number;
  status: string;
  proposed_subject_id: string | null;
  proposed_kind: string | null;
  proposed_issued_on: string | null;
  proposed_expires_on: string | null;
}

async function loadPending(admin: SupabaseClient, orgId: string, itemId: string): Promise<ItemRow | FilingError> {
  const { data, error } = await admin
    .from("file_intake_items")
    .select("id, batch_id, source_id, page_from, page_to, status, proposed_subject_id, proposed_kind, proposed_issued_on, proposed_expires_on")
    .eq("org_id", orgId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) return fail("failed", error.message);
  if (!data) return fail("not_found", "That paper is not in this upload.");
  const row = data as ItemRow;
  if (row.status !== "pending") return fail("already_decided", "That paper has already been filed or set aside.");
  return row;
}

/** The piece a row was read from, and the stack it was cut from, found through the reader's source (PI3). */
async function pieceOf(admin: SupabaseClient, orgId: string, item: ItemRow): Promise<{ stackId: string; stackPages: number[] } | null> {
  const stacks = await admin.from("paper_intake_stacks").select("id").eq("org_id", orgId).eq("batch_id", item.batch_id);
  if (stacks.error) throw new Error(`paper_intake_stacks: ${stacks.error.message}`);
  const ids = ((stacks.data ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (!ids.length) return null;
  const parts = await admin.from("paper_intake_parts").select("stack_id, stack_pages, sha256").eq("org_id", orgId).in("stack_id", ids);
  if (parts.error) throw new Error(`paper_intake_parts: ${parts.error.message}`);
  for (const p of (parts.data ?? []) as Array<{ stack_id: string; stack_pages: number[]; sha256: string }>) {
    const read = await readOfBytes(admin, orgId, p.sha256, "compliance_paper");
    if ("sourceId" in read && read.sourceId === item.source_id) return { stackId: p.stack_id, stackPages: p.stack_pages };
  }
  return null;
}

/** The paper's own pages of the original scan, as one PDF. */
async function cutPages(admin: SupabaseClient, orgId: string, stackId: string, pages: number[]): Promise<Buffer> {
  const download = await admin.storage.from(PAPER_INTAKE_BUCKET).download(`${orgId}/${stackId}/stack.pdf`);
  if (download.error || !download.data) throw new Error("The original scan could not be read back.");
  const source = await PDFDocument.load(Buffer.from(await download.data.arrayBuffer()), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, pages.map((n) => n - 1))) out.addPage(page);
  return Buffer.from(await out.save());
}

export type FilingOutcome = { status: "filed"; documentId: string; certificationId: string | null; recordId: string | null } | { status: "duplicate"; documentId: string };

export async function fileIntakeItem(
  admin: SupabaseClient,
  orgId: string,
  user: { id: string; role: UserRole | null },
  itemId: string,
  req: PaperFileRequest,
  now: () => Date = () => new Date(),
): Promise<FilingOutcome | FilingError> {
  const item = await loadPending(admin, orgId, itemId);
  if ("code" in item) return item;

  const driver = await admin.from("drivers").select("id, status").eq("org_id", orgId).eq("id", req.driverId).maybeSingle();
  if (driver.error) return fail("failed", driver.error.message);
  if (!driver.data) return fail("refused", "That driver is not on this roster.");
  const plan = paperFilePlan(req, driver.data as { status: string });
  if (!plan.ok) return fail("refused", plan.message);
  if (!canReadRestrictedKind(req.kind, user.role)) return fail("forbidden", "Only a role that may read testing records can file this paper.");

  const piece = await pieceOf(admin, orgId, item);
  if (!piece) return fail("piece_missing", "The scan this paper came from could not be found.");
  const pages = piece.stackPages.slice(item.page_from - 1, item.page_to);
  const pdf = await cutPages(admin, orgId, piece.stackId, pages);
  const decidedAt = now().toISOString();

  // The same paper already in this driver's file — a folder scanned twice. Nothing is written but the row.
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const dup = await admin.from("documents").select("id").eq("org_id", orgId).eq("subject_type", "driver").eq("subject_id", req.driverId).eq("sha256", sha256).neq("id", item.id).limit(1);
  if (dup.error) return fail("failed", dup.error.message);
  const existing = ((dup.data ?? []) as Array<{ id: string }>)[0];
  if (existing) {
    await decide(admin, orgId, item.id, { status: "duplicate", decided_at: decidedAt });
    return { status: "duplicate", documentId: existing.id };
  }

  const doc = await fileGeneratedDocument(admin, orgId, {
    id: item.id,
    subjectType: "driver",
    subjectId: req.driverId,
    kind: req.kind as DocumentKind,
    uploadedBy: user.id,
  }, pdf);
  if ("code" in doc) return fail("failed", doc.error);

  let certificationId: string | null = null;
  let recordId: string | null = null;
  if (plan.path === "certification") {
    const cert = await insertCertification(admin, orgId, user.id, {
      id: item.id,
      subjectType: "driver",
      subjectId: req.driverId,
      kind: req.kind as "cdl" | "medical_card",
      issuedAt: req.date,
      expiresAt: req.expiresOn,
      documentId: doc.documentId,
      notes: "Filed from a scanned paper file.",
    });
    if ("code" in cert && !/duplicate key/i.test(cert.error)) return fail("failed", cert.error);
    certificationId = item.id;
  } else if (plan.path === "record") {
    const rec = await insertQualificationRecord(admin, orgId, user.id, {
      id: item.id,
      driverId: req.driverId,
      kind: req.kind as Parameters<typeof insertQualificationRecord>[3]["kind"],
      occurredOn: req.date!,
      documentId: doc.documentId,
      detail: { source: "paper_intake", intake_item_id: item.id, stack_id: piece.stackId, stack_pages: pages },
    });
    if ("code" in rec && rec.code !== "duplicate") return fail("failed", rec.error);
    recordId = item.id;
  }

  const changed =
    req.driverId !== item.proposed_subject_id ||
    req.kind !== item.proposed_kind ||
    (req.date ?? null) !== (item.proposed_issued_on ?? null) ||
    (req.expiresOn ?? null) !== (item.proposed_expires_on ?? null);
  await decide(admin, orgId, item.id, {
    status: "filed",
    decided_by: user.id,
    decided_at: decidedAt,
    changed,
    filed_document_id: doc.documentId,
    filed_certification_ids: certificationId ? [certificationId] : [],
  });
  return { status: "filed", documentId: doc.documentId, certificationId, recordId };
}

export async function discardIntakeItem(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  itemId: string,
  _req: PaperDiscardRequest,
  now: () => Date = () => new Date(),
): Promise<{ status: "discarded" } | FilingError> {
  const item = await loadPending(admin, orgId, itemId);
  if ("code" in item) return item;
  // Setting a page aside changes no proposal: `changed` records whether a FILED paper was altered.
  await decide(admin, orgId, item.id, { status: "discarded", decided_by: userId, decided_at: now().toISOString(), changed: false });
  return { status: "discarded" };
}

async function decide(admin: SupabaseClient, orgId: string, itemId: string, patch: Record<string, unknown>): Promise<void> {
  // Only a pending row is decided: a second click, or two reviewers at once, finds it already done.
  const { error } = await admin.from("file_intake_items").update(patch).eq("org_id", orgId).eq("id", itemId).eq("status", "pending");
  if (error) throw new Error(`file_intake_items: ${error.message}`);
}
