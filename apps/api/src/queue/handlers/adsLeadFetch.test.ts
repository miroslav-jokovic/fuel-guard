import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook's fetch job is where ads meets recruiting (B4b), like the backfill's. A job that went green
 * while its lead was not brought in would be the lost lead §4R forbids, so a failed fetch fails the job —
 * the queue retries it with backoff, and the hourly backfill reads the same lead regardless.
 */
const ads = vi.hoisted(() => ({ fetchWebhookLead: vi.fn() }));
const sinkMarker = vi.hoisted(() => ({ sink: { accept: vi.fn() } }));
vi.mock("../../modules/ads/index.js", () => ({ fetchWebhookLead: ads.fetchWebhookLead }));
vi.mock("../../modules/recruiting/index.js", () => ({ recruitingLeadSink: () => sinkMarker.sink }));

import { adsLeadFetchHandler } from "./adsLeadFetch.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: { tag: "admin" }, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown>): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "ads_lead_fetch", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;

afterEach(() => vi.clearAllMocks());

describe("adsLeadFetchHandler", () => {
  it("hands recruiting's sink and a clock to the ads fetch for this org and lead", async () => {
    ads.fetchWebhookLead.mockResolvedValue({ outcome: "stored", lead_id: "L1", campaign_id: "k1" });
    await expect(adsLeadFetchHandler(ctx, job({ leadgenId: "L1", formId: "F1" }), vi.fn())).resolves.toMatchObject({ ok: true });
    const [deps, org, ask] = ads.fetchWebhookLead.mock.calls[0]!;
    expect([deps.sink, deps.admin, org, ask]).toEqual([sinkMarker.sink, ctx.admin, "org-1", { leadgenId: "L1", formId: "F1" }]);
    // MetaGraph takes the clock as given: without one every read throws `this.o.now is not a function`.
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it("fails the job when the lead was not brought in, so the queue retries it", async () => {
    ads.fetchWebhookLead.mockRejectedValue(new Error("ads_lead_fetch: lead L1 not brought in — graph:token_invalid"));
    await expect(adsLeadFetchHandler(ctx, job({ leadgenId: "L1", formId: "F1" }), vi.fn())).rejects.toThrow("lead L1 not brought in");
  });

  it("refuses a job without a lead or a form", async () => {
    await expect(adsLeadFetchHandler(ctx, job({ leadgenId: "L1" }), vi.fn())).rejects.toThrow(/leadgenId and payload.formId are required/);
    expect(ads.fetchWebhookLead).not.toHaveBeenCalled();
  });
});
