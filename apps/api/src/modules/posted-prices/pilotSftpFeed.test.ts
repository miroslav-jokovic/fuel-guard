import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { RemoteFile, SftpSession } from "../../lib/sftpClient.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import type { PilotIngestResult } from "./pilotPriceIngest.js";
import { MAX_ATTEMPTS, MAX_FILES_PER_RUN, READER_VERSION, classify, needsWork, runPilotSftp, type PilotSftpDeps } from "./pilotSftpFeed.js";

/**
 * The Pilot SFTP pull (PILOT-SFTP-FEED-PLAN §4). The price reader has its own tests (`pilotPriceIngest`); this
 * pins what the pull decides: every file gets a row and a kept copy before anything reads it, a quote loads through
 * the upload's own ingest, a file with no reader is held rather than dropped, the same bytes twice are taken once,
 * Pilot's server is only listed and read, and a held file is re-read from the kept copy when its reader lands.
 */
const ORG = "org-silvicom";
const NOW = new Date("2026-11-26T21:00:00Z");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function quoteXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Quote").addRow(["Account: 139445"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const LOADED: PilotIngestResult = {
  ok: true, account: "139445", effectiveDate: "2026-11-27", totalRows: 677, duplicatesInFile: 0, uniqueSites: 677,
  stationsUpserted: 677, pricesInserted: 677, geocodeFailed: 0, skipped: 0,
};

const file = (path: string, over: Partial<RemoteFile> = {}): RemoteFile => ({ path, size: 100, mtime: new Date("2026-11-26T20:20:00Z"), ...over });

function deps(files: RemoteFile[], bytes: Record<string, Buffer>, over: Partial<PilotSftpDeps> = {}) {
  const read = vi.fn(async (path: string, _max: number) => bytes[path]!);
  const close = vi.fn();
  const session: SftpSession = { listFiles: vi.fn(async () => files), read, close };
  const store = vi.fn(async (_p: string, _b: Buffer) => {});
  const fetchKept = vi.fn(async (_p: string): Promise<Buffer> => Buffer.from(""));
  const ingestPrices = vi.fn(async () => LOADED);
  const d: PilotSftpDeps = { open: async () => session, store, fetchKept, ingestPrices, now: () => NOW, ...over };
  return { d, session, read, close, store, fetchKept, ingestPrices };
}

/** The ledger, answering only this org's rows, by the paths listed or by the bytes' hash. */
function ledger(rows: Array<Record<string, unknown>> = []) {
  return createSupabaseRecorder({
    tables: {
      pilot_sftp_files: (q: RecordedQuery) => {
        const f = q.filters();
        const org = f.find((x) => x.col === "org_id")?.val;
        const paths = f.find((x) => x.col === "remote_path")?.val as string[] | undefined;
        const hash = f.find((x) => x.col === "file_sha256")?.val;
        return rows.filter((r) => r.org_id === org && (!paths || paths.includes(r.remote_path as string)) && (hash === undefined || r.file_sha256 === hash));
      },
    },
  });
}

describe("classify", () => {
  it("names Pilot's quote file a price quote, and anything about transactions a transaction file", () => {
    expect(classify("/pq-139445-11272026.xlsx")).toBe("price_quote");
    expect(classify("/Quotes/Price Quote 11-27.xlsx")).toBe("price_quote");
    expect(classify("/Transactions_139445_20261126.csv")).toBe("transactions");
    expect(classify("/daily_txn.xlsx")).toBe("transactions");
    expect(classify("/readme.txt")).toBe("unknown");
  });
});

describe("runPilotSftp", () => {
  it("keeps the file, loads a new quote through the upload's ingest, and writes its row — in this org only", async () => {
    const bytes = await quoteXlsx();
    const rec = ledger();
    const { d, store, ingestPrices, close } = deps([file("/pq-139445-11272026.xlsx", { size: bytes.length })], { "/pq-139445-11272026.xlsx": bytes });
    const run = await runPilotSftp(rec.client, ORG, d);

    expect(run).toMatchObject({ listed: 1, loaded: 1, settled: 0 });
    expect(store).toHaveBeenCalledWith(`${ORG}/2026-11-26/${sha(bytes).slice(0, 16)}-pq-139445-11272026.xlsx`, bytes);
    expect(ingestPrices).toHaveBeenCalledTimes(1);
    const [row] = rec.writtenRows("pilot_sftp_files");
    expect(row).toMatchObject({
      org_id: ORG, remote_path: "/pq-139445-11272026.xlsx", kind: "price_quote", state: "loaded", effective_date: "2026-11-27",
      rows_loaded: 677, reader_version: READER_VERSION.price_quote, file_sha256: sha(bytes), error: null,
    });
    expect(close).toHaveBeenCalled();
    expectOrgScoped(rec, ORG);
  });

  it("holds a Transaction file — kept byte for byte, with why — instead of dropping it, and reads nothing into the system", async () => {
    const bytes = Buffer.from("card,date,gallons\n");
    const rec = ledger();
    const { d, store, ingestPrices } = deps([file("/Transactions_20261126.csv")], { "/Transactions_20261126.csv": bytes });
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ held: 1 });
    expect(store).toHaveBeenCalledTimes(1);
    expect(ingestPrices).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_sftp_files")[0]).toMatchObject({ kind: "transactions", state: "held", reader_version: 0, file_sha256: sha(bytes) });
    expect(String(rec.writtenRows("pilot_sftp_files")[0]!.error)).toContain("no reader yet");
  });

  it("refuses a quote-named file the price reader does not recognise, as final, with the reader's reason", async () => {
    const rec = ledger();
    const { d } = deps([file("/pq-139445-11272026.xlsx")], { "/pq-139445-11272026.xlsx": await quoteXlsx() }, {
      ingestPrices: async () => ({ ...LOADED, ok: false, totalRows: 0, pricesInserted: 0, effectiveDate: null, error: "Unrecognized file" }),
    });
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ refused: 1 });
    expect(rec.writtenRows("pilot_sftp_files")[0]).toMatchObject({ state: "refused", error: "Unrecognized file" });
  });

  it("takes the same bytes once: a second name for an already-kept file settles as a duplicate and is not loaded again", async () => {
    const bytes = await quoteXlsx();
    const rec = ledger([{ org_id: ORG, id: "r1", remote_path: "/old/pq.xlsx", file_sha256: sha(bytes), storage_path: "org/kept.xlsx", state: "loaded" }]);
    const { d, store, ingestPrices } = deps([file("/pq-139445-11272026.xlsx")], { "/pq-139445-11272026.xlsx": bytes });
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ duplicate: 1 });
    expect(store).not.toHaveBeenCalled();
    expect(ingestPrices).not.toHaveBeenCalled();
    expect(rec.writtenRows("pilot_sftp_files")[0]).toMatchObject({ state: "duplicate", storage_path: "org/kept.xlsx" });
  });

  it("downloads nothing for a file already settled, and nothing at all from an empty folder", async () => {
    const f = file("/pq-139445-11272026.xlsx");
    const rec = ledger([{
      org_id: ORG, id: "r1", remote_path: f.path, remote_size: f.size, remote_mtime: f.mtime.toISOString(), state: "loaded", attempts: 1,
      reader_version: 1, file_sha256: "a".repeat(64), storage_path: "p",
    }]);
    const { d, read } = deps([f], {});
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ listed: 1, settled: 1 });
    expect(read).not.toHaveBeenCalled();

    const empty = deps([], {});
    expect(await runPilotSftp(ledger().client, ORG, empty.d)).toMatchObject({ listed: 0 });
    expect(empty.close).toHaveBeenCalled();
  });

  it("a failed download is a row with the reason, tried again until MAX_ATTEMPTS", async () => {
    const rec = ledger();
    const { d } = deps([file("/pq-139445-11272026.xlsx")], {});
    d.open = async () => ({ listFiles: async () => [file("/pq-139445-11272026.xlsx")], read: async () => { throw new Error("connection reset"); }, close: () => {} });
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ failed: 1 });
    expect(rec.writtenRows("pilot_sftp_files")[0]).toMatchObject({ state: "failed", error: "Download failed: connection reset" });
    const failed = { id: "x", remote_path: "/a", remote_size: 1, remote_mtime: "", state: "failed" as const, reader_version: 0, file_sha256: null, storage_path: null };
    expect(needsWork({ ...failed, attempts: MAX_ATTEMPTS - 1 }, "price_quote")).toBe(true);
    expect(needsWork({ ...failed, attempts: MAX_ATTEMPTS }, "price_quote")).toBe(false);
  });

  it("re-reads a held file from the kept copy, not from Pilot, once its kind has a newer reader", async () => {
    const bytes = await quoteXlsx();
    const f = file("/pq-139445-11272026.xlsx");
    const rec = ledger([{
      org_id: ORG, id: "r1", remote_path: f.path, remote_size: f.size, remote_mtime: f.mtime.toISOString(), state: "held", attempts: 1,
      reader_version: 0, file_sha256: sha(bytes), storage_path: "org-silvicom/2026-11-26/kept-pq.xlsx",
    }]);
    const fetchKept = vi.fn(async (_p: string) => bytes);
    const { d, read, ingestPrices } = deps([f], {}, { fetchKept });
    expect(await runPilotSftp(rec.client, ORG, d)).toMatchObject({ loaded: 1 });
    expect(fetchKept).toHaveBeenCalledWith("org-silvicom/2026-11-26/kept-pq.xlsx");
    expect(read).not.toHaveBeenCalled();
    expect(ingestPrices).toHaveBeenCalledTimes(1);
    expect(rec.writtenRows("pilot_sftp_files")[0]).toMatchObject({ state: "loaded", attempts: 2, reader_version: 1 });
    // A held file whose reader has not moved stays as it is.
    expect(needsWork({ id: "y", remote_path: "/t", remote_size: 1, remote_mtime: "", state: "held", attempts: 1, reader_version: 0, file_sha256: "a", storage_path: "p" }, "transactions")).toBe(false);
  });

  it("takes at most MAX_FILES_PER_RUN new files a run and leaves the rest for the next", async () => {
    const files = Array.from({ length: MAX_FILES_PER_RUN + 3 }, (_, i) => file(`/note-${i}.txt`, { mtime: new Date(NOW.getTime() - i * 60_000) }));
    const bytes = Object.fromEntries(files.map((f) => [f.path, Buffer.from(f.path)]));
    const { d, read } = deps(files, bytes);
    expect(await runPilotSftp(ledger().client, ORG, d)).toMatchObject({ held: MAX_FILES_PER_RUN, deferred: 3 });
    expect(read).toHaveBeenCalledTimes(MAX_FILES_PER_RUN);
  });
});
