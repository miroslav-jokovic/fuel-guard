import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementWord } from "@silvicom/shared";
import type { FolderMessage, GraphFolderReader } from "../../lib/graphFolder.js";
import type { PdfWordsOutcome } from "../../lib/pdfWords.js";
import type { StatementIngestResult } from "./fuelStatementIngest.js";

/**
 * Pilot weekly bill emails → a recorded statement and its invoice check, without a person
 * (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4, step 3).
 *
 * The owner moves Pilot's weekly bill into miki@'s `Pilot-Bills` folder with an Outlook rule, PDF attached
 * (ruled 2026-11-24). Each run lists the folder's last two weeks and, for every email not yet settled in
 * `pilot_bill_mails` (0643), reads each PDF attachment ON THE SERVER (`readPdfWords` — the same pdf.js decode
 * and the same `splitTextRun` as the browser's upload), records it through `ingestFuelStatement`, and runs the
 * invoice check through `runFuelReconciliation`. Both are the functions the Pilot invoices upload calls, so an
 * emailed bill and an uploaded one cannot be recorded or checked differently. The mailbox is never changed.
 *
 * ── WHY THE SAME BILL IS NOT RECORDED TWICE ──────────────────────────────────────────────────────────
 * Measured 2026-11-17: a bill arrives forwarded by more than one person with identical PDF bytes. So a PDF whose
 * SHA-256 is already a live statement — from an earlier email or a manual upload — settles as `duplicate` and
 * points at that statement. A CORRECTED bill is different bytes under the same invoice number, which the ingest
 * already handles by superseding (0243).
 *
 * ── WHEN AN EMAIL IS TRIED AGAIN ─────────────────────────────────────────────────────────────────────
 * Only `failed` — Graph or the database failed — up to MAX_ATTEMPTS. `refused` (the PDF does not add up, or is
 * not a Pilot bill), `no_pdf`, `duplicate` and `recorded` are final: nothing about the email will change. An
 * attachment does not expire the way the price link does, so the lookback is long enough to survive an outage.
 */

/** The owner's folder (2026-11-17 measurement, exact name). A rename in Outlook stops the feed; the run says so. */
export const PILOT_BILL_FOLDER = "Pilot-Bills";
export const BILL_LOOKBACK_MS = 14 * 24 * 3_600_000;
export const MAX_ATTEMPTS = 12;

export type PilotBillMailState = "recorded" | "duplicate" | "refused" | "failed" | "no_pdf";

export interface PilotBillMailDeps {
  reader: GraphFolderReader;
  readWords: (bytes: Buffer) => Promise<PdfWordsOutcome>;
  ingest: (words: StatementWord[], filename: string, bytes: Buffer) => Promise<StatementIngestResult>;
  /** Runs the invoice check for a recorded statement; returns the run id, or an error to note. */
  check: (words: StatementWord[], filename: string, statementId: string) => Promise<{ runId?: string; error?: string }>;
  now: () => Date;
}

export interface PilotBillMailRun {
  listed: number;
  settled: number;
  recorded: number;
  duplicate: number;
  refused: number;
  failed: number;
  noPdf: number;
}

interface LedgerRow {
  id: string;
  internet_message_id: string;
  state: PilotBillMailState;
  attempts: number;
}

type Outcome = Record<string, unknown> & { state: PilotBillMailState };

/** Whether this email needs work now. Pure; exported for the tests. */
export function billNeedsWork(row: LedgerRow | undefined): boolean {
  if (!row) return true;
  return row.state === "failed" && row.attempts < MAX_ATTEMPTS;
}

const WORDS_REASON: Record<string, string> = {
  encrypted_pdf: "The PDF is password-protected.",
  decode_failed: "The PDF could not be opened.",
  too_many_pages: "The PDF is far longer than a weekly bill.",
  no_text: "The PDF has no text layer (a scan), so it cannot be read.",
};

/** A live statement already recorded from these exact bytes, if any. Org-filtered: the service role bypasses RLS. */
async function existingStatement(admin: SupabaseClient, orgId: string, sha256: string): Promise<{ id: string; invoice_no: string } | null> {
  const { data, error } = await admin
    .from("fuel_statements")
    .select("id, invoice_no")
    .eq("org_id", orgId)
    .eq("source_sha256", sha256)
    .is("superseded_by", null)
    .limit(1);
  if (error) throw new Error(`fuel_statements read failed: ${error.message}`);
  return ((data ?? []) as { id: string; invoice_no: string }[])[0] ?? null;
}

async function handle(admin: SupabaseClient, orgId: string, msg: FolderMessage, deps: PilotBillMailDeps): Promise<Outcome> {
  if (!msg.id) return { state: "failed", error: "Graph returned the email without an id." };
  let pdfs: { name: string; bytes: Buffer }[];
  try {
    pdfs = await deps.reader.pdfAttachments(msg.id);
  } catch (e) {
    return { state: "failed", error: `Reading the attachments failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (pdfs.length === 0) return { state: "no_pdf", error: "The email has no PDF attachment." };

  // An email may carry more than one bill (the weekly `…F.pdf` beside a supplemental `…S.pdf`). Each is
  // recorded on its own; the row names the first one recorded and notes the rest.
  let first: Outcome | null = null;
  const notes: string[] = [];
  for (const pdf of pdfs) {
    const sha = createHash("sha256").update(pdf.bytes).digest("hex");
    const file = { file_name: pdf.name.slice(0, 200), file_sha256: sha };
    let outcome: Outcome;
    try {
      const dup = await existingStatement(admin, orgId, sha);
      if (dup) {
        outcome = { state: "duplicate", ...file, statement_id: dup.id, invoice_no: dup.invoice_no, error: null };
      } else {
        const words = await deps.readWords(pdf.bytes);
        if (!words.ok) {
          outcome = { state: "refused", ...file, error: WORDS_REASON[words.reason] ?? words.reason };
        } else {
          const r = await deps.ingest(words.words, pdf.name, pdf.bytes);
          if (!r.ok || !r.statementId) {
            const reason = [r.error, ...(r.tieOutFailures ?? [])].filter(Boolean).join(" ");
            outcome = { state: "refused", ...file, error: (reason || "The bill would not record.").slice(0, 2000) };
          } else {
            const checked = await deps.check(words.words, pdf.name, r.statementId);
            outcome = {
              state: "recorded", ...file, statement_id: r.statementId, invoice_no: r.invoiceNo ?? null,
              period_start: r.periodStart ?? null, period_end: r.periodEnd ?? null,
              error: checked.error ? `Recorded, but the invoice check did not run: ${checked.error}`.slice(0, 2000) : null,
            };
          }
        }
      }
    } catch (e) {
      outcome = { state: "failed", ...file, error: `${pdf.name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 2000) };
    }
    if (!first || (first.state !== "recorded" && outcome.state === "recorded")) {
      if (first) notes.push(`${String(first.file_name)}: ${first.state}`);
      first = outcome;
    } else {
      notes.push(`${pdf.name}: ${outcome.state}${outcome.error ? ` (${String(outcome.error)})` : ""}`);
    }
  }
  const out = first!;
  if (notes.length) out.error = [out.error, `Also attached — ${notes.join("; ")}`].filter(Boolean).join(" ").slice(0, 2000);
  return out;
}

export async function runPilotBillMail(admin: SupabaseClient, orgId: string, deps: PilotBillMailDeps): Promise<PilotBillMailRun> {
  const now = deps.now();
  const listed = await deps.reader.listSince(PILOT_BILL_FOLDER, new Date(now.getTime() - BILL_LOOKBACK_MS));
  const run: PilotBillMailRun = { listed: listed.length, settled: 0, recorded: 0, duplicate: 0, refused: 0, failed: 0, noPdf: 0 };
  if (listed.length === 0) return run;

  const { data, error } = await admin
    .from("pilot_bill_mails")
    .select("id, internet_message_id, state, attempts")
    .eq("org_id", orgId)
    .in("internet_message_id", listed.map((m) => m.internetMessageId));
  if (error) throw new Error(`pilot_bill_mails read failed: ${error.message}`);
  const byMessage = new Map(((data ?? []) as LedgerRow[]).map((r) => [r.internet_message_id, r]));

  for (const msg of listed) {
    const row = byMessage.get(msg.internetMessageId);
    if (!billNeedsWork(row)) {
      run.settled++;
      continue;
    }
    const outcome = await handle(admin, orgId, msg, deps);
    const stamp = { ...outcome, last_tried_at: now.toISOString() };
    const write = row
      ? admin.from("pilot_bill_mails").update({ ...stamp, attempts: row.attempts + 1 }).eq("org_id", orgId).eq("id", row.id)
      : admin.from("pilot_bill_mails").insert({
          ...stamp, org_id: orgId, internet_message_id: msg.internetMessageId, subject: msg.subject.slice(0, 500), received_at: msg.receivedAt,
        });
    const { error: writeError } = await write;
    if (writeError) throw new Error(`pilot_bill_mails write failed: ${writeError.message}`);
    if (outcome.state === "recorded") run.recorded++;
    else if (outcome.state === "duplicate") run.duplicate++;
    else if (outcome.state === "refused") run.refused++;
    else if (outcome.state === "failed") run.failed++;
    else run.noPdf++;
  }
  return run;
}

export interface PilotBillMail {
  subject: string;
  received_at: string;
  state: PilotBillMailState;
  attempts: number;
  file_name: string | null;
  invoice_no: string | null;
  period_start: string | null;
  period_end: string | null;
  statement_id: string | null;
  error: string | null;
  last_tried_at: string;
}

/** An org's newest handled bill emails, for the Pilot invoices page (newest first). */
export async function readPilotBillMails(admin: SupabaseClient, orgId: string, limit = 10): Promise<PilotBillMail[]> {
  const { data, error } = await admin
    .from("pilot_bill_mails")
    .select("subject, received_at, state, attempts, file_name, invoice_no, period_start, period_end, statement_id, error, last_tried_at")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`pilot_bill_mails read failed: ${error.message}`);
  return (data ?? []) as PilotBillMail[];
}
