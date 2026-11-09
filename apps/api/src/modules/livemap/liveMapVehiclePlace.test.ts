import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMapBoard, LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import { loadEnv } from "../../env.js";

/**
 * D-LM31 — the reader behind the card's "At" line. The rule itself (radii, kinds, the yard) is
 * `livemapPlace.test.ts` in shared; this file is what only the API can get wrong: whose board the
 * truck is read from, which trucks reach HERE at all, what HERE is asked, and what is cached.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TRUCK = "11111111-2222-4333-8444-000000000001";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), HERE_API_KEY: "k" } as NodeJS.ProcessEnv);

const h = vi.hoisted(() => ({
  boards: new Map<string, unknown>(),
  boardOrgs: [] as string[],
  browse: vi.fn(),
}));
vi.mock("./liveMapBoardCache.js", () => ({
  readLiveMapBoardCached: async (_admin: unknown, orgId: string) => {
    h.boardOrgs.push(orgId);
    return h.boards.get(orgId) ?? { vehicles: [] };
  },
}));
vi.mock("../../lib/hereGeocode.js", () => ({ hereBrowse: h.browse }));

const { readVehiclePlace, __resetVehiclePlaceCache } = await import("./liveMapVehiclePlace.js");

function boardWith(state: VehicleMapState, lat = 41.4808, lng = -88.0801): LiveMapBoard {
  const vehicle = { vehicleId: TRUCK, state, position: { lat, lng } } as unknown as LiveMapVehicle;
  return { vehicles: [vehicle] } as unknown as LiveMapBoard;
}
const PILOT = [{ title: "Pilot", distance: 72, categories: [{ id: "700-7900-0132" }] }];

beforeEach(() => {
  __resetVehiclePlaceCache();
  h.boards.clear();
  h.boardOrgs.length = 0;
  h.browse.mockReset();
});

describe("the truck place reader (D-LM31)", () => {
  it("names the truck stop a stopped truck is in, asking HERE for every truck kind within the widest radius", async () => {
    h.boards.set(ORG, boardWith("stopped"));
    h.browse.mockResolvedValue(PILOT);
    const answer = await readVehiclePlace({} as never, env, ORG, TRUCK);
    expect(answer).toEqual({ ok: true, data: { vehicleId: TRUCK, place: { name: "Pilot", kind: "truck_stop", distanceMeters: 72 } } });
    const [, at, radius, categories] = h.browse.mock.calls[0]!;
    expect(at).toEqual({ lat: 41.4808, lng: -88.0801 });
    expect(radius).toBe(250);
    expect(categories).toEqual(["700-7900-0132", "400-4300-0199", "700-7900-0131", "700-7850-0126"]);
  });

  it("reads the truck off the CALLER's org board, so another org's truck is not found", async () => {
    const OTHER = "99999999-8888-4777-8666-555555555555";
    h.boards.set(OTHER, boardWith("stopped"));
    const answer = await readVehiclePlace({} as never, env, ORG, TRUCK);
    expect(answer.ok).toBe(false);
    expect(h.boardOrgs).toEqual([ORG]);
    expect(h.browse).not.toHaveBeenCalled();
  });

  it("never asks HERE about a moving or an offline truck", async () => {
    for (const state of ["moving", "offline"] as const) {
      h.boards.set(ORG, boardWith(state));
      expect(await readVehiclePlace({} as never, env, ORG, TRUCK)).toEqual({ ok: true, data: { vehicleId: TRUCK, place: null } });
    }
    expect(h.browse).not.toHaveBeenCalled();
  });

  it("asks HERE once for a parked truck however often its card is opened", async () => {
    h.boards.set(ORG, boardWith("parked"));
    h.browse.mockResolvedValue(PILOT);
    await readVehiclePlace({} as never, env, ORG, TRUCK);
    await readVehiclePlace({} as never, env, ORG, TRUCK);
    expect(h.browse).toHaveBeenCalledTimes(1);
  });

  it("asks HERE again when the truck has really moved, and not for a few metres of GPS jitter", async () => {
    h.browse.mockResolvedValue(PILOT);
    h.boards.set(ORG, boardWith("parked", 41.48081, -88.08012));
    await readVehiclePlace({} as never, env, ORG, TRUCK);
    h.boards.set(ORG, boardWith("parked", 41.48079, -88.08009));
    await readVehiclePlace({} as never, env, ORG, TRUCK);
    expect(h.browse).toHaveBeenCalledTimes(1);
    h.boards.set(ORG, boardWith("parked", 41.4908, -88.0801));
    await readVehiclePlace({} as never, env, ORG, TRUCK);
    expect(h.browse).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed lookup, so the next open asks again", async () => {
    h.boards.set(ORG, boardWith("stopped"));
    h.browse.mockRejectedValueOnce(new Error("HERE browse HTTP 503")).mockResolvedValueOnce(PILOT);
    await expect(readVehiclePlace({} as never, env, ORG, TRUCK)).rejects.toThrow("503");
    expect((await readVehiclePlace({} as never, env, ORG, TRUCK)).ok).toBe(true);
    expect(h.browse).toHaveBeenCalledTimes(2);
  });

  it("answers no place, not a guess, when nothing nearby is a truck place", async () => {
    h.boards.set(ORG, boardWith("parked"));
    h.browse.mockResolvedValue([{ title: "JCN Truck & Reefer Repair", distance: 165, categories: [{ id: "700-7850-0126" }] }]);
    expect(await readVehiclePlace({} as never, env, ORG, TRUCK)).toEqual({ ok: true, data: { vehicleId: TRUCK, place: null } });
  });
});
