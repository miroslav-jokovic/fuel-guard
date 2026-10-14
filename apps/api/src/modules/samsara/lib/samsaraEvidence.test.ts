import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testEnv } from "../../../testing/testEnv.js";
import { __resetSamsaraPacing } from "./samsaraHttp.js";
import { makeSamsaraRawFetcher } from "./samsaraEvidence.js";

/**
 * The raw fetcher behind the roadside inspection's frozen evidence (INSPECTION-CHALLENGE-PLAN D-IC4):
 * it must keep Samsara's bytes untouched, follow the cursor to the end, and keep a refusal as an answer.
 */

const env = testEnv({ SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 0, SAMSARA_API_URL: "https://samsara.test" });
let urls: string[] = [];
const serve = (bodies: { status?: number; body: string }[]) => {
  urls = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: URL) => {
    urls.push(String(url));
    const b = bodies[Math.min(i++, bodies.length - 1)]!;
    return new Response(b.body, { status: b.status ?? 200 });
  });
};
const page = (n: number, next: string | null) =>
  // Odd spacing on purpose: the stored bytes must be these, not a re-serialisation.
  `{"data": [ {"n": ${n}} ],  "pagination": {"endCursor": "${next ?? ""}", "hasNextPage": ${next !== null}}}`;

beforeEach(() => __resetSamsaraPacing());
afterEach(() => vi.unstubAllGlobals());

describe("Samsara answers kept as received", () => {
  it("follows the cursor to the last page and keeps every page's exact bytes", async () => {
    serve([{ body: page(1, "c1") }, { body: page(2, "c2") }, { body: page(3, null) }]);
    const a = await makeSamsaraRawFetcher(env, "tok")("/dvirs/stream", { startTime: "2026-09-22T00:00:00Z" });
    expect(a).toEqual({ status: 200, pages: [page(1, "c1"), page(2, "c2"), page(3, null)], complete: true });
    expect(urls.map((u) => new URL(u).searchParams.get("after"))).toEqual([null, "c1", "c2"]);
    expect(new URL(urls[0]!).searchParams.get("startTime")).toBe("2026-09-22T00:00:00Z");
  });

  it("keeps a refusal, status and body, and stops there", async () => {
    serve([{ body: page(1, "c1") }, { status: 403, body: '{"message":"forbidden"}' }]);
    expect(await makeSamsaraRawFetcher(env, "tok")("/fleet/hos/logs", {})).toEqual({
      status: 403, pages: [page(1, "c1"), '{"message":"forbidden"}'], complete: false,
    });
  });

  it("stops at twenty pages and says the walk is incomplete", async () => {
    serve([{ body: page(1, "again") }]);
    const a = await makeSamsaraRawFetcher(env, "tok")("/fleet/vehicles/stats/history", {});
    expect([a.pages.length, a.complete]).toEqual([20, false]);
  });

  it("ends on a body that is not JSON rather than looping", async () => {
    serve([{ body: "not json" }]);
    expect(await makeSamsaraRawFetcher(env, "tok")("/x", {})).toEqual({ status: 200, pages: ["not json"], complete: true });
  });
});
