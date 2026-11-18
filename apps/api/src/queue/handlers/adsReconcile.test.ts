import { afterEach, describe, expect, it, vi } from "vitest";

/** A mismatch is the reconcile's answer (recorded, rung, done); only what could not be compared fails the job. */
const ads = vi.hoisted(() => ({ reconcileConnection: vi.fn(), watchTokenExpiry: vi.fn() }));
vi.mock("../../modules/ads/index.js", () => ({ reconcileConnection: ads.reconcileConnection, watchTokenExpiry: ads.watchTokenExpiry }));

import { adsReconcileHandler } from "./adsReconcile.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown>): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "ads_reconcile", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;
const result = (failures: Array<{ campaign_id?: string; reason: string }>) =>
  ({ connection_id: "c1", insights: null, compared: 2, recorded: [{ field: "status", meta_id: "m1" }], already_recorded: 0, failures });

afterEach(() => vi.clearAllMocks());
const tokenRead = { kind: "read", expiry: { read: true }, days_left: 9, alerted: true };

describe("adsReconcileHandler", () => {
  it("is done when mismatches were found and recorded", async () => {
    ads.watchTokenExpiry.mockResolvedValue(tokenRead);
    ads.reconcileConnection.mockResolvedValue(result([]));
    await expect(adsReconcileHandler(ctx, job({ connectionId: "c1" }), vi.fn())).resolves.toMatchObject({ ok: true });
    expect(ads.reconcileConnection.mock.calls[0]!.slice(1)).toEqual(["org-1", "c1"]);
  });

  it("reads the connection's token expiry first, for the same connection, and reports it (A-8)", async () => {
    ads.watchTokenExpiry.mockResolvedValue(tokenRead);
    ads.reconcileConnection.mockResolvedValue(result([{ reason: "account_campaigns" }]));
    await expect(adsReconcileHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow();
    expect(ads.watchTokenExpiry.mock.calls[0]!.slice(1)).toEqual(["org-1", "c1"]);
    ads.reconcileConnection.mockResolvedValue(result([]));
    const done = await adsReconcileHandler(ctx, job({ connectionId: "c1" }), vi.fn());
    expect(JSON.parse((done as { detail: string }).detail).token).toEqual({ days_left: 9, alerted: true, read: true });
  });

  it("fails, naming what could not be compared", async () => {
    ads.watchTokenExpiry.mockResolvedValue(tokenRead);
    ads.reconcileConnection.mockResolvedValue(result([{ campaign_id: "c9", reason: "graph:rate_limited" }, { reason: "account_campaigns" }]));
    await expect(adsReconcileHandler(ctx, job({ connectionId: "c1" }), vi.fn())).rejects.toThrow(
      "ads_reconcile: 2 not compared (2 compared, 1 new mismatch(es) recorded) — c9 graph:rate_limited; account_campaigns",
    );
  });

  it("refuses a job without a connection", async () => {
    await expect(adsReconcileHandler(ctx, job({}), vi.fn())).rejects.toThrow("payload.connectionId is required");
  });
});
