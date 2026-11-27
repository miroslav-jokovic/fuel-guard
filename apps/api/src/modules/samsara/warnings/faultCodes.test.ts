import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { NoSamsaraTokenError } from "../samsaraVehicleSync.js";
import { readTruckFaultCodes } from "./faultCodes.js";

const ORG = "org-1";
const env = testEnv({ SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 0, SAMSARA_REQUEST_TIMEOUT_MS: 0 });
const WINDOW = { sinceIso: "2026-10-28T12:00:00.000Z", untilIso: "2026-11-27T12:00:00.000Z" };

// Shapes as the live API answered them on 2026-11-27.
const reading = (time: string, codes: unknown[]) => ({
  time,
  canBusType: "CANBUS_CAN1_J1939_MULTIPLE_CABLE_IDS",
  j1939: { checkEngineLights: { emissionsIsOn: false, protectIsOn: false, stopIsOn: codes.length > 0, warningIsOn: false }, diagnosticTroubleCodes: codes },
});
const dtc = (spnId: number, fmiId = 3) => ({ spnId, fmiId, txId: 0, sourceAddressName: "Engine #1", spnDescription: "Engine Coolant Level 1", occurrenceCount: 2 });

function samsara(historyPages: unknown[][], status = 200) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    if (status !== 200) return new Response("{}", { status });
    if (url.pathname === "/fleet/vehicles/stats") {
      return new Response(JSON.stringify({ data: [{ id: "281474995248382", name: "719", faultCodes: reading("2026-11-27T10:32:12Z", [dtc(111)]) }], pagination: { hasNextPage: false } }));
    }
    const n = Number(url.searchParams.get("after") ?? 0);
    const more = n + 1 < historyPages.length;
    return new Response(JSON.stringify({ data: [{ id: "281474995248382", name: "719", faultCodes: historyPages[n] }], pagination: { hasNextPage: more, endCursor: more ? String(n + 1) : "" } }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const withToken = () => createSupabaseRecorder({ tables: { integration_credentials: [{ samsara_api_token: "tok", enabled: true }] } });

describe("readTruckFaultCodes", () => {
  it("reads one truck now and over the window, joining the history across pages", async () => {
    const rec = withToken();
    const s = samsara([[reading("2026-11-01T00:00:00Z", [dtc(222)])], [reading("2026-11-02T00:00:00Z", [])]]);
    const out = await readTruckFaultCodes(rec.client, env, ORG, "281474995248382", WINDOW, { fetchImpl: s.fetchImpl });
    expect(out.asOf).toBe("2026-11-27T10:32:12.000Z");
    expect(out.lamps).toEqual({ stop: true, warning: false, emissions: false, protect: false });
    expect(out.now.map((c) => c.spn)).toEqual([111]);
    expect(out.history.map((h) => [h.at, h.codes.map((c) => c.spn)])).toEqual([
      ["2026-11-01T00:00:00.000Z", [222]],
      ["2026-11-02T00:00:00.000Z", []],
    ]);
    const live = s.calls.find((u) => u.pathname === "/fleet/vehicles/stats")!;
    expect(live.searchParams.get("vehicleIds")).toBe("281474995248382");
    const hist = s.calls.filter((u) => u.pathname === "/fleet/vehicles/stats/history");
    expect(hist).toHaveLength(2);
    expect([hist[0]!.searchParams.get("startTime"), hist[0]!.searchParams.get("endTime")]).toEqual([WINDOW.sinceIso, WINDOW.untilIso]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses to guess without the org's token, before Samsara is asked", async () => {
    const rec = createSupabaseRecorder({ tables: { integration_credentials: [] } });
    const s = samsara([[]]);
    await expect(readTruckFaultCodes(rec.client, testEnv({ SAMSARA_API_TOKEN: undefined }), ORG, "v", WINDOW, { fetchImpl: s.fetchImpl })).rejects.toBeInstanceOf(NoSamsaraTokenError);
    expect(s.calls).toHaveLength(0);
  });

  it("throws when Samsara fails, so the caller can fall back instead of showing an empty truck", async () => {
    const s = samsara([[]], 503);
    await expect(readTruckFaultCodes(withToken().client, env, ORG, "v", WINDOW, { fetchImpl: s.fetchImpl })).rejects.toThrow(/503/);
  });
});
