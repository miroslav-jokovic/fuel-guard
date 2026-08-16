import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";

const env = testEnv({ SAMSARA_API_URL: "https://api.samsara.test" });
type SamsaraFetchMock = (
  requestEnv: Env,
  token: string,
  url: URL,
  options?: { priority?: "live" | "backfill" },
) => Promise<Response>;

const http = vi.hoisted(() => ({ samsaraFetch: vi.fn<SamsaraFetchMock>() }));
vi.mock("./samsaraHttp.js", () => http);

import { makeSamsaraVehicleTelemetryFetcher } from "./samsara.js";
import { testEnv } from "../testing/testEnv.js";

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => vi.clearAllMocks());

describe("makeSamsaraVehicleTelemetryFetcher", () => {
  it("uses no more than three metric types per request, follows pagination, and merges the two requests", async () => {
    http.samsaraFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "s1", engineRpm: [{ time: "2026-08-09T00:00:00.000Z", value: 700 }] }],
          pagination: { hasNextPage: true, endCursor: "cursor-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "s1", batteryMilliVolts: [{ time: "2026-08-09T00:01:00.000Z", value: 12_500 }] }],
          pagination: { hasNextPage: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "s1", ecuSpeedMph: [{ time: "2026-08-09T00:00:00.000Z", value: 0 }] }],
          pagination: { hasNextPage: false },
        }),
      );

    const result = await makeSamsaraVehicleTelemetryFetcher(env, "token")(
      ["s1"],
      "2026-08-09T00:00:00.000Z",
      "2026-08-09T01:00:00.000Z",
    );

    expect(http.samsaraFetch).toHaveBeenCalledTimes(3);
    const urls = http.samsaraFetch.mock.calls.map((call) => call[2]);
    expect(urls[0]?.searchParams.get("types")).toBe("batteryMilliVolts,engineRpm,engineLoadPercent");
    expect(urls[1]?.searchParams.get("after")).toBe("cursor-1");
    expect(urls[2]?.searchParams.get("types")).toBe("ecuSpeedMph");
    expect(result).toMatchObject({ complete: true, pages: 3 });
    expect(result.data[0]).toMatchObject({
      id: "s1",
      batteryMilliVolts: [{ value: 12_500 }],
      engineRpm: [{ value: 700 }],
      ecuSpeedMph: [{ value: 0 }],
    });
  });

  it("fails closed when Samsara reports another page without a cursor", async () => {
    http.samsaraFetch.mockResolvedValueOnce(
      jsonResponse({ data: [], pagination: { hasNextPage: true } }),
    );

    await expect(
      makeSamsaraVehicleTelemetryFetcher(env, "token")(
        ["s1"],
        "2026-08-09T00:00:00.000Z",
        "2026-08-09T01:00:00.000Z",
      ),
    ).rejects.toThrow("pagination reported a next page without a cursor");
    expect(http.samsaraFetch).toHaveBeenCalledTimes(1);
  });
});
