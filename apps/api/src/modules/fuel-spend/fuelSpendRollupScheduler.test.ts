import { describe, it, expect, vi, beforeEach } from "vitest";
import { isFuelSweepDue, runDueFuelSweeps } from "./fuelSpendRollupScheduler.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * WHY THIS SUITE EXISTS. The sweep was `setInterval(run, 24h)` with no boot run, in a service that
 * took between 8 and 42 merges a day over the ten days to 2026-09-06 — so the timer was reset by a
 * redeploy before it ever fired, and the sweep ran approximately never. C6's policy scan rides this
 * sweep, which is why `fuel_exceptions` held one row and zero policy findings against a configured
 * policy and ~14,800 fills.
 *
 * The fix is a persisted per-org marker (0324) rather than a longer timer, and these are the two
 * halves of it: a restart must re-CHECK rather than re-RUN, and a gap longer than a day must be
 * noticed rather than skipped.
 */

vi.mock("./fuelSpendRollup.js", () => ({
  buildFuelSpendRollup: vi.fn().mockResolvedValue({ written: 0, deleted: 0, rejectedIntervals: 0, unattributedFills: 0, defUnmatched: 0 }),
}));
vi.mock("./fuelPolicyScan.js", () => ({ runFuelPolicyScanForWindow: vi.fn().mockResolvedValue([]) }));
vi.mock("../fuel/index.js", () => ({
  resolveFuelTransactionStations: vi.fn().mockResolvedValue({ resolved: 0, scanned: 0, topUnmatched: [] }),
}));
/*
 * The freshness pass has its own suite (`fuelSweepFreshness.test.ts`); here it is stubbed so this
 * file stays about the sweep — but it is CALLED, and the argument it is called with is asserted
 * below, because "swept this pass" versus "the marker we read" is the one thing the wiring can get
 * wrong without any test failing.
 */
const freshnessCalls: Array<{ orgId: string; state: { lastSweptAt: string | null; orgCreatedAt: string | null } }> = [];
vi.mock("./fuelSweepFreshness.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fuelSweepFreshness.js")>()),
  runFuelSweepFreshnessOnce: vi.fn(async (_a: unknown, _e: unknown, orgId: string, state: { lastSweptAt: string | null; orgCreatedAt: string | null }) => {
    freshnessCalls.push({ orgId, state });
    return [];
  }),
}));

const env = testEnv();
/** The ledger insert must answer with an id, or `startJob` has nothing to finish the job by. */
const withLedger = (orgs: Record<string, unknown>[]) => ({
  organizations: orgs,
  jobs: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: `job-${orgs.length}` }] : []),
});

const NOW = new Date("2026-09-07T03:00:00Z");
const BORN = new Date("2026-01-01T00:00:00Z").toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("whether an org's sweep is due", () => {
  // The condition every org is in on the day 0324 ships. Reading a missing marker as "recent" would
  // have shipped a fix that changed nothing at all.
  it("treats a never-swept org as due", () => {
    expect(isFuelSweepDue(null, NOW)).toBe(true);
    expect(isFuelSweepDue(undefined, NOW)).toBe(true);
  });

  it("is due after 20 hours and not before", () => {
    expect(isFuelSweepDue(hoursAgo(19), NOW)).toBe(false);
    expect(isFuelSweepDue(hoursAgo(21), NOW)).toBe(true);
  });

  // A redeploy an hour after a sweep must not re-run a fortnight across every org — the objection the
  // original "NOT run on boot" comment raised, which this marker answers rather than dismisses.
  it("is not due an hour after a sweep, however many times the process restarts", () => {
    expect(isFuelSweepDue(hoursAgo(1), NOW)).toBe(false);
  });

  it("treats an unparseable stamp as never swept rather than as a reason to stop", () => {
    expect(isFuelSweepDue("not a date", NOW)).toBe(true);
  });
});

describe("the sweep across orgs", () => {
  const orgs = [
    { id: "org-due", last_fuel_sweep_at: null, created_at: BORN },
    { id: "org-fresh", last_fuel_sweep_at: hoursAgo(2), created_at: BORN },
    { id: "org-stale", last_fuel_sweep_at: hoursAgo(30), created_at: BORN },
  ];
  beforeEach(() => {
    freshnessCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("stamps the orgs it swept and leaves the fresh one alone", async () => {
    const rec = createSupabaseRecorder({ tables: withLedger(orgs) });

    await runDueFuelSweeps(rec.client, env, NOW);

    const stamped = rec
      .writes()
      .filter((q) => q.table === "organizations")
      .map((q) => q.filters().find((f) => f.col === "id")?.val);
    expect(stamped).toEqual(["org-due", "org-stale"]);
    expect(stamped).not.toContain("org-fresh");
  });

  it("writes the sweep time, so the next check can tell it happened", async () => {
    const rec = createSupabaseRecorder({ tables: withLedger([orgs[0]!]) });

    await runDueFuelSweeps(rec.client, env, NOW);

    const row = rec.writtenRows("organizations")[0]!;
    expect(row.last_fuel_sweep_at).toBe(NOW.toISOString());
  });

  // A failed sweep must retry at the next check rather than be marked done — otherwise one bad
  // carrier's data would silence its own rollup for a day at a time.
  it("does not stamp an org whose sweep threw", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("bad odometer interval"));
    const rec = createSupabaseRecorder({ tables: withLedger([orgs[0]!]) });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(rec.writes().filter((q) => q.table === "organizations")).toHaveLength(0);
  });

  it("keeps sweeping the next carrier after one of them fails", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("bad odometer interval"));
    const rec = createSupabaseRecorder({ tables: withLedger([orgs[0]!, orgs[2]!]) });

    await runDueFuelSweeps(rec.client, env, NOW);

    const stamped = rec.writes().filter((q) => q.table === "organizations").map((q) => q.filters().find((f) => f.col === "id")?.val);
    expect(stamped).toEqual(["org-stale"]);
  });
});

/**
 * Queue item 3. Until 2026-09-21 a throw here produced one `console.error` line and nothing else,
 * and that is how a one-line allocation bug ran for seven days: the marker stopped moving, the
 * figures aged, and the first thing that noticed was a person reading a dashboard tile. These are
 * the two halves of the fix — the failure becomes a durable row with the error text on it, and the
 * freshness pass gets asked about every org whether or not it was swept.
 */
describe("the ledger around each sweep", () => {
  const org = { id: "org-due", last_fuel_sweep_at: null, created_at: BORN };
  const jobsFixture = (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "job-1" }] : []);

  beforeEach(() => {
    freshnessCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("a completed sweep leaves a done job row carrying what it did", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: [org], jobs: jobsFixture } });

    await runDueFuelSweeps(rec.client, env, NOW);

    const [opened, closed] = rec.writtenRows("jobs");
    expect(opened).toMatchObject({ org_id: "org-due", kind: "fuel_spend_rollup", status: "running" });
    expect(closed).toMatchObject({ status: "done" });
    expect(closed!.stats).toMatchObject({ written: 0, deleted: 0, scansFailed: 0 });
  });

  // The row that did not exist during the outage. Without the error text on it, `/jobs/failed` and
  // the freshness finding can both say "it failed" and neither can say why.
  it("a sweep that throws leaves a failed job row carrying the database's own error text", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("allocated 1.565 gallons against 0.00 miles"));
    const rec = createSupabaseRecorder({ tables: { organizations: [org], jobs: jobsFixture } });

    await runDueFuelSweeps(rec.client, env, NOW);

    const closed = rec.writtenRows("jobs")[1]!;
    expect(closed.status).toBe("failed");
    expect(closed.error).toBe("allocated 1.565 gallons against 0.00 miles");
  });

  /*
   * The guarantee this file's header used to make by deployment convention alone. A live lease on
   * the (org, kind) slot means another process is mid-rebuild, and a second one would race its
   * sweep — the loser's rows carry the older timestamp and the winner deletes them.
   */
  it("refuses to sweep when another process holds the slot, and does not stamp the marker", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockClear();
    const alive = new Date(NOW.getTime() + 60_000).toISOString();
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [org],
        jobs: (q: RecordedQuery) =>
          q.write?.method === "insert"
            ? { data: [], writeError: { code: "23505" } }
            : [{ id: "blocker", kind: "fuel_spend_rollup", started_at: NOW.toISOString(), lease_expires_at: alive }],
      },
    });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(vi.mocked(buildFuelSpendRollup)).not.toHaveBeenCalled();
    expect(rec.writes().filter((q) => q.table === "organizations")).toHaveLength(0);
  });

  /*
   * Observability must never gate the work it observes: a ledger write that fails would otherwise
   * convert a REPORTING outage into a DATA outage, which is strictly worse than the silence the
   * ledger was added to fix.
   */
  it("sweeps unledgered when the job row cannot be opened at all", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockClear();
    const rec = createSupabaseRecorder({
      tables: { organizations: [org], jobs: { data: [], writeError: { message: "jobs table unreachable" } } },
    });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(vi.mocked(buildFuelSpendRollup)).toHaveBeenCalledOnce();
    expect(rec.writtenRows("organizations")[0]!.last_fuel_sweep_at).toBe(NOW.toISOString());
  });
});

describe("asking whether each org is still being swept", () => {
  const orgs = [
    { id: "org-due", last_fuel_sweep_at: null, created_at: BORN },
    { id: "org-fresh", last_fuel_sweep_at: hoursAgo(2), created_at: BORN },
  ];
  const jobsFixture = (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "job-1" }] : []);

  beforeEach(() => {
    freshnessCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  // An org whose sweep keeps failing is "due" at every single check and completes none of them, so
  // asking only about the orgs that were swept would skip exactly the org the pass exists for.
  it("asks about every org, including the one whose sweep was not due", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: orgs, jobs: jobsFixture } });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(freshnessCalls.map((c) => c.orgId)).toEqual(["org-due", "org-fresh"]);
  });

  it("reports the sweep that just happened, not the marker it was read with", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: [orgs[0]!], jobs: jobsFixture } });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(freshnessCalls[0]!.state).toEqual({ lastSweptAt: NOW.toISOString(), orgCreatedAt: BORN });
  });

  // The whole point: a failed sweep must be reported against the OLD marker, because that is the
  // fact — nothing has completed since. Reporting `now` here would have silenced the outage forever.
  it("reports the old marker when the sweep threw", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("boom"));
    const stale = { id: "org-stale", last_fuel_sweep_at: hoursAgo(136), created_at: BORN };
    const rec = createSupabaseRecorder({ tables: { organizations: [stale], jobs: jobsFixture } });

    await runDueFuelSweeps(rec.client, env, NOW);

    expect(freshnessCalls[0]!.state.lastSweptAt).toBe(hoursAgo(136));
  });

  it("a freshness pass that throws does not stop the next carrier's rebuild", async () => {
    const { runFuelSweepFreshnessOnce } = await import("./fuelSweepFreshness.js");
    vi.mocked(runFuelSweepFreshnessOnce).mockRejectedValueOnce(new Error("mailer down"));
    const rec = createSupabaseRecorder({
      tables: { organizations: [orgs[0]!, { id: "org-two", last_fuel_sweep_at: null, created_at: BORN }], jobs: jobsFixture },
    });

    await runDueFuelSweeps(rec.client, env, NOW);

    const stamped = rec.writes().filter((q) => q.table === "organizations").map((q) => q.filters().find((f) => f.col === "id")?.val);
    expect(stamped).toEqual(["org-due", "org-two"]);
  });
});
