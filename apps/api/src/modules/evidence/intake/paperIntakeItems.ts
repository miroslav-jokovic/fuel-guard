import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPLIANCE_DOCUMENT_KINDS,
  compliancePaperBatchSchema,
  fetchAllPaged,
  parsePrintedDate,
  proposeFileSubject,
  type CompliancePaper,
  type DriverCandidate,
} from "@silvicom/shared";
import { readOfBytes } from "../../document-reading/index.js";

/**
 * A stack's pieces, read, become review rows (DRIVER-PAPER-INTAKE-PLAN PI3). THE FILE THAT WRITES
 * `file_intake_items` (0505) from paper intake.
 *
 * ── WHEN ─────────────────────────────────────────────────────────────────────────────────────────
 * Each piece was handed to the reader when the stack was split (`intakeStoredBytes`, profile
 * `compliance_paper`), and is found again by its bytes (`readOfBytes`). The review page asks for its
 * batch every few seconds while pieces are being read; each ask turns every piece whose read has
 * FINISHED into rows, once. "Once" is 0573's unique index: two tabs asking at the same moment insert one
 * set, and the second insert's conflict is the answer, not an error.
 *
 * ── NO PAGE IS LOST ──────────────────────────────────────────────────────────────────────────────
 * Every page of every piece ends up in exactly one row:
 *   - each paper the reader found is a row over its pages, clamped to the piece;
 *   - pages no paper covers become a row of their own, with no proposal — "the reader did not place
 *     these";
 *   - a piece whose read FAILED becomes one row over all its pages, with no proposal.
 * A row with no proposal is a person's to classify; it is never dropped, because the paper is the
 * thing that cannot be got back.
 *
 * ── WHOSE ────────────────────────────────────────────────────────────────────────────────────────
 * A piece cut after a driver's cover sheet is that driver's (`scope`, basis `scope`) — the sheet is the
 * office's word, not a guess. A piece with no sheet asks the matcher (`proposeFileSubject`) with the
 * licence number and name the reader printed; two equal candidates propose nobody (UF7b1).
 *
 * ── DATES ────────────────────────────────────────────────────────────────────────────────────────
 * Read as printed, parsed here (`parsePrintedDate`, month first). For a dated record (a test, a review)
 * `proposed_issued_on` carries the day it HAPPENED — the record's `occurred_on` when PI5 files it; the
 * table has no separate column and the meaning per kind is the catalogue's.
 */

const PROFILE = "compliance_paper" as const;
const KINDS = new Set<string>(COMPLIANCE_DOCUMENT_KINDS);

interface PartRow {
  part_index: number;
  driver_id: string | null;
  stack_pages: number[];
  sha256: string;
}

export interface StackReading {
  done: number;
  pending: number;
  failed: number;
}

type ItemRow = Record<string, unknown>;

/** Clamp a paper's printed page range to the piece; a range the reader got backwards is put right. */
function rangeOf(p: CompliancePaper, pageCount: number): [number, number] {
  const clamp = (n: number | null, fallback: number) => Math.min(Math.max(n ?? fallback, 1), pageCount);
  const from = clamp(p.pageFrom, 1);
  const to = clamp(p.pageTo, p.pageFrom ?? pageCount);
  return from <= to ? [from, to] : [to, from];
}

/** Runs of pages in 1..pageCount that are not in `covered`. */
function uncoveredRuns(covered: ReadonlySet<number>, pageCount: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let page = 1; page <= pageCount; page++) {
    if (covered.has(page)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === page - 1) last[1] = page;
    else runs.push([page, page]);
  }
  return runs;
}

export function itemsForPiece(
  base: { orgId: string; batchId: string; sourceId: string; part: PartRow },
  papers: readonly CompliancePaper[] | null,
  roster: readonly DriverCandidate[],
): ItemRow[] {
  const pageCount = base.part.stack_pages.length;
  const scope = base.part.driver_id ? { type: "driver" as const, id: base.part.driver_id } : null;
  const row = (from: number, to: number, paper: CompliancePaper | null): ItemRow => {
    const proposal = scope
      ? { subject: scope, basis: "scope" as const }
      : paper
        ? proposeFileSubject(
            { vins: [], plates: [], unitNumbers: [], cdlNumber: paper.licenseNumber, driverName: paper.driverName, filename: null },
            { units: [], drivers: roster },
          )
        : { subject: null, basis: null };
    return {
      org_id: base.orgId,
      batch_id: base.batchId,
      source_id: base.sourceId,
      page_from: from,
      page_to: to,
      scope_subject_type: scope ? "driver" : null,
      scope_subject_id: scope?.id ?? null,
      proposed_subject_type: proposal.subject ? "driver" : null,
      proposed_subject_id: proposal.subject?.id ?? null,
      proposed_kind: paper?.kind && KINDS.has(paper.kind) && paper.kind !== "other" ? paper.kind : null,
      proposed_issued_on: parsePrintedDate(paper?.issuedOn),
      proposed_expires_on: parsePrintedDate(paper?.expiresOn),
      read_identifiers: paper
        ? { title: paper.title, issuer: paper.issuer, driverName: paper.driverName, licenseNumber: paper.licenseNumber, issuedOn: paper.issuedOn, expiresOn: paper.expiresOn }
        : { unread: true },
      match_basis: proposal.subject ? proposal.basis : null,
    };
  };

  if (!papers) return [row(1, pageCount, null)];
  const rows: ItemRow[] = [];
  const covered = new Set<number>();
  for (const paper of papers) {
    const [from, to] = rangeOf(paper, pageCount);
    // A page claimed by an earlier paper stays with it: one page, one row.
    const free = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((p) => !covered.has(p));
    if (!free.length) continue;
    for (const p of free) covered.add(p);
    rows.push(row(free[0]!, free[free.length - 1]!, paper));
  }
  for (const [from, to] of uncoveredRuns(covered, pageCount)) rows.push(row(from, to, null));
  return rows.sort((a, b) => (a.page_from as number) - (b.page_from as number));
}

async function rosterOf(admin: SupabaseClient, orgId: string): Promise<DriverCandidate[]> {
  const rows = await fetchAllPaged<{ id: string; full_name: string; cdl_number: string | null }>((from, to) =>
    admin.from("drivers").select("id, full_name, cdl_number").eq("org_id", orgId).order("id").range(from, to),
  );
  return rows.map((d) => ({ id: d.id, fullName: d.full_name, cdlNumber: d.cdl_number }));
}

/** Turn every finished read of this stack's pieces into review rows, once. Returns where its reading stands. */
export async function syncStackItems(admin: SupabaseClient, orgId: string, stack: { id: string; batchId: string }): Promise<StackReading> {
  const parts = await admin
    .from("paper_intake_parts")
    .select("part_index, driver_id, stack_pages, sha256")
    .eq("org_id", orgId)
    .eq("stack_id", stack.id)
    .order("part_index");
  if (parts.error) throw new Error(`paper_intake_parts: ${parts.error.message}`);
  const reading: StackReading = { done: 0, pending: 0, failed: 0 };
  let roster: DriverCandidate[] | null = null;

  for (const part of (parts.data ?? []) as PartRow[]) {
    const read = await readOfBytes(admin, orgId, part.sha256, PROFILE);
    if (read.status === "done") reading.done += 1;
    else if (read.status === "failed") reading.failed += 1;
    else {
      reading.pending += 1;
      continue;
    }
    const sourceId = read.sourceId;
    const existing = await admin.from("file_intake_items").select("id").eq("org_id", orgId).eq("source_id", sourceId).limit(1);
    if (existing.error) throw new Error(`file_intake_items: ${existing.error.message}`);
    if ((existing.data ?? []).length) continue;

    const parsed = read.status === "done" ? compliancePaperBatchSchema.safeParse(read.result) : null;
    const papers = parsed?.success ? parsed.data.papers : null;
    if (!part.driver_id && papers?.length) roster ??= await rosterOf(admin, orgId);
    const rows = itemsForPiece({ orgId, batchId: stack.batchId, sourceId, part }, papers, roster ?? []);
    const ins = await admin.from("file_intake_items").insert(rows);
    // 0573's index: another request turned this piece into rows a moment ago — the answer we wanted.
    if (ins.error && ins.error.code !== "23505") throw new Error(`file_intake_items: ${ins.error.message}`);
  }
  return reading;
}
