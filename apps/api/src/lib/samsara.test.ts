import { describe, it, expect, vi, afterEach } from "vitest";
import { makeSamsaraFetcher } from "./samsara.js";
import { testEnv } from "../testing/testEnv.js";

// SAMSARA_MAX_RETRIES pinned to 0 (Step 5.9). The old `as Env` cast left it undefined, which
// disabled retries by accident; a real env restores them, and then a 429 goes down the backoff path
// and reads `res.headers.get("retry-after")` — which these bare `{ ok, status }` stubs do not have.
// The retry path has its own coverage in samsaraHttp.test.ts. These cases are about what a caller
// sees, so they turn retries off deliberately instead of relying on a fixture gap to do it.
const env = testEnv({ SAMSARA_API_URL: "https://api.samsara.test", SAMSARA_MAX_RETRIES: 0 });

const page = (
  gps: { time: string }[],
  fuelPercents: { time: string; value: number }[],
  endCursor?: string,
) => ({
  ok: true,
  json: async () => ({
    data: [{ id: "veh-1", gps, fuelPercents }],
    pagination: endCursor ? { hasNextPage: true, endCursor } : { hasNextPage: false },
  }),
});

afterEach(() => vi.unstubAllGlobals());

describe("makeSamsaraFetcher — stats-history pagination (fix #1)", () => {
  it("follows endCursor and merges every page's gps + fuelPercents samples", async () => {
    // Previously only page 1 was fetched: a truncated day made the truck look like it was "never in
    // the EFS state" → false location-mismatch alerts and wrong odometer anchors.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ time: "T1" }, { time: "T2" }], [{ time: "T1", value: 50 }], "cur-2"))
      .mockResolvedValueOnce(page([{ time: "T3" }], [], "cur-3"))
      .mockResolvedValueOnce(page([{ time: "T4" }], [{ time: "T4", value: 80 }]));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = makeSamsaraFetcher(env, "token");
    const res = (await fetcher("veh-1", "2026-06-29T00:00:00Z", "2026-06-30T12:00:00Z")) as {
      data: { id: string; gps: unknown[]; fuelPercents: unknown[] }[];
    };

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Page 2+ requests must carry the cursor.
    const url2 = new URL(fetchMock.mock.calls[1]![0] as string | URL);
    expect(url2.searchParams.get("after")).toBe("cur-2");
    // All pages merged into ONE vehicle entry.
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.gps).toHaveLength(4);
    expect(res.data[0]!.fuelPercents).toHaveLength(2);
  });

  it("returns a single page unchanged when there is no next page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([{ time: "T1" }], []));
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = makeSamsaraFetcher(env, "token");
    const res = (await fetcher("veh-1", "a", "b")) as { data: { gps: unknown[] }[] };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.data[0]!.gps).toHaveLength(1);
  });

  it("throws on a non-OK response (callers treat it as 'recon unavailable', never fabricate)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const fetcher = makeSamsaraFetcher(env, "token");
    await expect(fetcher("veh-1", "a", "b")).rejects.toThrow("Samsara API 429");
  });
});
