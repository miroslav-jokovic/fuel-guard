import {
  CHAT_COMPLIANCE_REASON_LABELS,
  CHAT_EXPORT_FOLD,
  DEFAULT_ORG_TIMEZONE,
  formatDisplayDateTime,
  type ChatExportConversation,
  type ChatExportLine,
  type ChatExportRows,
} from "@silvicom/shared";
import { CONTENT_WIDTH, INK, MARGIN, MUTED, NAVY, DANGER, body, heading, muted, newDrawing, pdfkitText, rule, title } from "../../lib/pdfDraw.js";

/**
 * The readable copy of a chat export (OFFICE-CHAT-PLAN CHA3b, D-CHAT20). The JSONL beside it is the
 * evidence and `manifest.json` ties both to the ledger; this is what a lawyer or an HR reviewer reads.
 * So it says, on its first page, what it is, who made it and why, and how to check it — and prints
 * every line the JSONL holds: retracted ones marked and kept, edited ones with what they said before.
 *
 * Times are printed on the carrier's clock (`DEFAULT_ORG_TIMEZONE`) with the zone named; the JSONL
 * keeps the exact instants.
 */

const when = (iso: string | null) => (iso ? `${formatDisplayDateTime(iso, "—", DEFAULT_ORG_TIMEZONE)} CT` : "—");

function conversationLabel(c: ChatExportConversation): string {
  if (c.subject) return c.subject;
  const names = c.members.map((m) => m.name ?? "Unnamed").join(", ");
  return c.kind === "direct" ? `Direct: ${names}` : c.kind === "driver" ? `Driver thread: ${names}` : names;
}

function drawLine(doc: PDFKit.PDFDocument, l: ChatExportLine): void {
  const stamp = `#${l.seq} · ${when(l.created_at)} · ${l.sender_name ?? "System"}`;
  doc.moveDown(0.35).fillColor(MUTED).font("Helvetica").fontSize(8).text(pdfkitText(doc, stamp), { width: CONTENT_WIDTH });
  if (l.deleted_at) {
    doc.fillColor(DANGER).font("Helvetica-Bold").fontSize(8).text(pdfkitText(doc, `Retracted ${when(l.deleted_at)} — the words below were hidden from the conversation, not deleted`), { width: CONTENT_WIDTH });
  }
  body(doc, l.body, INK);
  if (l.versions.length) {
    for (const v of l.versions) {
      doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8.5)
        .text(pdfkitText(doc, `Before an edit on ${when(v.replaced_at)} (version ${v.version}): ${v.body}`), MARGIN + 12, undefined, { width: CONTENT_WIDTH - 12 });
    }
    doc.x = MARGIN;
  }
}

export async function renderChatExportPdf(rows: ChatExportRows): Promise<Buffer> {
  const { doc, done } = newDrawing(`Office chat export ${rows.export.id}`, { bufferPages: true });
  const e = rows.export;

  title(doc, "Office chat export");
  muted(doc, `Export ${e.id}`);
  heading(doc, "What this is");
  body(doc, e.scope === "conversation"
    ? "One conversation, whole: every message, including retracted ones, and every earlier version of an edited message."
    : `Every message matching a search${describeFilters(e.filters)}, including retracted ones and every earlier version.`);
  body(doc, `Made by ${e.requested_by_name ?? e.requested_by} on ${when(e.created_at)} for: ${CHAT_COMPLIANCE_REASON_LABELS[e.reason.category]} — ${e.reason.text}`);
  body(doc, `${e.message_count} message${e.message_count === 1 ? "" : "s"} in ${rows.conversations.length} conversation${rows.conversations.length === 1 ? "" : "s"}.`);

  heading(doc, "How to check it");
  body(doc, "This PDF is the readable copy. export.jsonl beside it is the record, and manifest.json ties both to the company's chat ledger, which is append-only and hash-chained.");
  muted(doc, `Fold: ${CHAT_EXPORT_FOLD}`);
  muted(doc, `content_sha256: ${e.content_sha256}`);
  muted(doc, `Ledger position: entry ${e.ledger_seq}, hash ${e.ledger_hash}`);

  for (const c of rows.conversations) {
    const lines = rows.lines.filter((l) => l.thread_id === c.thread_id);
    doc.addPage();
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text(pdfkitText(doc, conversationLabel(c)), { width: CONTENT_WIDTH });
    muted(doc, `Conversation ${c.thread_id} · ${c.kind} · started ${when(c.created_at)}${c.archived_at ? ` · archived ${when(c.archived_at)}` : ""}`);
    for (const m of c.members) {
      muted(doc, `${m.name ?? m.user_id} (${m.role}) — joined ${when(m.joined_at)}${m.left_at ? `, left ${when(m.left_at)}` : ""}`);
    }
    rule(doc);
    if (lines.length === 0) body(doc, "No messages in this conversation match.", MUTED);
    for (const l of lines) drawLine(doc, l);
  }

  stampFooters(doc, e.id);
  doc.end();
  return done;
}

function describeFilters(f: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof f.q === "string") parts.push(`the words “${f.q}”`);
  if (typeof f.from === "string") parts.push(`from ${when(f.from)}`);
  if (typeof f.to === "string") parts.push(`before ${when(f.to)}`);
  if (typeof f.person === "string") parts.push("one sender");
  if (typeof f.thread === "string") parts.push("one conversation");
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * "Page n of N" and the export id on every page. ⚠ The footer is below the bottom margin, and pdfkit
 * answers a write there with a new page; the margin is dropped for the stamp (`fuelSpendReportDraw`
 * paid for that lesson first).
 */
function stampFooters(doc: PDFKit.PDFDocument, exportId: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5)
      .text(`Office chat export ${exportId} · page ${i - range.start + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN + 10, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
