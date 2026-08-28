import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * The refetch service's own promises, with the SOAP and ingest layers mocked (each has its own
 * suite): it resumes a budget-cut range from the last completed page instead of stopping mid-hole,
 * it reports a zero-row window as `empty` (a measurement — the January probe's answer), and it
 * never touches the live feed's cursor columns.
 */
vi.mock("../lib/efsSoap.js", () => ({ fetchPostedTransactions: vi.fn() }));
vi.mock("./efsIngest.js", () => ({ ingestReport: vi.fn() }));
vi.mock("./efsProcessing.js", () => ({ registerEfsProcessingRun: vi.fn(async () => "proc-1") }));
vi.mock("./efsSoapCredentials.js", () => ({
  getEfsSoapCredentials: vi.fn(async () => ({ orgId: "org-1", enabled: true })),
}));

import { fetchPostedTransactions } from "../lib/efsSoap.js";
import { ingestReport } from "./efsIngest.js";
import { runEfsWindowRefetch } from "./efsWindowRefetch.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv({ EFS_SOAP_ENABLED: true });
const fetchMock = vi.mocked(fetchPostedTransactions);
const ingestMock = vi.mocked(ingestReport);

const fetchResult = (over: Partial<Awaited<ReturnType<typeof fetchPostedTransactions>>>) => ({
  rows: [] as Record<string, string | number | null | undefined>[],
  nextCursor: null as string | null,
  responseHash: "a".repeat(64),
  pagesFetched: 1,
  moreAvailable: false,
  windowsOutstanding: 1,
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  ingestMock.mockReset();
  ingestMock.mockResolvedValue({ kind: "transaction", importId: "imp-1", alreadyImported: false, newFuel: 2 } as never);
});

describe("runEfsWindowRefetch", () => {
  it("resumes a budget-cut range from the last completed page until the window is exhausted", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    fetchMock
      .mockResolvedValueOnce(fetchResult({
        rows: [{ TransactionId: "1" }],
        pagesFetched: 2,
        moreAvailable: true,
        nextCursor: "2026-04-25T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(fetchResult({
        rows: [{ TransactionId: "2" }],
        pagesFetched: 1,
        moreAvailable: false,
        nextCursor: "2026-05-05T00:00:00.000Z",
      }));

    const { windows } = await runEfsWindowRefetch(rec.client, env, ORG, [
      { start: "2026-04-18T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second call resumes from the last COMPLETED page, not from the window's start.
    expect(fetchMock.mock.calls[1]![3]).toMatchObject({
      windowOverride: { start: "2026-04-25T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    });
    expect(ingestMock).toHaveBeenCalledTimes(2);
    expect(windows[0]).toMatchObject({ status: "ingested", pagesFetched: 3, rowsFetched: 2, newFuel: 4 });
    // The live feed's cursor columns are untouched — no efs_soap_credentials write happened.
    expect(rec.writes().filter((q) => q.table === "efs_soap_credentials")).toEqual([]);
  });

  it("reports a zero-row window as empty — the January probe's answer, not a failure", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    fetchMock.mockResolvedValueOnce(fetchResult({ rows: [], pagesFetched: 5 }));
    const { windows } = await runEfsWindowRefetch(rec.client, env, ORG, [
      { start: "2026-01-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" },
    ]);
    expect(windows[0]).toMatchObject({ status: "empty", pagesFetched: 5, rowsFetched: 0 });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("a window that throws fails ONLY that window; the next window still runs", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    fetchMock
      .mockRejectedValueOnce(new Error("EFS fault"))
      .mockResolvedValueOnce(fetchResult({ rows: [{ TransactionId: "3" }] }));
    const { windows } = await runEfsWindowRefetch(rec.client, env, ORG, [
      { start: "2026-04-18T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
      { start: "2026-05-06T00:00:00.000Z", end: "2026-05-19T00:00:00.000Z" },
    ]);
    expect(windows[0]).toMatchObject({ status: "failed", error: "EFS fault" });
    expect(windows[1]).toMatchObject({ status: "ingested", rowsFetched: 1 });
  });

  it("an unrecognised response shape fails the window instead of writing bad rows", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    fetchMock.mockResolvedValueOnce(fetchResult({ rows: [{ Bogus: "x" }] }));
    ingestMock.mockResolvedValueOnce({ kind: "unknown" } as never);
    const { windows } = await runEfsWindowRefetch(rec.client, env, ORG, [
      { start: "2026-04-18T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    ]);
    expect(windows[0]!.status).toBe("failed");
    expect(windows[0]!.error).toMatch(/field signature/);
  });
});
