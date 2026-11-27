import { describe, expect, it } from "vitest";
import { testEnv } from "../../../testing/testEnv.js";
import { fetchAlertConfigurations } from "./warningFetch.js";

const env = testEnv({ SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 0, SAMSARA_REQUEST_TIMEOUT_MS: 0 });

describe("fetchAlertConfigurations", () => {
  it("carries an Out of route trigger's own distance, and none on any other alert", async () => {
    // The live configurations' shapes, 2026-11-27 (actions trimmed).
    const data = [
      { id: "f5efe624-f02c-40d8-92fd-c84b168286db", name: "Vehicle Out Of Route", isEnabled: true,
        triggers: [{ triggerTypeId: 1027, triggerParams: { outOfRoute: { maxOffRouteMeters: 9656, minDurationMilliseconds: 600000 } } }] },
      { id: "b7612117-1945-4e15-85dd-379e74de6e1e", name: "Speeding", isEnabled: true, triggers: [{ triggerTypeId: 1000, triggerParams: {} }] },
    ];
    const fetchImpl = (async () => new Response(JSON.stringify({ data, pagination: { hasNextPage: false } }))) as unknown as typeof fetch;
    const out = await fetchAlertConfigurations({ env, token: "t", priority: "live", fetchImpl });
    expect(out).toEqual([
      { id: data[0]!.id, name: "Vehicle Out Of Route", isEnabled: true, triggerTypeIds: [1027], outOfRouteMeters: 9656 },
      { id: data[1]!.id, name: "Speeding", isEnabled: true, triggerTypeIds: [1000] },
    ]);
  });
});
