import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The insights job (B5a) must never report green while an hour was not brought in: a failed job is how a
 * campaign Meta refused to report, or a zone we cannot convert, gets listed. Its failure line names
 * campaigns and reasons only.
 */
const ads = vi.hoisted(() => ({ pullConnectionInsights: vi.fn() }));
vi.mock("../../modules/ads/index.js", () => ({ pullConnectionInsights: ads.pullConnectionInsights }));

import { adsInsightsHandler } from "./adsInsights.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown>): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "ads_insights", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;
const result = (failures: Array<{ campaign_id?: string; reason: string }>) =>
  ({ connection_id: "c1", zone: "America/Chicago", days: [], campaigns: 2, hours_written: 5, hours_zeroed: 0, failures });

afterEach(() => vi.clearAllMocks());

describe("adsInsightsHandler", () => {
  it("pulls this org's connection with a fixed clock, and passes a widened window through", async () => {
    ads.pullConnectionInsights.mockResolvedValue(result([]));
    await expect(adsInsightsHandler(ctx, job({ connectionId: "c1", days: 28 }), vi.fn())).resolves.toMatchObject({ ok: true });
    const [deps, org, conn, opts] = ads.pullConnectionInsights.mock.calls[0]!;
    expect([org, conn, opts, typeof deps.now, deps.now() instanceof Date]).toEqual(["org-1", "c1", { days: 28 }, "function", true]);
  });

  it("fails the job, naming each campaign and reason, when anything was not brought in", async () => {
    ads.pullConnectionInsights.mockResolvedValue(result([{ campaign_id: "camp-b", reason: "graph:token_invalid" }, { reason: "zone" }]));
    await expect(adsInsightsHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow(
      "ads_insights: 2 not brought in (5 hours written, 0 zeroed) — camp-b graph:token_invalid; zone",
    );
  });

  it("refuses a job without a connection", async () => {
    await expect(adsInsightsHandler(ctx, job({}), vi.fn())).rejects.toThrow("payload.connectionId is required");
    expect(ads.pullConnectionInsights).not.toHaveBeenCalled();
  });
});
