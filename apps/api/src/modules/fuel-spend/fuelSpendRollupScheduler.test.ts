import { describe, it, expect, vi, beforeEach } from "vitest";
import { isFuelSweepDue, runDueFuelSweeps } from "./fuelSpendRollupScheduler.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

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

const NOW = new Date("2026-09-07T03:00:00Z");
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
    { id: "org-due", last_fuel_sweep_at: null },
    { id: "org-fresh", last_fuel_sweep_at: hoursAgo(2) },
    { id: "org-stale", last_fuel_sweep_at: hoursAgo(30) },
  ];
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("stamps the orgs it swept and leaves the fresh one alone", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: orgs } });

    await runDueFuelSweeps(rec.client, NOW);

    const stamped = rec
      .writes()
      .filter((q) => q.table === "organizations")
      .map((q) => q.filters().find((f) => f.col === "id")?.val);
    expect(stamped).toEqual(["org-due", "org-stale"]);
    expect(stamped).not.toContain("org-fresh");
  });

  it("writes the sweep time, so the next check can tell it happened", async () => {
    const rec = createSupabaseRecorder({ tables: { organizations: [orgs[0]!] } });

    await runDueFuelSweeps(rec.client, NOW);

    const row = rec.writtenRows("organizations")[0]!;
    expect(row.last_fuel_sweep_at).toBe(NOW.toISOString());
  });

  // A failed sweep must retry at the next check rather than be marked done — otherwise one bad
  // carrier's data would silence its own rollup for a day at a time.
  it("does not stamp an org whose sweep threw", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("bad odometer interval"));
    const rec = createSupabaseRecorder({ tables: { organizations: [orgs[0]!] } });

    await runDueFuelSweeps(rec.client, NOW);

    expect(rec.writes().filter((q) => q.table === "organizations")).toHaveLength(0);
  });

  it("keeps sweeping the next carrier after one of them fails", async () => {
    const { buildFuelSpendRollup } = await import("./fuelSpendRollup.js");
    vi.mocked(buildFuelSpendRollup).mockRejectedValueOnce(new Error("bad odometer interval"));
    const rec = createSupabaseRecorder({ tables: { organizations: [orgs[0]!, orgs[2]!] } });

    await runDueFuelSweeps(rec.client, NOW);

    const stamped = rec.writes().filter((q) => q.table === "organizations").map((q) => q.filters().find((f) => f.col === "id")?.val);
    expect(stamped).toEqual(["org-stale"]);
  });
});
