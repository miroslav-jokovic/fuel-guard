import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { PILOT_PRICE_MAIL_STATES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import type { FolderMessage } from "../../lib/graphFolder.js";
import type { Cell } from "../../lib/xlsxGrid.js";
import type { QuoteDownload } from "./pilotQuoteDownload.js";
import type { PilotIngestResult } from "./pilotPriceIngest.js";
import {
  LINK_LIFE_MS,
  MAX_ATTEMPTS,
  needsWork,
  PILOT_PRICE_FOLDER,
  PILOT_PRICE_SENDER,
  readPilotPriceMails,
  runPilotPriceMail,
  type PilotPriceMailDeps,
} from "./pilotPriceMail.js";

const ORG = "org-silvicom";
const NOW = new Date("2026-11-18T21:00:00Z");
const QUOTE = "https://docgenapex.apex.pilotcloud.net/apexdocs/validate?document=d1&hash=h1";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const mail = (id: string, receivedAt: string, over: Partial<FolderMessage> = {}): FolderMessage => ({
  internetMessageId: `<${id}@pilot.test>`,
  subject: `${id} Price Quote - Pilot Flying J`,
  from: PILOT_PRICE_SENDER,
  receivedAt,
  body: `<a href="${QUOTE.replace(/&/g, "&amp;")}">View Price Quote</a>`,
  ...over,
});

async function xlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("q").addRow(["Site", "City"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const LOADED: PilotIngestResult = {
  ok: true, account: "139445", effectiveDate: "2026-11-19", totalRows: 677, duplicatesInFile: 0, uniqueSites: 677,
  stationsUpserted: 0, pricesInserted: 677, geocodeFailed: 0, skipped: 0,
};

/** Deps with a recorded reader, downloader and loader; each can be overridden per test. */
async function deps(messages: FolderMessage[], over: Partial<PilotPriceMailDeps> = {}) {
  const bytes = await xlsx();
  const listSince = vi.fn(async (_folder: string, _since: Date) => messages);
  const download = vi.fn(async (_link: string): Promise<QuoteDownload> => ({ ok: true, bytes, fileName: "pq-x-11192026.xlsx" }));
  const ingest = vi.fn(async (_grid: Cell[][]): Promise<PilotIngestResult> => LOADED);
  const d: PilotPriceMailDeps = { reader: { listSince }, download, ingest, now: () => NOW, ...over };
  return { d, listSince, download, ingest };
}

/** The ledger as a function fixture: answers only the message ids the run asked for, in this org. */
function ledger(rows: Array<Record<string, unknown>>) {
  return (q: RecordedQuery) => {
    const f = q.filters();
    const org = f.find((x) => x.col === "org_id")?.val;
    const ids = f.find((x) => x.col === "internet_message_id")?.val as string[] | undefined;
    return rows.filter((r) => r.org_id === org && (!ids || ids.includes(r.internet_message_id as string)));
  };
}

describe("runPilotPriceMail", () => {
  it("loads a new email's quote through the upload's loader and records it as loaded, in this org only", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d, listSince, download, ingest } = await deps([mail("11-19-2026", hoursAgo(1))]);
    const run = await runPilotPriceMail(rec.client, ORG, d);

    expect(run).toMatchObject({ listed: 1, loaded: 1, failed: 0, settled: 0 });
    expect(listSince).toHaveBeenCalledWith(PILOT_PRICE_FOLDER, new Date(NOW.getTime() - 7 * 24 * 3_600_000));
    expect(download).toHaveBeenCalledWith(QUOTE);
    expect(ingest.mock.calls[0]![0][0]).toEqual(["Site", "City"]); // the downloaded file, decoded
    const [row] = rec.writtenRows("pilot_price_mails");
    expect(row).toMatchObject({
      org_id: ORG, internet_message_id: "<11-19-2026@pilot.test>", state: "loaded", effective_date: "2026-11-19",
      prices_loaded: 677, sites: 677, skipped_rows: 0, geocode_pending: 0, file_name: "pq-x-11192026.xlsx", error: null,
      received_at: hoursAgo(1), last_tried_at: NOW.toISOString(),
    });
    expect(row!.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expectOrgScoped(rec, ORG);
  });

  it("ignores mail in the folder from anyone but Pilot's pricing sender", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d, download } = await deps([mail("fwd", hoursAgo(1), { from: "silviya@silvicominc.com" })]);
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ listed: 1, ignored: 1, loaded: 0 });
    expect(download).not.toHaveBeenCalled();
    expect(rec.writes()).toEqual([]);
  });

  it("does nothing more for an email already loaded", async () => {
    const m = mail("11-18-2026", hoursAgo(25));
    const rec = createSupabaseRecorder({
      tables: { pilot_price_mails: ledger([{ id: "r1", org_id: ORG, internet_message_id: m.internetMessageId, state: "loaded", attempts: 1, geocode_pending: 0 }]) },
    });
    const { d, download } = await deps([m]);
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ settled: 1, loaded: 0 });
    expect(download).not.toHaveBeenCalled();
    expect(rec.writes()).toEqual([]);
  });

  it("does not read another org's row as this org's — the same email is new here", async () => {
    const m = mail("11-19-2026", hoursAgo(1));
    const rec = createSupabaseRecorder({
      tables: { pilot_price_mails: ledger([{ id: "r9", org_id: "org-other", internet_message_id: m.internetMessageId, state: "loaded", attempts: 1, geocode_pending: 0 }]) },
    });
    const { d } = await deps([m]);
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ loaded: 1 });
    expect(rec.writtenRows("pilot_price_mails")[0]).toMatchObject({ org_id: ORG });
  });

  it("retries a failed email while its link lives, updating its own row", async () => {
    const m = mail("11-19-2026", hoursAgo(3));
    const rec = createSupabaseRecorder({
      tables: { pilot_price_mails: ledger([{ id: "r1", org_id: ORG, internet_message_id: m.internetMessageId, state: "failed", attempts: 2, geocode_pending: null }]) },
    });
    const { d } = await deps([m]);
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ loaded: 1 });
    const [w] = rec.writes();
    expect(w!.write!.method).toBe("update");
    expect(w!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: "r1" }]));
    expect(w!.write!.payload).toMatchObject({ state: "loaded", attempts: 3 });
    expectOrgScoped(rec, ORG);
  });

  it("records an email first seen after its link died as expired, so the gap shows", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d } = await deps([mail("11-13-2026", hoursAgo(130))], {
      download: async () => ({ ok: false, expired: true, error: "The link has expired — Pilot sent it to the customer portal's sign-in" }),
    });
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ expired: 1 });
    expect(rec.writtenRows("pilot_price_mails")[0]).toMatchObject({ state: "expired", error: expect.stringContaining("expired") });
  });

  it("records an email with no quote link as no_link and never downloads", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d, download } = await deps([mail("odd", hoursAgo(1), { body: '<a href="https://customerportal.pilotflyingj.com/">portal</a>' })]);
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ noLink: 1 });
    expect(download).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_price_mails")[0]).toMatchObject({ state: "no_link" });
  });

  it("records the loader's refusal as failed with its reason", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d } = await deps([mail("11-19-2026", hoursAgo(1))], {
      ingest: async () => ({ ...LOADED, ok: false, error: "No price rows found in the report.", pricesInserted: 0, uniqueSites: 0, skipped: 677 }),
    });
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ failed: 1 });
    expect(rec.writtenRows("pilot_price_mails")[0]).toMatchObject({ state: "failed", skipped_rows: 677, error: "No price rows found in the report." });
  });

  it("records a download that throws as failed rather than stopping the run", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: ledger([]) } });
    const { d } = await deps([mail("a", hoursAgo(2)), mail("b", hoursAgo(1))], {
      download: vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce({ ok: true, bytes: await xlsx(), fileName: "f.xlsx" }),
    });
    expect(await runPilotPriceMail(rec.client, ORG, d)).toMatchObject({ failed: 1, loaded: 1 });
    expect(rec.writtenRows("pilot_price_mails").map((r) => r.state)).toEqual(["failed", "loaded"]);
  });

  it("keeps a loaded email loaded when a re-load for sites still waiting on a map position fails", async () => {
    const m = mail("11-19-2026", hoursAgo(2));
    const rec = createSupabaseRecorder({
      tables: { pilot_price_mails: ledger([{ id: "r1", org_id: ORG, internet_message_id: m.internetMessageId, state: "loaded", attempts: 1, geocode_pending: 4 }]) },
    });
    const { d } = await deps([m], { download: async () => ({ ok: false, expired: false, error: "Pilot answered 503" }) });
    await runPilotPriceMail(rec.client, ORG, d);
    expect(rec.writes()[0]!.write!.payload).toMatchObject({ state: "loaded", attempts: 2, error: expect.stringContaining("503") });
  });

  it("throws when the ledger cannot be written, so the scheduler logs the run as failed", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: { data: [], error: null, writeError: { message: "boom" } } } });
    const { d } = await deps([mail("11-19-2026", hoursAgo(1))]);
    await expect(runPilotPriceMail(rec.client, ORG, d)).rejects.toThrow("boom");
  });
});

describe("needsWork", () => {
  const row = (state: "failed" | "loaded" | "expired" | "no_link", attempts = 1, geocode_pending: number | null = 0) =>
    ({ id: "r", internet_message_id: "m", state, attempts, geocode_pending });
  const inside = hoursAgo(1);
  const outside = new Date(NOW.getTime() - LINK_LIFE_MS - 60_000).toISOString();

  it("works on an email never seen, however old — its row is how a missed quote becomes visible", () => {
    expect(needsWork(undefined, inside, NOW)).toBe(true);
    expect(needsWork(undefined, outside, NOW)).toBe(true);
  });
  it("retries failed only inside the link's life and under the attempt cap", () => {
    expect(needsWork(row("failed", 1), inside, NOW)).toBe(true);
    expect(needsWork(row("failed", MAX_ATTEMPTS), inside, NOW)).toBe(false);
    expect(needsWork(row("failed", 1), outside, NOW)).toBe(false);
  });
  it("re-loads a loaded email only for sites still waiting on a map position, inside the link's life", () => {
    expect(needsWork(row("loaded", 1, 0), inside, NOW)).toBe(false);
    expect(needsWork(row("loaded", 1, 3), inside, NOW)).toBe(true);
    expect(needsWork(row("loaded", 1, 3), outside, NOW)).toBe(false);
  });
  it("treats expired and no_link as final", () => {
    expect(needsWork(row("expired"), inside, NOW)).toBe(false);
    expect(needsWork(row("no_link"), inside, NOW)).toBe(false);
  });
});

describe("readPilotPriceMails", () => {
  it("reads this org's rows, newest first", async () => {
    const rec = createSupabaseRecorder({ tables: { pilot_price_mails: [{ subject: "s", state: "loaded" }] } });
    expect(await readPilotPriceMails(rec.client, ORG)).toEqual([{ subject: "s", state: "loaded" }]);
    expectOrgScoped(rec, ORG);
    expect(rec.forTable("pilot_price_mails")[0]!.ops.find((o) => o.method === "order")!.args).toEqual(["received_at", { ascending: false }]);
  });
});

describe("PILOT_PRICE_MAIL_STATES", () => {
  it("names exactly the states 0635's CHECK allows", () => {
    const sql = readFileSync(new URL("../../../../../supabase/migrations/0635_pilot_price_mails.sql", import.meta.url), "utf8");
    const check = /state\s+text not null check \(state in \(([^)]*)\)\)/.exec(sql)![1]!;
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...PILOT_PRICE_MAIL_STATES]);
  });
});
