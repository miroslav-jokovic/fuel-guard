import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { ChatExportRows } from "@silvicom/shared";
import { renderChatExportPdf } from "./chatExportPdf.js";

/**
 * The readable copy of a chat export (CHA3b). A test cannot read a PDF's words back (headless Chromium
 * renders none, and pdfkit's text is positioned glyphs), so what it holds is what can be measured: the
 * file is a PDF, every conversation starts its own page after the cover, a long conversation runs on
 * to more pages rather than off the bottom, and a name outside WinAnsi does not stop the render.
 */
const THREAD = "33333333-3333-4333-8333-333333333333";
const OTHER = "77777777-7777-4777-8777-777777777777";
const rows = (lines: number, conversations = [THREAD]): ChatExportRows => ({
  export: {
    id: "55555555-5555-4555-8555-555555555555", scope: "search", filters: { q: "night" },
    reason: { category: "legal", text: "Litigation hold for matter 2026-CV-118" }, requested_by: "11111111-1111-4111-8111-111111111111",
    requested_by_name: "Đorđe Jokić", created_at: "2026-10-24T10:00:00Z", message_count: lines, ledger_seq: 41,
    ledger_hash: "a".repeat(64), content_sha256: "b".repeat(64),
  },
  conversations: conversations.map((id) => ({
    thread_id: id, kind: "group", subject: "Night dispatch", load_id: null, created_at: "2026-10-23T14:00:00Z", archived_at: null,
    members: [{ user_id: "22222222-2222-4222-8222-222222222222", name: "Miloš Živković", role: "dispatcher", member_role: "member", joined_at: "2026-10-23T14:00:00Z", left_at: null }],
  })),
  lines: Array.from({ length: lines }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, thread_id: conversations[i % conversations.length]!, seq: i + 1,
    sender_user_id: null, sender_name: "Miloš Živković", body: `Line ${i + 1}: the night shift starts at 9 and the truck is at the yard gate.`,
    body_sha256: "c".repeat(64), created_at: "2026-10-23T15:00:00Z", edited_at: null,
    deleted_at: i === 0 ? "2026-10-23T16:00:00Z" : null,
    versions: i === 1 ? [{ version: 1, body: "earlier words", body_sha256: "d".repeat(64), replaced_at: "2026-10-23T15:30:00Z", replaced_by: null }] : [],
  })),
});

const pages = async (bytes: Buffer) => (await PDFDocument.load(bytes)).getPageCount();

describe("renderChatExportPdf", () => {
  it("writes a PDF with a cover and one page per conversation", async () => {
    const bytes = await renderChatExportPdf(rows(4, [THREAD, OTHER]));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await pages(bytes)).toBe(3);
  });

  it("runs a long conversation on to more pages, and an empty export is still a cover and its conversation", async () => {
    expect(await pages(await renderChatExportPdf(rows(200)))).toBeGreaterThan(5);
    expect(await pages(await renderChatExportPdf({ ...rows(0), conversations: rows(1).conversations }))).toBe(2);
  });
});
