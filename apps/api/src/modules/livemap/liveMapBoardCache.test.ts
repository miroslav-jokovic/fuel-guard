import { beforeEach, describe, expect, it } from "vitest";
import {
  readLiveMapBoardCached,
  __resetLiveMapBoardCache,
  BOARD_CACHE_TTL_MS,
} from "./liveMapBoardCache.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * C3 — one board per org per few seconds, however many dispatchers are watching.
 *
 * ── WHAT IS BEING BOUGHT ────────────────────────────────────────────────────────────────────────
 * `readLiveMapBoard` is five sequential upstream round trips, and thirty dispatchers polling every
 * five seconds were measured making 150 of them per second to receive thirty identical boards. These
 * assertions count the reads that actually reached the database, because "it got faster" is not a
 * property a test can hold and "it read the database once" is.
 *
 * ── AND THE LINE IT MUST NOT CROSS ──────────────────────────────────────────────────────────────
 * ⚠⚠ The API reads with the SERVICE ROLE, which bypasses RLS. A cache in front of those reads is a
 * tenancy boundary: keyed carelessly it would serve one carrier another carrier's trucks, and no
 * database policy would stop it. The two-org matrix below is the point of this file, not a nicety.
 */

const ORG_A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ORG_B = "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const NOW = new Date("2026-09-17T18:00:00.000Z");

const position = (vehicleId: string) => ({
  vehicle_id: vehicleId,
  lat: 44.51,
  lng: -88.01,
  heading_degrees: 275,
  speed_mph: 62,
  is_ecu_speed: true,
  formatted_location: "Green Bay, WI",
  sampled_at: NOW.toISOString(),
  received_at: NOW.toISOString(),
});

const vehicle = (id: string, unit: string) => ({
  id,
  unit_number: unit,
  status: "active",
  assigned_driver_id: null,
  samsara_fuel_percent: "68.0",
  samsara_fuel_at: NOW.toISOString(),
});

function recorder(vehicleId: string, unit: string) {
  return createSupabaseRecorder({
    tables: {
      vehicle_positions: { data: [position(vehicleId)] },
      vehicles: { data: [vehicle(vehicleId, unit)] },
      drivers: { data: [] },
      loads: { data: [] },
      load_stops: { data: [] },
    },
  });
}

/** How many times the positions table was actually read — the cache's whole job, as a number. */
const positionReads = (rec: ReturnType<typeof recorder>) => rec.forTable("vehicle_positions").length;

beforeEach(() => {
  __resetLiveMapBoardCache();
});

describe("the live map board cache", () => {
  it("reads the database once for two dispatchers polling together", async () => {
    const rec = recorder("veh-1", "1207");
    const [a, b] = await Promise.all([
      readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 }),
      readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 }),
    ]);
    expect(positionReads(rec)).toBe(1);
    // Both dispatchers were handed the same snapshot, which is what makes one read correct.
    expect(a.vehicles[0]?.unitNumber).toBe("1207");
    expect(b.generatedAt).toBe(a.generatedAt);
  });

  /**
   * ⚠ The IN-FLIGHT case, which is a different mechanism from the TTL and the reason a PROMISE is
   * cached rather than a value. These two callers arrive while the first read is still running — a
   * value cache would have nothing to hand the second one and would start a second read.
   */
  it("coalesces callers that arrive while the first read is still running", async () => {
    const rec = recorder("veh-1", "1207");
    const first = readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 });
    const second = readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 });
    await Promise.all([first, second]);
    expect(positionReads(rec)).toBe(1);
  });

  it("serves the cached board until the TTL expires, then reads again", async () => {
    const rec = recorder("veh-1", "1207");
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 });
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: BOARD_CACHE_TTL_MS - 1 });
    expect(positionReads(rec)).toBe(1);

    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: BOARD_CACHE_TTL_MS });
    expect(positionReads(rec)).toBe(2);
  });

  /**
   * The TTL runs from when the ENTRY was made, at whatever the clock happened to read — not from
   * zero, and not from process start. The offset is the point of the test.
   *
   * ⚠ WHAT THIS DELIBERATELY DOES NOT CLAIM. An earlier draft was titled "…from the start of the
   * read, not its completion" and could not prove it: with an injected clock the read settles in the
   * same tick, so the two instants are identical and a mutation moving the timestamp to completion
   * passed. That the field is assigned BEFORE the read is awaited rests on the assignment order in
   * the source, and the regressions that would actually break it — awaiting before caching, caching a
   * value instead of a promise — are caught by the coalescing test above. Said here rather than left
   * as a title that promises more than it checks.
   */
  it("measures the TTL from when the entry was made, at any clock offset", async () => {
    const rec = recorder("veh-1", "1207");
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 1_000 });
    // 1_000 + TTL is the deadline; a tick before it is still a hit, the tick itself is not.
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 1_000 + BOARD_CACHE_TTL_MS - 1 });
    expect(positionReads(rec)).toBe(1);
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 1_000 + BOARD_CACHE_TTL_MS });
    expect(positionReads(rec)).toBe(2);
  });

  /**
   * ⚠⚠ THE TENANCY MATRIX. Two orgs, one process, the same instant — the service role would happily
   * have served either board to either caller.
   */
  it("never serves one org the other org's board", async () => {
    const recA = recorder("veh-a", "1207");
    const recB = recorder("veh-b", "4412");

    const a = await readLiveMapBoardCached(recA.client, ORG_A, { now: NOW, nowMs: 0 });
    const b = await readLiveMapBoardCached(recB.client, ORG_B, { now: NOW, nowMs: 0 });

    expect(a.vehicles[0]?.unitNumber).toBe("1207");
    expect(b.vehicles[0]?.unitNumber).toBe("4412");
    // Each org paid for its own read; neither was answered out of the other's entry.
    expect(positionReads(recA)).toBe(1);
    expect(positionReads(recB)).toBe(1);

    // And a second poll within the TTL still stays on its own side of the line.
    const aAgain = await readLiveMapBoardCached(recA.client, ORG_A, { now: NOW, nowMs: 10 });
    expect(aAgain.vehicles[0]?.unitNumber).toBe("1207");
    expect(positionReads(recA)).toBe(1);
  });

  /** The reads underneath are still org-scoped — the cache must not be the reason nobody checks. */
  it("keeps every underlying read org-scoped", async () => {
    const rec = recorder("veh-a", "1207");
    await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 0 });
    expectOrgScoped(rec, ORG_A);
  });

  /**
   * ⚠ A FAILED READ IS NOT CACHED. Without this a single upstream blip would be replayed to every
   * dispatcher in the org for the next 2.5 seconds — one transient error amplified into a board-wide
   * outage, which is worse than the un-cached behaviour the cache replaced.
   */
  it("does not cache a failure", async () => {
    const failing = {
      from: () => {
        throw new Error("upstream blip");
      },
    } as never;
    await expect(readLiveMapBoardCached(failing, ORG_A, { now: NOW, nowMs: 0 })).rejects.toThrow("upstream blip");

    // The very next caller must reach a healthy database rather than inherit the error.
    const rec = recorder("veh-1", "1207");
    const board = await readLiveMapBoardCached(rec.client, ORG_A, { now: NOW, nowMs: 1 });
    expect(board.vehicles[0]?.unitNumber).toBe("1207");
    expect(positionReads(rec)).toBe(1);
  });

  /**
   * The TTL must stay strictly under the client's 5 s poll, or a dispatcher could be served two
   * successive polls from one entry and the board would visibly stop moving.
   */
  it("keeps the TTL well under the poll interval", () => {
    expect(BOARD_CACHE_TTL_MS).toBeLessThan(5_000);
    expect(BOARD_CACHE_TTL_MS).toBeGreaterThan(0);
  });
});
