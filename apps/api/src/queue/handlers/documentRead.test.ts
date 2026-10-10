import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobContext, QueueJob } from "../types.js";

// Hoisted so the vi.mock factories (also hoisted) can reference them.
const h = vi.hoisted(() => ({
  executeRead: vi.fn(),
  failUnavailableRead: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("../../modules/document-reading/index.js", async (orig) => {
  const real = await orig<typeof import("../../modules/document-reading/index.js")>();
  return { ...real, executeRead: h.executeRead, failUnavailableRead: h.failUnavailableRead };
});
vi.mock("../../modules/hazmat/index.js", () => ({ shippingDocumentReadGate: h.gate }));
vi.mock("../../lib/anthropic.js", () => ({ anthropicClient: () => ({ messages: { create: vi.fn() } }) }));

const { documentReadHandler } = await import("./documentRead.js");
const { TransientModelError } = await import("../../modules/document-reading/index.js");

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (attempts: number, payload: Record<string, unknown> = { readId: "read-1" }): QueueJob =>
  ({ id: "job-1", org_id: "org-1", kind: "document_read", payload, attempts, max_attempts: 3 });
const report = async () => undefined;

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
    h.executeRead.mockResolvedValue({ outcome: "done", cacheHit: false, inputTokens: 9, outputTokens: 1, pages: 2 });
    expect(await documentReadHandler(ctx, job(1), report)).toEqual({ readId: "read-1", outcome: "done", cacheHit: false, inputTokens: 9, outputTokens: 1, pages: 2 });
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

  it("never turns a configuration error into a read failure", async () => {
    h.executeRead.mockRejectedValue(new Error("401 invalid x-api-key"));
    await expect(documentReadHandler(ctx, job(3), report)).rejects.toThrow(/401/);
    expect(h.failUnavailableRead).not.toHaveBeenCalled();
  });
});
