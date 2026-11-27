import { describe, it, expect, vi } from "vitest";
import type { StatementWord } from "@silvicom/shared";
import type { FolderMessage } from "../../lib/graphFolder.js";
import type { PdfWordsOutcome } from "../../lib/pdfWords.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import type { StatementIngestResult } from "./fuelStatementIngest.js";
import { BILL_LOOKBACK_MS, MAX_ATTEMPTS, PILOT_BILL_FOLDER, billNeedsWork, refusedPdfPath, runPilotBillMail, type PilotBillMailDeps } from "./pilotBillMail.js";

/**
 * The Pilot weekly bill pull (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4). The PDF reading and the statement
 * arithmetic have their own tests (`pdfWords`, `pilotInvoice`, `fuelStatementIngest`); this pins what the pull
 * decides: every email gets a row, a bill is recorded through the upload's own ingest and then checked, the same
 * bytes forwarded twice are recorded once, a refusal is final and says why, and only a failure is tried again.
 */
const ORG = "org-silvicom";
const NOW = new Date("2026-11-24T21:00:00Z");
const PDF = Buffer.from("%PDF-1.7 the weekly bill");
const WORDS: StatementWord[] = [{ text: "Card#", x: 19, y: 161, page: 1 }];

const mail = (id: string, over: Partial<FolderMessage> = {}): FolderMessage => ({
  id: `graph-${id}`, internetMessageId: `<${id}@pilot.test>`, subject: `FW: Pilot invoice ${id}`,
  from: "silviya@silvicominc.com", receivedAt: "2026-11-23T22:00:00Z", body: "", ...over,
});

const RECORDED: StatementIngestResult = {
  ok: true, statementId: "stmt-1", invoiceNo: "INV-59656", periodStart: "2026-11-16", periodEnd: "2026-11-23", lines: 960, fills: 499,
};

function deps(messages: FolderMessage[], over: Partial<PilotBillMailDeps> = {}, pdfs = [{ name: "Standard_Invoice_Gen_Template_INV-59656.pdf", bytes: PDF }]) {
  const listSince = vi.fn(async (_f: string, _s: Date) => messages);
  const pdfAttachments = vi.fn(async (_id: string) => pdfs);
  const readWords = vi.fn(async (_b: Buffer): Promise<PdfWordsOutcome> => ({ ok: true, words: WORDS }));
  const ingest = vi.fn(async (_w: StatementWord[], _n: string, _b: Buffer): Promise<StatementIngestResult> => RECORDED);
  const check = vi.fn(async (_w: StatementWord[], _n: string, _s: string) => ({ runId: "run-1" }));
  const keepRefused = vi.fn(async (_sha: string, _b: Buffer) => {});
  const d: PilotBillMailDeps = { reader: { listSince, pdfAttachments }, readWords, ingest, check, keepRefused, now: () => NOW, ...over };
  return { d, listSince, pdfAttachments, readWords, ingest, check, keepRefused };
}

/** The ledger and the statements, answering only this org's rows for the keys the run asked about. */
function tables(ledgerRows: Array<Record<string, unknown>> = [], statements: Array<Record<string, unknown>> = []) {
  const byOrg = (rows: Array<Record<string, unknown>>, key: string, col: string) => (q: RecordedQuery) => {
    const f = q.filters();
    const org = f.find((x) => x.col === "org_id")?.val;
    const want = f.find((x) => x.col === col)?.val;
    const wanted = Array.isArray(want) ? want : want === undefined ? null : [want];
    return rows.filter((r) => r.org_id === org && (!wanted || wanted.includes(r[key])));
  };
  return createSupabaseRecorder({
    tables: {
      pilot_bill_mails: byOrg(ledgerRows, "internet_message_id", "internet_message_id"),
      fuel_statements: byOrg(statements, "source_sha256", "source_sha256"),
    },
  });
}

describe("runPilotBillMail", () => {
  it("records a new bill through the upload's ingest, checks it, and writes its row — in this org only", async () => {
    const rec = tables();
    const { d, listSince, pdfAttachments, ingest, check } = deps([mail("a")]);
    const run = await runPilotBillMail(rec.client, ORG, d);

    expect(run).toMatchObject({ listed: 1, recorded: 1, settled: 0 });
    expect(listSince).toHaveBeenCalledWith(PILOT_BILL_FOLDER, new Date(NOW.getTime() - BILL_LOOKBACK_MS));
    expect(pdfAttachments).toHaveBeenCalledWith("graph-a");
    expect(ingest).toHaveBeenCalledWith(WORDS, "Standard_Invoice_Gen_Template_INV-59656.pdf", PDF);
    expect(check).toHaveBeenCalledWith(WORDS, "Standard_Invoice_Gen_Template_INV-59656.pdf", "stmt-1");
    const [row] = rec.writtenRows("pilot_bill_mails");
    expect(row).toMatchObject({
      org_id: ORG, internet_message_id: "<a@pilot.test>", state: "recorded", statement_id: "stmt-1", invoice_no: "INV-59656",
      period_start: "2026-11-16", period_end: "2026-11-23", error: null,
    });
    expect(row!.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expectOrgScoped(rec, ORG);
  });

  it("records the same PDF once: a second email with identical bytes settles as a duplicate of the first", async () => {
    const sha = (await import("node:crypto")).createHash("sha256").update(PDF).digest("hex");
    const rec = tables([], [{ org_id: ORG, id: "stmt-1", invoice_no: "INV-59656", source_sha256: sha }]);
    const { d, ingest, check } = deps([mail("b")]);
    const run = await runPilotBillMail(rec.client, ORG, d);
    expect(run.duplicate).toBe(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({ state: "duplicate", statement_id: "stmt-1" });
  });

  it("refuses a bill that does not add up, says why in Pilot's own numbers, and never retries it", async () => {
    const rec = tables();
    const refused: StatementIngestResult = { ok: false, error: "The statement didn't add up.", tieOutFailures: ["off by $787.77"] };
    const { d, check } = deps([mail("c")], { ingest: vi.fn(async () => refused) });
    const run = await runPilotBillMail(rec.client, ORG, d);
    expect(run.refused).toBe(1);
    expect(check).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({ state: "refused", error: "The statement didn't add up. off by $787.77" });
    expect(billNeedsWork({ id: "x", internet_message_id: "<c@pilot.test>", state: "refused", attempts: 1 })).toBe(false);
  });

  it("keeps a refused bill's PDF under its own hash, so the refusal can be diagnosed without the email", async () => {
    const sha = (await import("node:crypto")).createHash("sha256").update(PDF).digest("hex");
    const refused: StatementIngestResult = { ok: false, error: "The statement didn't add up." };
    const { d, keepRefused } = deps([mail("c2")], { ingest: vi.fn(async () => refused) });
    await runPilotBillMail(tables().client, ORG, d);
    expect(keepRefused).toHaveBeenCalledWith(sha, PDF);
    expect(refusedPdfPath(ORG, sha)).toBe(`${ORG}/refused/${sha}.pdf`);
  });

  it("a refused bill whose PDF cannot be kept stays refused, with the reason noted — never a failure", async () => {
    const rec = tables();
    const refused: StatementIngestResult = { ok: false, error: "The statement didn't add up." };
    const { d } = deps([mail("c3")], { ingest: vi.fn(async () => refused), keepRefused: vi.fn(async () => { throw new Error("bucket full"); }) });
    expect((await runPilotBillMail(rec.client, ORG, d)).refused).toBe(1);
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({
      state: "refused", error: "The statement didn't add up. (The PDF could not be kept: bucket full)",
    });
  });

  it("keeps nothing for a recorded bill — its PDF is the statement's own source", async () => {
    const { d, keepRefused } = deps([mail("c4")]);
    await runPilotBillMail(tables().client, ORG, d);
    expect(keepRefused).not.toHaveBeenCalled();
  });

  it("refuses a scanned PDF with the reason, rather than recording an empty bill", async () => {
    const rec = tables();
    const { d, ingest } = deps([mail("d")], { readWords: vi.fn(async (): Promise<PdfWordsOutcome> => ({ ok: false, reason: "no_text" })) });
    await runPilotBillMail(rec.client, ORG, d);
    expect(ingest).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({ state: "refused", error: expect.stringMatching(/no text layer/) });
  });

  it("records an email with no PDF as no_pdf, so a missing bill is visible", async () => {
    const rec = tables();
    const { d } = deps([mail("e")], {}, []);
    const run = await runPilotBillMail(rec.client, ORG, d);
    expect(run.noPdf).toBe(1);
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({ state: "no_pdf" });
  });

  it("keeps a recorded bill recorded when only its invoice check fails, and says so", async () => {
    const rec = tables();
    const { d } = deps([mail("f")], { check: vi.fn(async () => ({ error: "no fills in range" })) });
    await runPilotBillMail(rec.client, ORG, d);
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({
      state: "recorded", statement_id: "stmt-1", error: "Recorded, but the invoice check did not run: no fills in range",
    });
  });

  it("tries a failed email again up to the limit, and leaves every settled one alone", async () => {
    const rows = [
      { org_id: ORG, id: "r1", internet_message_id: "<g@pilot.test>", state: "failed", attempts: 2 },
      { org_id: ORG, id: "r2", internet_message_id: "<h@pilot.test>", state: "recorded", attempts: 1 },
      { org_id: ORG, id: "r3", internet_message_id: "<i@pilot.test>", state: "failed", attempts: MAX_ATTEMPTS },
    ];
    const rec = tables(rows);
    const { d, pdfAttachments } = deps([mail("g"), mail("h"), mail("i")]);
    const run = await runPilotBillMail(rec.client, ORG, d);
    expect(run).toMatchObject({ listed: 3, settled: 2, recorded: 1 });
    expect(pdfAttachments).toHaveBeenCalledTimes(1);
    const upd = rec.queries.find((q) => q.table === "pilot_bill_mails" && q.write?.method === "update")!;
    expect(upd.write!.payload).toMatchObject({ state: "recorded", attempts: 3 });
    expect(upd.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: "r1" }]));
  });

  it("marks a Graph failure as failed so the next run retries it", async () => {
    const rec = tables();
    const { d } = deps([mail("j")]);
    d.reader.pdfAttachments = vi.fn(async () => {
      throw new Error("Graph GET … failed: 503");
    });
    await runPilotBillMail(rec.client, ORG, d);
    expect(rec.writtenRows("pilot_bill_mails")[0]).toMatchObject({ state: "failed", error: expect.stringMatching(/503/) });
  });

  it("records every bill on an email with two, naming the first and noting the other", async () => {
    const rec = tables();
    const { d, ingest } = deps([mail("k")], {}, [
      { name: "db139445F.pdf", bytes: PDF },
      { name: "db139445S.pdf", bytes: Buffer.from("%PDF-1.7 supplemental") },
    ]);
    await runPilotBillMail(rec.client, ORG, d);
    expect(ingest).toHaveBeenCalledTimes(2);
    const [row] = rec.writtenRows("pilot_bill_mails");
    expect(row).toMatchObject({ state: "recorded", file_name: "db139445F.pdf" });
    expect(String(row!.error)).toMatch(/Also attached — db139445S\.pdf: recorded/);
  });

  it("does nothing, and writes nothing, when the folder is empty", async () => {
    const rec = tables();
    const run = await runPilotBillMail(rec.client, ORG, deps([]).d);
    expect(run.listed).toBe(0);
    expect(rec.queries).toHaveLength(0);
  });
});
