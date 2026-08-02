import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WQ1c handler tests — focus on the migration-specific logic: the `full`/`refreshIdle` payload branches,
 * actor-gated audit, and the NoSamsaraToken → skip (not fail) contract. The underlying sync services are
 * mocked; we assert which ones each handler drives and what it returns/audits.
 */

// A real error class shared by handler + test so `instanceof` matches through the mocked module.
// Hoisted so the vi.mock factory (also hoisted) can reference it.
const { NoSamsaraTokenError } = vi.hoisted(() => ({ NoSamsaraTokenError: class extends Error {} }));

const vehicleSync = vi.hoisted(() => ({
  syncVehiclesFromSamsara: vi.fn(),
  syncVehicleStatsFromSamsara: vi.fn(),
}));
const trailerSync = vi.hoisted(() => ({ syncTrailersFromSamsara: vi.fn() }));
const idleSync = vi.hoisted(() => ({ syncIdleEvents: vi.fn() }));
const idleCap = vi.hoisted(() => ({ syncIdleCapabilities: vi.fn() }));
const driverSync = vi.hoisted(() => ({ syncDriversFromSamsara: vi.fn() }));
const scoreSync = vi.hoisted(() => ({ syncDriverScores: vi.fn(), syncRecentDriverScoreWeeks: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));

vi.mock("../../samsaraVehicleSync.js", () => ({
  syncVehiclesFromSamsara: vehicleSync.syncVehiclesFromSamsara,
  syncVehicleStatsFromSamsara: vehicleSync.syncVehicleStatsFromSamsara,
  NoSamsaraTokenError,
}));
vi.mock("../../samsaraTrailerSync.js", () => trailerSync);
vi.mock("../../idleSync.js", () => idleSync);
vi.mock("../../idleCapabilitySync.js", () => idleCap);
vi.mock("../../samsaraDriverSync.js", () => driverSync);
vi.mock("../../driverScoreSync.js", () => scoreSync);
vi.mock("../../driverPerformanceSnapshot.js", () => ({ snapshotSettledWeeks: vi.fn() }));
vi.mock("../../nightlyReconcile.js", () => ({ runNightlyReconcile: vi.fn() }));
vi.mock("../../../lib/audit.js", () => audit);

import {
  syncDriverScoresHandler,
  syncDriversHandler,
  syncStatsHandler,
  syncVehiclesHandler,
} from "./samsara.js";
import type { JobContext, QueueJob } from "../types.js";

// Fake admin whose only used surface is integration_credentials.update().eq() in the identity branch.
const lastSyncedEq = vi.fn().mockResolvedValue({ error: null });
const admin = {
  from: () => ({ update: () => ({ eq: lastSyncedEq }) }),
} as unknown as JobContext["admin"];
const ctx = { admin, env: {} } as unknown as JobContext;

const job = (kind: string, payload: Record<string, unknown> = {}): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind, payload, attempts: 1, max_attempts: 5 } as unknown as QueueJob);

afterEach(() => vi.clearAllMocks());

describe("syncVehiclesHandler", () => {
  it("full: runs the compound sync (trailers + idle + scores) and audits when an actor is present", async () => {
    vehicleSync.syncVehiclesFromSamsara.mockResolvedValue({ total: 10, created: 2, updated: 3, assigned: 4, needsCompletion: [] });
    trailerSync.syncTrailersFromSamsara.mockResolvedValue({ total: 1, created: 0, updated: 1, paired: 1 });
    idleSync.syncIdleEvents.mockResolvedValue({ fetched: 5, upserted: 5 });
    scoreSync.syncDriverScores.mockResolvedValue({ upserted: 6, safetyOk: true, efficiencyOk: true });
    driverSync.syncDriversFromSamsara.mockResolvedValue({ total: 3, created: 0, updated: 3 });

    const out = await syncVehiclesHandler(ctx, job("sync_vehicles", { full: true, actorId: "u1" }), async () => {});

    expect(driverSync.syncDriversFromSamsara).toHaveBeenCalled();
    expect(trailerSync.syncTrailersFromSamsara).toHaveBeenCalled();
    expect(idleSync.syncIdleEvents).toHaveBeenCalled();
    expect(scoreSync.syncDriverScores).toHaveBeenCalled();
    expect(lastSyncedEq).not.toHaveBeenCalled(); // full path does NOT stamp last_synced_at
    expect(audit.writeAudit).toHaveBeenCalledWith(admin, expect.objectContaining({ action: "integration.samsara.vehicles_synced", actorId: "u1" }));
    expect(out).toEqual({ total: 10, created: 2, updated: 3, assigned: 4, needsCompletion: 0 });
  });

  it("identity (no full): drivers + vehicles only, stamps last_synced_at, no audit without an actor", async () => {
    vehicleSync.syncVehiclesFromSamsara.mockResolvedValue({ total: 10, created: 2, updated: 3, assigned: 4, needsCompletion: [] });
    driverSync.syncDriversFromSamsara.mockResolvedValue({ total: 3, created: 0, updated: 3 });

    await syncVehiclesHandler(ctx, job("sync_vehicles", {}), async () => {});

    expect(driverSync.syncDriversFromSamsara).toHaveBeenCalled();
    expect(trailerSync.syncTrailersFromSamsara).not.toHaveBeenCalled();
    expect(idleSync.syncIdleEvents).not.toHaveBeenCalled();
    expect(scoreSync.syncDriverScores).not.toHaveBeenCalled();
    expect(lastSyncedEq).toHaveBeenCalledWith("org_id", "org-1");
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("a missing Samsara token is a skip, not a failure", async () => {
    driverSync.syncDriversFromSamsara.mockResolvedValue({ total: 0, created: 0, updated: 0 });
    vehicleSync.syncVehiclesFromSamsara.mockRejectedValue(new NoSamsaraTokenError("no token"));
    const out = await syncVehiclesHandler(ctx, job("sync_vehicles", { full: true }), async () => {});
    expect(out).toEqual({ skipped: "no_samsara_token" });
  });
});

describe("syncDriverScoresHandler — refreshIdle gate", () => {
  const scores = { weeks: 1, totalUpserted: 7, results: [{ weekStart: "2026-07-27", drivers: 3, safetyOk: true, efficiencyOk: false }] };

  it("refreshes idle only when payload.refreshIdle is set (manual button)", async () => {
    scoreSync.syncRecentDriverScoreWeeks.mockResolvedValue(scores);
    idleSync.syncIdleEvents.mockResolvedValue({ fetched: 1, upserted: 1 });
    const out = await syncDriverScoresHandler(ctx, job("sync_driver_scores", { refreshIdle: true, actorId: "u1" }), async () => {});
    expect(idleSync.syncIdleEvents).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ upserted: 7, safetyOk: true, efficiencyOk: false, weekStart: "2026-07-27" });
    expect(audit.writeAudit).toHaveBeenCalled();
  });

  it("does NOT refresh idle for the scheduler tier (no flag) — idle is its own tier", async () => {
    scoreSync.syncRecentDriverScoreWeeks.mockResolvedValue(scores);
    await syncDriverScoresHandler(ctx, job("sync_driver_scores", {}), async () => {});
    expect(idleSync.syncIdleEvents).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });
});

describe("syncStatsHandler / syncDriversHandler", () => {
  it("stats returns the updated count", async () => {
    vehicleSync.syncVehicleStatsFromSamsara.mockResolvedValue({ updated: 9 });
    expect(await syncStatsHandler(ctx, job("sync_stats"), async () => {})).toEqual({ updated: 9 });
  });

  it("drivers audits only with an actor", async () => {
    driverSync.syncDriversFromSamsara.mockResolvedValue({ total: 3, created: 1, updated: 2 });
    await syncDriversHandler(ctx, job("sync_drivers", {}), async () => {});
    expect(audit.writeAudit).not.toHaveBeenCalled();
    await syncDriversHandler(ctx, job("sync_drivers", { actorId: "u1" }), async () => {});
    expect(audit.writeAudit).toHaveBeenCalledWith(admin, expect.objectContaining({ action: "integration.samsara.drivers_synced" }));
  });
});
