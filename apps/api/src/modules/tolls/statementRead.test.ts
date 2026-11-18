import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { closeTestServer } from "../../testing/httpServer.js";
import { matchKeys } from "./statementRead.js";

/**
 * Reading a kept statement on the server (TOLLS-PER-TRUCK-PLAN.md TL4b). What 0633 refuses is proved by
 * `supabase/tests/toll-statement-lines.test.mjs`; the readers' layouts by the shared reader tests and,
 * on the owner's real files, by `pnpm tolls:check-real`. What is left is this path:
 *
 *   · the API opens the bytes it STORED (held to the kept SHA-256), with pdf.js, here — a real PDF is
 *     built below and read end to end, so the decode, the y-flip and the reader meet for real;
 *   · a statement that does not tie, a scan, and a non-PDF are each recorded as a refusal with the
 *     sentence, never as an empty read;
 *   · a read already done, or a removed statement, is not read again, and nothing is written;
 *   · reading needs `accounting: manage`, and every query is org-scoped.
 */

const ORG = "org-1";
const USER = "user-1";
const ID = "11111111-1111-4111-8111-111111111111";

/** An ExpressToll statement as words at the positions the real one prints them (§1.3), drawn by pdfkit. */
type Cell = [text: string, x: number];
function expressTollPdf(o: { secondToll?: string; blank?: boolean } = {}): Promise<Buffer> {
  const lines: Array<[page: number, y: number, cells: Cell[]]> = [
    [1, 272, [["Statement", 131], ["for", 175], ["Transactions", 193], ["Posted", 251], ["between", 283], ["7/28/2026", 318], ["and", 363], ["8/27/2026", 381], ["Acct", 425], ["No", 448], [":", 461], ["9000001", 470]]],
    [1, 294, [["Transaction", 47], ["Date/Time", 102], ["Location", 169], ["Lane", 350], ["Toll", 412], ["Status*", 432], ["Amount", 531]]],
    [1, 310, [["Transactions", 47], ["For", 106], ["Device", 124], ["#", 156], ["7000001", 165], ["Plate", 212], ["#", 238], ["P1111111-IL", 247]]],
    [1, 323, [["8/25/2026", 47], ["4:25:27", 86], ["AM", 118], ["TX", 169], ["Tarrant", 188], ["IOPVTOLL", 412], ["P1111111", 453], ["$9.00", 545]]],
    [1, 336, [["8/25/2026", 47], ["4:25:27", 86], ["AM", 118], ["TX", 169], ["Tarrant", 188], ["IOPVTOLL", 412], ["P1111111", 453], [o.secondToll ?? "$9.00", 545]]],
    [1, 350, [["Total:", 489], ["$18.00", 544]]],
    [1, 380, [["Grand", 445], ["Total:", 472], ["$18.00", 529]]],
    [2, 96, [["Previous", 387], ["Balance", 427], [":", 463], ["$100.00", 532]]],
    [2, 113, [["8/10/2026", 48], ["PAYMENT", 93], ["CREDIT", 279], ["$10.00", 338], ["Total", 417], ["Tolls", 440], [":", 463], ["-$18.00", 524]]],
    [2, 130, [["Payments", 419], [":", 462], ["$10.00", 527]]],
    [2, 157, [["Ending", 394], ["Balance", 426], [":", 463], ["$92.00", 532]]],
  ];
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font("Helvetica").fontSize(7);
    for (const page of [1, 2]) {
      doc.addPage();
      if (o.blank) continue; // a "scan": pages and no text
      for (const [p, y, cells] of lines) if (p === page) for (const [text, x] of cells) doc.text(text, x, y, { lineBreak: false });
    }
    doc.end();
  });
}

let rec: SupabaseRecorder;
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async (_a: unknown, _e: Record<string, unknown>) => true) }));
vi.mock("../../lib/audit.js", () => audit);
vi.mock("../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "accountant", email: "books@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection:
    (section: string, level: "view" | "manage" = "manage") =>
    (req: Request, res: Response, next: NextFunction) => {
      const grants = String(req.headers["x-grants"] ?? "accounting:manage").split(",");
      if (grants.some((g) => { const [s, l] = g.split(":"); return s === section && (l === "manage" || l === level); })) next();
      else res.status(403).json({ ok: false, error: { code: "forbidden", message: "no" } });
    },
}));
const { tollsRouter } = await import("./routes/tolls.js");

const statement = (bytes: Buffer, over: Record<string, unknown> = {}) => ({
  id: ID, org_id: ORG, provider: "expresstoll", file_name: "Aug 2026 Statement.pdf", format: "pdf", byte_size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), storage_path: `${ORG}/${ID}`, uploaded_by: USER, created_at: "2026-11-18T15:00:00Z",
  period_start: null, period_end: null, printed_total: null, read_at: null, removed_at: null, removed_by: null, remove_reason: null, ...over,
});

function seed(stored: Buffer, row: Record<string, unknown>) {
  rec = createSupabaseRecorder({
    tables: { toll_statements: postgrestFixture([row]), toll_statement_reads: [], user_profiles: [{ user_id: USER, full_name: "Bea Books" }] },
    rpc: { record_toll_statement_read: { data: "read-1", error: null } },
    storage: { download: () => ({ data: new Blob([new Uint8Array(stored)]), error: null }) },
  });
}

async function read(grants?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.use(express.json());
  app.use("/api/tolls", tollsRouter());
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tolls/statements/${ID}/read`, { method: "POST", headers: grants ? { "x-grants": grants } : {} });
    // A thrown fault reaches Express's default handler here, which answers in HTML, not JSON.
    const text = await res.text();
    return { status: res.status, body: text.startsWith("{") ? (JSON.parse(text) as Record<string, unknown>) : { text } };
  } finally {
    await closeTestServer(server);
  }
}

const recorded = () => rec.rpcs().filter((c) => c.fn === "record_toll_statement_read").map((c) => c.args as { p_read: Record<string, unknown>; p_lines: Record<string, unknown>[] });

beforeEach(() => audit.writeAudit.mockClear());

describe("reading a kept statement on the server", () => {
  it("opens the stored PDF itself and records every line, the account and the ties in one call", async () => {
    const pdf = await expressTollPdf();
    seed(pdf, statement(pdf));
    const { status } = await read();
    expect(status).toBe(200);
    const [call] = recorded();
    expect(call!.p_read).toMatchObject({ outcome: "read", reader: "expresstoll@2026-11-18", account: "9000001", period_start: "2026-07-28", period_end: "2026-08-27", printed_charges_cents: 1800 });
    expect(call!.p_lines.map((l) => [l.line_index, l.kind, l.plate, l.exit_at, l.amount_cents])).toEqual([
      [0, "toll", "P1111111", "2026-08-25T04:25:27", 900],
      [1, "toll", "P1111111", "2026-08-25T04:25:27", 900],
      [2, "account_payment", null, null, -1000],
    ]);
    // Two identical charges on one statement are two lines, told apart by their occurrence (D-TL8).
    expect(call!.p_lines[0]!.match_key).toMatch(/\|0$/);
    expect(call!.p_lines[1]!.match_key).toMatch(/\|1$/);
    expect(audit.writeAudit.mock.calls[0]![1]).toMatchObject({ action: "tolls.statement_read", entityId: ID, meta: { outcome: "read", lines: 3 } });
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  it("records a statement that does not add up as refused, with the reader's sentence and no lines", async () => {
    const pdf = await expressTollPdf({ secondToll: "$8.00" });
    seed(pdf, statement(pdf));
    expect((await read()).status).toBe(200);
    const [call] = recorded();
    expect(call!.p_lines).toEqual([]);
    expect(call!.p_read).toMatchObject({ outcome: "refused", message: expect.stringMatching(/does not add up as read.*Total for device 7000001: printed \$18\.00, read \$17\.00/) });
  });

  it("refuses a scan rather than reading money from a picture", async () => {
    const pdf = await expressTollPdf({ blank: true });
    seed(pdf, statement(pdf));
    await read();
    expect(recorded()[0]!.p_read).toMatchObject({ outcome: "refused", message: expect.stringMatching(/a scan with no text/) });
  });

  it("does not read a statement already read, or one removed, and writes nothing", async () => {
    const pdf = await expressTollPdf();
    seed(pdf, statement(pdf, { read_at: "2026-11-18T16:00:00Z" }));
    expect(await read()).toMatchObject({ status: 409, body: { error: { code: "already_read" } } });
    seed(pdf, statement(pdf, { removed_at: "2026-11-18T16:00:00Z", removed_by: USER, remove_reason: "wrong provider" }));
    expect(await read()).toMatchObject({ status: 409, body: { error: { code: "removed" } } });
    expect(recorded()).toEqual([]);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("treats stored bytes that no longer match their fingerprint as a fault, not a refusal", async () => {
    const pdf = await expressTollPdf();
    seed(pdf, statement(pdf, { sha256: "b".repeat(64) }));
    expect((await read()).status).toBe(500);
    expect(recorded()).toEqual([]);
  });

  it("needs accounting: manage — viewing the books is not enough to write a read", async () => {
    const pdf = await expressTollPdf();
    seed(pdf, statement(pdf));
    expect((await read("accounting:view,equipment:manage")).status).toBe(403);
    expect(recorded()).toEqual([]);
  });
});

describe("matchKeys", () => {
  it("names what drove, when, where and how much, and counts repeats within the statement", () => {
    const line = { kind: "toll", tagNumber: "09990000001", plate: null, plateState: null, exitAt: "2026-06-28T14:24", exitPlaza: "17", location: null, postedOn: null, amountCents: 845 } as never;
    const fee = { kind: "service_fee", tagNumber: null, plate: null, plateState: null, exitAt: null, exitPlaza: null, location: null, postedOn: "2026-06-27", amountCents: 100 } as never;
    expect(matchKeys("ezpass", [line, line, fee])).toEqual([
      "ezpass|tag:09990000001|2026-06-28T14:24|17|845|0",
      "ezpass|tag:09990000001|2026-06-28T14:24|17|845|1",
      "ezpass|service_fee|2026-06-27||100|0",
    ]);
  });
});
