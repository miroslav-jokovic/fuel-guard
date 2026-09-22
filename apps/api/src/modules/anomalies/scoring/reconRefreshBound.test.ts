import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TxnView, VehicleView } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import type { FtxnRow, ScoreOpts } from "./loaders.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * Q6c — the refresh bound on settled Samsara evidence (`SAMSARA_RECON_REFRESH_HOURS`).
 *
 * `scoreImport` passes no `skipRecon` and, unlike the collector tier, had NO bound at all, so every
 * re-score of an import re-fetched every one of its fills. Three stuck processing runs turned that
 * into 47,522 live reconciliations a day against fills four to nine months old — ~11.4 passes per
 * fill per day, `samsara_recon_evidence_version` reaching 235.
 *
 * The bound was measured before it was written: the production reconciler, re-run READ-ONLY over 55
 * fills from those imports (30 `tank_confirmed`, all 25 `stop_estimated`, January to May, 56–199
 * previous refreshes), returned evidence identical to what was stored in 55 of 55 cases.
 *
 * ⚠ THE ASSERTION THAT MATTERS MOST IS THE EXEMPTION, not the skip. The collector tier
 * (`claimReconBatch`) exists to close a historical hole and selects fills on `samsara_recon_at is
 * null`. A bound that keyed on "was this checked recently" ALONE would refuse the tier's own claims
 * — the tier would claim a fill and the reconciler would decline to fetch it, silently undoing
 * SAM-S3. Keying on "has this fill ever SUCCEEDED" makes the two populations disjoint by
 * construction, and that is what these tests pin.
 */
const mocks = vi.hoisted(() => ({ reconcileWithSamsara: vi.fn() }));
// reconcile.ts imports these through the samsara module index (2026-08-26 carve-out) — the mock
// must target that specifier or it silently stops applying.
vi.mock("../../samsara/index.js", () => ({
  reconcileWithSamsara: mocks.reconcileWithSamsara,
  SamsaraUnavailableError: class SamsaraUnavailableError extends Error {},
}));

const { resolveReconciliation } = await import("./reconcile.js");

const ORG = "org1";
const vehicle: VehicleView = { id: "v1", fuelType: "diesel", tankCapacityGal: 240, baselineMpg: 6.2 };

const txn = (): TxnView =>
  ({
    id: "t1",
    vehicleId: "v1",
    fueledAt: "2026-01-14T12:00:00Z",
    fueledAtPrecision: "instant",
    gallons: 180,
    tankType: "tractor",
  }) as TxnView;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/**
 * A fill row. `samsara_recon_at` is the "this has ever succeeded" flag the bound keys on, and
 * `samsara_recon_checked_at` is when it was last asked.
 */
const row = (over: Partial<Record<string, unknown>> = {}): FtxnRow =>
  ({
    id: "t1",
    vehicle_id: "v1",
    fueled_at: "2026-01-14T12:00:00Z",
    created_at: "2026-01-14T12:00:00Z",
    source: "efs",
    city: "Dallas",
    state: "TX",
    location_text: "PILOT DALLAS 305",
    gallons: 180,
    samsara_recon_at: "2026-01-14T12:04:00Z",
    samsara_recon_checked_at: hoursAgo(1),
    samsara_recon_evidence_version: 141,
    fueling_time_basis: "tank_confirmed",
    ...over,
  }) as unknown as FtxnRow;

const resolve = async (r: FtxnRow, env = testEnv(), opts: Partial<ScoreOpts> = {}) => {
  const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
  return resolveReconciliation(rec.client, env, ORG, r, txn(), vehicle, "sv1", opts as ScoreOpts);
};

describe("resolveReconciliation — the refresh bound on settled evidence (Q6c)", () => {
  beforeEach(() => {
    mocks.reconcileWithSamsara.mockReset();
    mocks.reconcileWithSamsara.mockResolvedValue(null);
  });

  it("does not re-ask Samsara about a fill that answered an hour ago", async () => {
    // ONE row, captured — `hoursAgo` reads the clock per call, so building the fixture twice and
    // comparing the two yields a millisecond of drift and a test that fails for its own reasons.
    const fill = row();
    const out = await resolve(fill);
    expect(mocks.reconcileWithSamsara).not.toHaveBeenCalled();
    // And it touches nothing: falling through would stamp a new checked_at and bump the version even
    // though the answer is identical, which is the entire cost this bound removes.
    expect(out.reconCheckedAt).toBe((fill as unknown as Record<string, unknown>).samsara_recon_checked_at);
    expect(out.reconEvidenceVersion).toBe(141);
  });

  it("re-asks once the evidence is older than the window", async () => {
    await resolve(row({ samsara_recon_checked_at: hoursAgo(25) }));
    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
  });

  it("EXEMPTS the collector tier: a fill that has never succeeded is always fetched", async () => {
    // `claimReconBatch` selects `samsara_recon_at is null`. Such a fill may well have been CHECKED
    // minutes ago — that is what its own retry ladder is for — and the refresh bound must not be a
    // second, stricter gate in front of the tier that closes the historical hole.
    await resolve(row({ samsara_recon_at: null, samsara_recon_checked_at: hoursAgo(0.1) }));
    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
  });

  it("fetches a brand-new fill immediately — nothing stored is not the same as fresh", async () => {
    await resolve(row({ samsara_recon_at: null, samsara_recon_checked_at: null }));
    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
  });

  it("treats an unparseable checked_at as no evidence of freshness", async () => {
    await resolve(row({ samsara_recon_checked_at: "not a timestamp" }));
    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
  });

  it("SAMSARA_RECON_REFRESH_HOURS=0 restores the old always-refresh behaviour", async () => {
    await resolve(row(), testEnv({ SAMSARA_RECON_REFRESH_HOURS: 0 }));
    expect(mocks.reconcileWithSamsara).toHaveBeenCalledTimes(1);
  });

  it("skipRecon still wins — a rules-only rebuild never fetches, fresh or stale", async () => {
    await resolve(row({ samsara_recon_checked_at: hoursAgo(500) }), testEnv(), { skipRecon: true });
    expect(mocks.reconcileWithSamsara).not.toHaveBeenCalled();
  });
});
