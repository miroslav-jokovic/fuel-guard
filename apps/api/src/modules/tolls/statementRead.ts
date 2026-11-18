import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOLL_PROVIDER_LABEL,
  TOLL_READER_VERSION,
  TollStatementReadError,
  readTollStatement,
  type TollProvider,
  type TollStatementFormat,
  type TollStatementLine,
  type TollStatementRead,
} from "@silvicom/shared";
import { readPdfWords, type PdfWordsOutcome } from "../../lib/pdfWords.js";
import { TOLL_STATEMENTS_BUCKET, type StatementRefusal } from "./statements.js";

/**
 * Read a kept toll statement into lines (TOLLS-PER-TRUCK-PLAN.md TL4b, migration 0633).
 *
 * ── THE SERVER READS WHAT IT STORED ──────────────────────────────────────────────────────────────
 * The bytes come out of the private bucket and are held to the SHA-256 recorded when the file was
 * kept (0627), then opened with pdf.js here, and the provider's shared reader (TL5) turns the words
 * into lines and ties every printed total. Nothing the browser says about a statement's contents is
 * used. A reader's refusal is recorded with its sentence, never discarded, so "why does this
 * statement show no tolls" is answered by the record rather than by a guess.
 *
 * ── ONLY PDF IS READ TODAY ───────────────────────────────────────────────────────────────────────
 * All 18 statements the owner supplied are PDFs (§1.3), so the readers were built and proven on PDF
 * alone. A CSV or spreadsheet statement is refused in words, not passed to a reader that has never
 * seen that layout — a reader that guesses columns is how money goes wrong.
 *
 * Every query filters on the org itself: the API reads with the service role, which bypasses RLS.
 */

export interface ReadOutcome {
  outcome: "read" | "refused";
  message: string | null;
  lineCount: number;
  provider: TollProvider;
  fileName: string;
}

const refuse = (status: StatementRefusal["status"], code: string, message: string): StatementRefusal => ({ refused: true, status, code, message });

const PDF_REFUSALS: Record<Exclude<PdfWordsOutcome, { ok: true }>["reason"], string> = {
  encrypted_pdf: "This PDF needs a password to open, so it cannot be read. Download the statement again without a password.",
  decode_failed: "This file could not be opened as a PDF. Download the statement again from the provider.",
  too_many_pages: "This PDF is far longer than any statement, so it was not read. Check that the right file was uploaded.",
  no_text: "This PDF is a scan with no text in it, and money is never read from a picture (D-TL7). Download the statement from the provider's site rather than scanning it.",
};

/**
 * provider | what drove (tag or plate) or what the line is | when | where | amount | occurrence.
 * The occurrence is the count of identical lines earlier in the same statement, so two identical
 * charges on one statement stay two lines (D-TL8, review 2026-11-18 item 8).
 */
export function matchKeys(provider: TollProvider, lines: readonly TollStatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const who = l.kind === "toll" ? (l.tagNumber ? `tag:${l.tagNumber}` : `plate:${l.plateState ?? ""}${l.plate}`) : l.kind;
    const when = l.kind === "toll" ? l.exitAt : (l.postedOn ?? "");
    const base = [provider, who, when, l.exitPlaza ?? l.location ?? "", l.amountCents].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

function lineRows(provider: TollProvider, read: TollStatementRead) {
  const keys = matchKeys(provider, read.lines);
  return read.lines.map((l, i) => ({
    line_index: l.index, kind: l.kind, tag_number: l.tagNumber, plate: l.plate, plate_state: l.plateState,
    device: l.device, agency: l.agency, entry_plaza: l.entryPlaza, entry_at: l.entryAt, exit_plaza: l.exitPlaza,
    exit_at: l.exitAt, location: l.location, lane: l.lane, vehicle_class: l.vehicleClass, rate: l.rate,
    posted_on: l.postedOn, amount_cents: l.amountCents, balance_cents: l.balanceCents, label: l.label,
    page: l.page, match_key: keys[i],
  }));
}

async function record(admin: SupabaseClient, orgId: string, statementId: string, userId: string, read: Record<string, unknown>, lines: unknown[]) {
  const { error } = await admin.rpc("record_toll_statement_read", { p_org_id: orgId, p_statement_id: statementId, p_actor: userId, p_read: read, p_lines: lines });
  return error;
}

/** Read one kept statement, record the outcome, and say what happened. */
export async function readKeptTollStatement(admin: SupabaseClient, orgId: string, userId: string, statementId: string): Promise<ReadOutcome | StatementRefusal> {
  const { data, error } = await admin
    .from("toll_statements")
    .select("id, provider, file_name, format, sha256, storage_path, removed_at, read_at")
    .eq("org_id", orgId).eq("id", statementId).maybeSingle();
  if (error) throw new Error(`[tolls] statement not read: ${error.message}`);
  const s = data as { provider: TollProvider; file_name: string; format: TollStatementFormat; sha256: string; storage_path: string; removed_at: string | null; read_at: string | null } | null;
  if (!s) return refuse(404, "not_found", "Statement not found.");
  if (s.removed_at) return refuse(409, "removed", "This statement was removed, so it is not read.");
  if (s.read_at) return refuse(409, "already_read", "This statement has already been read. A wrong read is fixed by removing the statement and uploading it again.");

  const base = { provider: s.provider, fileName: s.file_name };
  const refusal = async (message: string): Promise<ReadOutcome> => {
    const err = await record(admin, orgId, statementId, userId, { outcome: "refused", message, reader: TOLL_READER_VERSION[s.provider] }, []);
    if (err) throw new Error(`[tolls] refusal not recorded: ${err.message}`);
    return { ...base, outcome: "refused", message, lineCount: 0 };
  };

  if (s.format !== "pdf") {
    return refusal(`This ${TOLL_PROVIDER_LABEL[s.provider]} statement is a ${s.format.toUpperCase()} file, and only PDF statements are read so far. Upload the PDF the provider sends.`);
  }
  const { data: blob, error: dlErr } = await admin.storage.from(TOLL_STATEMENTS_BUCKET).download(s.storage_path);
  if (dlErr || !blob) throw new Error(`[tolls] stored statement not downloaded: ${dlErr?.message ?? "no bytes"}`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== s.sha256) {
    // The bucket is written only through 0627's checked upload; a changed file is an incident, not a refusal.
    throw new Error(`[tolls] stored statement ${statementId} no longer matches the SHA-256 kept with it`);
  }
  const words = await readPdfWords(bytes);
  if (!words.ok) return refusal(PDF_REFUSALS[words.reason]);

  let read: TollStatementRead;
  try {
    read = readTollStatement(s.provider, words.words);
  } catch (e) {
    if (e instanceof TollStatementReadError) return refusal(e.message);
    throw e;
  }
  const err = await record(admin, orgId, statementId, userId, {
    outcome: "read", reader: TOLL_READER_VERSION[s.provider], account: read.account,
    period_start: read.periodStart, period_end: read.periodEnd, printed_charges_cents: read.printedChargesCents, ties: read.ties,
  }, lineRows(s.provider, read));
  if (err) {
    // Two people pressing Read at once: the second meets the first's read (TS105).
    if (err.code === "TS105") return refuse(409, "already_read", "This statement has just been read by someone else.");
    throw new Error(`[tolls] read not recorded: ${err.message}`);
  }
  return { ...base, outcome: "read", message: null, lineCount: read.lines.length };
}
