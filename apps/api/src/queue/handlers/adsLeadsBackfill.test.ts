import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../testing/postgrestFixture.js";

/**
 * The backfill job is where ads and recruiting meet (B4a2): ads reads Meta, recruiting's sink stores. A job
 * that reported green while a lead was not brought in would be the "lost lead" §4R forbids, so any failure
 * fails it — naming lead ids, never a person.
 */
const ads = vi.hoisted(() => ({ backfillConnectionLeads: vi.fn(), alertBackfillStale: vi.fn() }));
const sinkMarker = vi.hoisted(() => ({ sink: { accept: vi.fn() } }));
// The real `catchUpSince` and dedup key: how far back a run reaches is what the catch-up tests are about.
vi.mock("../../modules/ads/index.js", async () => {
  const { catchUpSince } = await import("../../modules/ads/leads/backfill.js");
  return { backfillConnectionLeads: ads.backfillConnectionLeads, alertBackfillStale: ads.alertBackfillStale, catchUpSince, adsLeadsBackfillDedupKey: (c: string) => `ads_leads_backfill:${c}` };
});
vi.mock("../../modules/recruiting/index.js", () => ({ recruitingLeadSink: () => sinkMarker.sink }));

import { adsLeadsBackfillHandler } from "./adsLeadsBackfill.js";
import type { JobContext, QueueJob } from "../types.js";

let jobs: FixtureRow[] = [];
let ctx: JobContext;
beforeEach(() => {
  jobs = [];
  ctx = { admin: createSupabaseRecorder({ tables: { jobs: (q) => postgrestFixture(jobs)(q) } }).client, env: {} } as unknown as JobContext;
});
const done = (connection: string, started_at: string, org = "org-1", status = "done") =>
  ({ id: `j-${jobs.length}`, org_id: org, kind: "ads_leads_backfill", dedup_key: `ads_leads_backfill:${connection}`, status, started_at });
const reach = () => (ads.backfillConnectionLeads.mock.calls[0]![3].since as Date);
const job = (payload: Record<string, unknown>): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "ads_leads_backfill", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;
const ok = { connection_id: "c1", since: "x", forms: 1, read: 2, stored_new: 1, duplicates: 1, failures: [] };

afterEach(() => vi.clearAllMocks());

describe("adsLeadsBackfillHandler", () => {
  it("hands recruiting's sink to the ads backfill for this org and connection", async () => {
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).resolves.toMatchObject({ ok: true });
    const [deps, org, conn] = ads.backfillConnectionLeads.mock.calls[0]!;
    expect([deps.sink, deps.admin, org, conn]).toEqual([sinkMarker.sink, ctx.admin, "org-1", "c1"]);
  });

  it("reaches back to an hour before this connection's last complete run, past failed runs and other connections' runs", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T15:00:00Z"), toFake: ["Date"] });
    jobs = [
      done("c1", "2026-10-31T09:00:00Z"),
      done("c1", "2026-11-02T09:00:00Z", "org-1", "failed"),
      done("c2", "2026-11-03T14:00:00Z"),
      done("c1", "2026-11-03T14:00:00Z", "org-2"),
    ];
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn());
    expect(reach().toISOString()).toBe("2026-10-31T08:00:00.000Z");
    vi.useRealTimers();
  });

  it("an hour after a complete run, the 48-hour window; with none on record, everything Meta keeps", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T15:00:00Z"), toFake: ["Date"] });
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    jobs = [done("c1", "2026-11-03T14:00:00Z")];
    await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn());
    expect(reach().toISOString()).toBe("2026-11-01T15:00:00.000Z");
    ads.backfillConnectionLeads.mockClear();
    jobs = [];
    await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn());
    expect(reach().toISOString()).toBe("2026-08-05T15:00:00.000Z");
    vi.useRealTimers();
  });

  it("passes an explicit since to close a longer outage", async () => {
    ads.backfillConnectionLeads.mockResolvedValue(ok);
    await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1", since: "2026-10-30T00:00:00Z" }), vi.fn());
    expect(ads.backfillConnectionLeads.mock.calls[0]![3].since.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("a failure of the whole connection fails the job and is named by its reason alone", async () => {
    ads.backfillConnectionLeads.mockResolvedValue({ ...ok, failures: [{ reason: "connection:disconnected" }] });
    await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow("— connection:disconnected");
  });

  it("fails the job when anything was not brought in, naming the lead by id only", async () => {
    ads.backfillConnectionLeads.mockResolvedValue({ ...ok, failures: [{ campaign_id: "k1", form_id: "f1", reason: "sink", lead_id: "L9" }] });
    await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow("ads_leads_backfill: 1 not brought in (1 new, 1 already stored) — k1/f1/L9 sink");
  });

  describe("a run that failed asks whether the connection has been failing for hours (D2d)", () => {
    const NOW = new Date("2026-11-03T15:00:00Z");
    const LAST = "2026-11-03T09:00:00Z";
    beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
    afterEach(() => vi.useRealTimers());
    const asked = () => ads.alertBackfillStale.mock.calls.map((c) => [c[1], c[2], (c[3] as Date | null)?.toISOString() ?? null, c[4]]);

    it("with this connection's last done run, when the run reports failures", async () => {
      jobs = [done("c1", LAST), done("c2", "2026-11-03T14:00:00Z")];
      ads.backfillConnectionLeads.mockResolvedValue({ ...ok, failures: [{ reason: "connection:disconnected" }] });
      await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow("connection:disconnected");
      expect(asked()).toEqual([["org-1", "c1", "2026-11-03T09:00:00.000Z", NOW]]);
    });

    it("when the run throws, and the job still fails with the run's own error", async () => {
      ads.backfillConnectionLeads.mockRejectedValue(new Error("graph down"));
      await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow("graph down");
      expect(asked()).toEqual([["org-1", "c1", null, NOW]]);
    });

    it("with an operator's explicit since too, because the outage is the same outage", async () => {
      jobs = [done("c1", LAST)];
      ads.backfillConnectionLeads.mockResolvedValue({ ...ok, failures: [{ reason: "x" }] });
      await expect(adsLeadsBackfillHandler(ctx, job({ connectionId: "c1", since: "2026-10-01T00:00:00Z" }), vi.fn())).rejects.toThrow();
      expect(asked()[0]![2]).toBe("2026-11-03T09:00:00.000Z");
    });

    it("a run that worked asks nothing", async () => {
      ads.backfillConnectionLeads.mockResolvedValue(ok);
      await adsLeadsBackfillHandler(ctx, job({ connectionId: "c1" }), vi.fn());
      expect(ads.alertBackfillStale).not.toHaveBeenCalled();
    });
  });

  it("refuses a job without a connection", async () => {
    await expect(adsLeadsBackfillHandler(ctx, job({}), vi.fn())).rejects.toThrow(/connectionId is required/);
    expect(ads.backfillConnectionLeads).not.toHaveBeenCalled();
  });
});
