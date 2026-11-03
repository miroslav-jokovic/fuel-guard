import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The backfill job is where ads and recruiting meet (B4a2): ads reads Meta, recruiting's sink stores. A job
 * that reported green while a lead was not brought in would be the "lost lead" §4R forbids, so any failure
 * fails it — naming lead ids, never a person.
 */
const ads = vi.hoisted(() => ({ backfillConnectionLeads: vi.fn() }));
const sinkMarker = vi.hoisted(() => ({ sink: { accept: vi.fn() } }));
vi.mock("../../modules/ads/index.js", () => ({ backfillConnectionLeads: ads.backfillConnectionLeads }));
vi.mock("../../modules/recruiting/index.js", () => ({ recruitingLeadSink: () => sinkMarker.sink }));

import { adsLeadsBackfillHandler } from "./adsLeadsBackfill.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: { tag: "admin" }, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown>): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "ads_leads_backfill", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;
const ok = { connection_id: "c1", since: "x", forms: 1, read: 2, stored_new: 1, duplicates: 1, failures: [] };

afterEach(() => vi.clearAllMocks());

describe("adsLeadsBackfillHandler", () => {
  it("hands recruiting's sink to the ads backfill for this org and connection", async () => {
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).resolves.toMatchObject({ ok: true });
    const [deps, org, conn, opts] = ads.backfillConnectionLeads.mock.calls[0]!;
    expect([deps.sink, deps.admin, org, conn, opts.since]).toEqual([sinkMarker.sink, ctx.admin, "org-1", "c1", undefined]);
  });

  it("passes an explicit since to close a longer outage", async () => {
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1", since: "2026-10-30T00:00:00Z" }), vi.fn());
    expect(ads.backfillConnectionLeads.mock.calls[0]![3].since.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("fails the job when anything was not brought in, naming the lead by id only", async () => {
    ads.backfillConnectionLeads.mockResolvedValue({ ...ok, failures: [{ campaign_id: "k1", form_id: "f1", reason: "sink", lead_id: "L9" }] });
    await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow("ads_leads_backfill: 1 not brought in (1 new, 1 already stored) — k1/f1/L9 sink");
  });

  it("refuses a job without a connection", async () => {
    await expect(adsLeadsBackfillHandler(ctx, job({}), vi.fn())).rejects.toThrow(/connectionId is required/);
    expect(ads.backfillConnectionLeads).not.toHaveBeenCalled();
  });
});
