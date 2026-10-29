import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobContext, QueueJob } from "../types.js";

// Hoisted so the vi.mock factories (also hoisted) can reference them.
const h = vi.hoisted(() => ({
  executeRead: vi.fn(),
  failUnavailableRead: vi.fn(),
  gate: vi.fn(),
  warm: vi.fn(),
  engines: 0,
}));

vi.mock("../../modules/document-reading/index.js", async (orig) => {
  const real = await orig<typeof import("../../modules/document-reading/index.js")>();
  // The engine the handler builds: counted, and warmed through `h.warm`, so no test starts the real models.
  const ocrEngine = () => (h.engines++, Object.assign(async () => null, { warm: () => h.warm() }));
  return { ...real, executeRead: h.executeRead, failUnavailableRead: h.failUnavailableRead, ocrEngine };
});
vi.mock("../../modules/hazmat/index.js", () => ({ shippingDocumentReadGate: h.gate }));
vi.mock("../../lib/anthropic.js", () => ({ anthropicClient: () => ({ messages: { create: vi.fn() } }) }));

const { documentReadHandler, warmDocumentReadOcr } = await import("./documentRead.js");
const { TransientModelError } = await import("../../modules/document-reading/index.js");

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (attempts: number, payload: Record<string, unknown> = { readId: "read-1" }): QueueJob =>
  ({ id: "job-1", org_id: "org-1", kind: "document_read", payload, attempts, max_attempts: 3 });
const report = async () => undefined;

describe("document_read handler — one [metrics] line per read (TWO-CLICK-READER-PLAN TC0.2)", () => {
  beforeEach(() => h.executeRead.mockReset());
  const logged = async (outcome: unknown) => {
    h.executeRead.mockResolvedValue(outcome);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await documentReadHandler(ctx, job(1), report);
      return log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[metrics] "));
    } finally {
      log.mockRestore();
    }
  };

  it("logs a finished read's stages, tokens and pages as one greppable JSON line", async () => {
    const stageTimings = { classify: 900, fetch: 300, passA: 9000, passB: 14000, ocr: 31000, evidence: 40 };
    const lines = await logged({ outcome: "done", cacheHit: false, inputTokens: 30_000, outputTokens: 4000, pages: 2, stageTimings });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.slice("[metrics] ".length))).toEqual({
      documentRead: "read-1", outcome: "done", pages: 2, inputTokens: 30_000, outputTokens: 4000, stagesMs: stageTimings,
    });
  });

  it("names a cache hit and a failure by what they were", async () => {
    const hit = await logged({ outcome: "done", cacheHit: true, inputTokens: 0, outputTokens: 0, pages: 1, stageTimings: { fetch: 5 } });
    expect(JSON.parse(hit[0]!.slice(10)).outcome).toBe("cache_hit");
    const failed = await logged({ outcome: "failed", code: "refusal", inputTokens: 10, outputTokens: 1, stageTimings: {} });
    expect(JSON.parse(failed[0]!.slice(10))).toMatchObject({ outcome: "failed:refusal", stagesMs: {} });
  });

  it("logs nothing for a read it skipped", async () => {
    expect(await logged({ outcome: "skipped", reason: "already_terminal" })).toEqual([]);
  });
});

describe("warmDocumentReadOcr — the OCR models load at boot, not in the first read (TC0.3)", () => {
  const env = (witness: "on" | "off") => ({ DOC_OCR_WITNESS: witness }) as unknown as JobContext["env"];

  it("does nothing, and builds no engine, when the OCR witness is off", async () => {
    const lines: string[] = [];
    const before = h.engines;
    await warmDocumentReadOcr(env("off"), (l) => lines.push(l));
    expect(lines).toEqual([]);
    expect(h.engines).toBe(before);
  });

  it("warms the one engine the reads will use, and says how long it took", async () => {
    h.warm.mockResolvedValue(true);
    const lines: string[] = [];
    await warmDocumentReadOcr(env("on"), (l) => lines.push(l));
    await warmDocumentReadOcr(env("on"), (l) => lines.push(l));
    expect(h.engines).toBe(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[document-ocr\] engine warm in \d+ ms$/);
  });

  it("logs a warm that failed or threw, and never throws itself", async () => {
    const lines: string[] = [];
    h.warm.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("download refused"));
    await warmDocumentReadOcr(env("on"), (l) => lines.push(l));
    await expect(warmDocumentReadOcr(env("on"), (l) => lines.push(l))).resolves.toBeUndefined();
    for (const l of lines) expect(l).toMatch(/engine did not warm .*the first read will start it/);
  });
});

describe("document_read handler (Step 1.6)", () => {
  beforeEach(() => {
    h.executeRead.mockReset();
    h.failUnavailableRead.mockReset();
    h.gate.mockReset();
  });

  it("refuses a job with no readId", async () => {
    await expect(documentReadHandler(ctx, job(1, {}), report)).rejects.toThrow(/no readId/);
  });

  it("returns the read's outcome as the job's stats", async () => {
    h.executeRead.mockResolvedValue({ outcome: "done", cacheHit: false, inputTokens: 9, outputTokens: 1, pages: 2, stageTimings: { fetch: 3 } });
    expect(await documentReadHandler(ctx, job(1), report)).toEqual({ readId: "read-1", outcome: "done", cacheHit: false, inputTokens: 9, outputTokens: 1, pages: 2, stageTimings: { fetch: 3 } });
    expect(h.executeRead.mock.calls[0]!.slice(0, 3)).toEqual([ctx.admin, "org-1", "read-1"]);
  });

  it("wires the shipping document's gate to the Hazmat Calculator's, with the job's org", async () => {
    h.executeRead.mockImplementation(async (admin, org, _id, deps) => deps.gateFor(admin, org, "shipping_document"));
    h.gate.mockResolvedValue({ open: true, monthlyTokenBudget: null });
    await documentReadHandler(ctx, job(1), report);
    expect(h.gate).toHaveBeenCalledWith(ctx.admin, "org-1");
  });

  it("rethrows a transient error before the last attempt, leaving the read for the queue's retry", async () => {
    h.executeRead.mockRejectedValue(new TransientModelError(429, new Error("rate limited")));
    await expect(documentReadHandler(ctx, job(2), report)).rejects.toBeInstanceOf(TransientModelError);
    expect(h.failUnavailableRead).not.toHaveBeenCalled();
  });

  it("ends the read model_unavailable on the last attempt, then rethrows so the job records it too", async () => {
    h.executeRead.mockRejectedValue(new TransientModelError(529, new Error("overloaded")));
    await expect(documentReadHandler(ctx, job(3), report)).rejects.toBeInstanceOf(TransientModelError);
    expect(h.failUnavailableRead).toHaveBeenCalledWith(ctx.admin, "org-1", "read-1");
  });

  it("ends the read on a failure no retry mends — on the FIRST attempt — and still rethrows it for the job's error", async () => {
    // 10/12/2026, production: "credit balance is too low" left both of the owner's reads `reading` for ever.
    for (const err of [new Error('400 {"message":"Your credit balance is too low"}'), new Error("401 invalid x-api-key")]) {
      h.failUnavailableRead.mockReset();
      h.executeRead.mockRejectedValue(err);
      // The read's ending failing too must not replace the error that killed the job.
      h.failUnavailableRead.mockRejectedValue(new Error("transition refused"));
      await expect(documentReadHandler(ctx, job(1), report)).rejects.toBe(err);
      expect(h.failUnavailableRead).toHaveBeenCalledWith(ctx.admin, "org-1", "read-1");
    }
  });
});
