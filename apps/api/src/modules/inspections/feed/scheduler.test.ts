import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One org's turn of the FMCSA tick (IC1c). The stale check must run every tick — after a run, after
 * a FAILED run, and when no run was due — or the org whose fetch keeps failing is the one never told.
 */
const calls: string[] = [];
let lastSucceeded: string | null = null;
let syncFails = false;
let republished: string[] = [];
vi.mock("./store.js", () => ({ lastSucceededAt: vi.fn(async () => lastSucceeded) }));
vi.mock("./sync.js", () => ({
  syncFmcsaFeed: vi.fn(async () => {
    calls.push("sync");
    if (syncFails) throw new Error("socrata 503");
    return [];
  }),
}));
vi.mock("./published.js", () => ({ publishedSinceLastRun: vi.fn(async () => (calls.push("published?"), republished)) }));
vi.mock("./project.js", () => ({ projectRoadside: vi.fn(async () => (calls.push("project"), { inspections: 0, units: 0, violations: 0, citations: 0 })) }));
vi.mock("./staleAlert.js", () => ({ alertIfFeedStale: vi.fn(async (_a: unknown, _o: string, _n: number, tz: string) => (calls.push(`stale-check ${tz}`), 0)) }));

const { tickOrg } = await import("./scheduler.js");
const ORG = { id: "org-1", dot: "1864495", timeZone: "America/Chicago" };
const DAY = 24 * 3_600_000;
const tick = () => tickOrg({} as never, { FMCSA_SOCRATA_APP_TOKEN: undefined } as never, ORG, DAY);

beforeEach(() => {
  calls.length = 0;
  syncFails = false;
  republished = [];
});

describe("one org's tick", () => {
  it("fetches and projects when due, then checks freshness on the org's clock", async () => {
    lastSucceeded = new Date(Date.now() - 2 * DAY).toISOString();
    await tick();
    expect(calls).toEqual(["sync", "project", "stale-check America/Chicago"]);
  });

  it("checks freshness after a run that failed", async () => {
    lastSucceeded = null;
    syncFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await tick();
    err.mockRestore();
    expect(calls).toEqual(["sync", "stale-check America/Chicago"]);
  });

  it("checks freshness when no run was due", async () => {
    lastSucceeded = new Date(Date.now() - 3_600_000).toISOString();
    await tick();
    expect(calls).toEqual(["published?", "stale-check America/Chicago"]);
  });

  it("fetches before the backstop is due when FMCSA has republished since the last run", async () => {
    lastSucceeded = new Date(Date.now() - 3_600_000).toISOString();
    republished = ["fx4q-ay7w"];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await tick();
    log.mockRestore();
    expect(calls).toEqual(["published?", "sync", "project", "stale-check America/Chicago"]);
  });
});
