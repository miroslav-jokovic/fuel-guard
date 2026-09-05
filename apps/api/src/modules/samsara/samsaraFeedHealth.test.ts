import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readSamsaraFeedHealth, samsaraFeedCadences } from "./samsaraFeedHealth.js";
import type { Env } from "../../env.js";

/**
 * The I/O half of S5. The verdict is `describeSamsaraFeeds`, tested in `packages/shared`; what is only
 * testable here is which STAMP each feed is judged by — and every one of the three choices below is a
 * way this could report a dead feed as healthy.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-09-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;

const ENV = {
  SAMSARA_STATS_SYNC_MINUTES: 20,
  SAMSARA_RECON_SYNC_MINUTES: 60,
  SAMSARA_RECON_BATCH: 250,
  SAMSARA_IDENTITY_SYNC_HOURS: 12,
  SAMSARA_DRIVER_SCORE_SYNC_HOURS: 6,
  SAMSARA_IFTA_SYNC_HOURS: 24,
  SAMSARA_ODOMETER_SYNC_HOURS: 24,
} as unknown as Env;

type Job = { status: string; error: string | null; created_at: string; finished_at: string | null; skipped?: boolean };

/** A job row per kind, newest first. The fixture answers by kind because the recorder does not filter. */
const seed = (jobs: Record<string, Job[]>, opts: { reconAt?: string | null; fail?: true | "latest" | "delivered" | "fills" } = {}) =>
  createSupabaseRecorder({
    tables: {
      jobs: (q) => {
        const kind = q.filters().find((f) => f.col === "kind")?.val as string;
        const wantsDone = q.ops.some((o) => o.method === "eq" && o.args[0] === "status" && o.args[1] === "done");
        // Selective, so a test can prove EACH read's error is raised. One fixture that fails both
        // lets a missing guard hide behind the other guard — which is how M5 first passed.
        if (opts.fail === true || (opts.fail === "latest" && !wantsDone) || (opts.fail === "delivered" && wantsDone)) {
          return { data: null, error: { message: "jobs read refused" } };
        }
        const excludesSkipped = q.ops.some((o) => o.method === "filter" && o.args[0] === "stats->>skipped");
        let rows = jobs[kind] ?? [];
        if (wantsDone) rows = rows.filter((r) => r.status === "done");
        if (excludesSkipped) rows = rows.filter((r) => !r.skipped);
        return { data: rows.slice(0, 1), error: null };
      },
      fuel_transactions: opts.fail === "fills"
        ? { data: null, error: { message: "fills read refused" } }
        : opts.reconAt === undefined
          ? [{ samsara_recon_checked_at: ago(10 * MIN) }]
          : opts.reconAt === null
            ? []
            : [{ samsara_recon_checked_at: opts.reconAt }],
    },
  });

const done = (at: string, extra: Partial<Job> = {}): Job => ({ status: "done", error: null, created_at: at, finished_at: at, ...extra });
const failed = (at: string, error = "429"): Job => ({ status: "failed", error, created_at: at, finished_at: at });
const healthy = (): Record<string, Job[]> => ({
  sync_stats: [done(ago(5 * MIN))],
  sync_vehicles: [done(ago(HOUR))],
  sync_driver_scores: [done(ago(HOUR))],
  sync_ifta: [done(ago(2 * HOUR))],
  sync_odometer: [done(ago(2 * HOUR))],
  sync_hos: [done(ago(HOUR))],
  sync_idle: [done(ago(HOUR))],
});
const feed = (r: Awaited<ReturnType<typeof readSamsaraFeedHealth>>, id: string) => r.feeds.find((f) => f.id === id)!;

describe("samsaraFeedCadences", () => {
  it("reads the intervals this process is configured with, not a copy in shared", () => {
    const c = samsaraFeedCadences(ENV);
    expect(c.stats).toBe(20 * MIN);
    expect(c.identity).toBe(12 * HOUR);
    // driver-scores, HOS and idle share the performance tier's one interval.
    expect(c.driver_scores).toBe(6 * HOUR);
    expect(c.hos).toBe(6 * HOUR);
    expect(c.idle).toBe(6 * HOUR);
  });

  it("reports a tier the scheduler will never start as switched off, not as hourly", () => {
    // `startSamsaraScheduler` gates the recon tier on BOTH of these; reporting a cadence it does not
    // have would put a promise on screen that nothing is keeping.
    expect(samsaraFeedCadences({ ...ENV, SAMSARA_RECON_BATCH: 0 } as Env).telematics).toBe(0);
    expect(samsaraFeedCadences({ ...ENV, SAMSARA_RECON_SYNC_MINUTES: 0 } as Env).telematics).toBe(0);
    expect(samsaraFeedCadences({ ...ENV, SAMSARA_IFTA_SYNC_HOURS: 0 } as Env).ifta).toBe(0);
  });
});

describe("readSamsaraFeedHealth", () => {
  it("judges each feed by the job kind its tier actually runs under", async () => {
    // `identity` is not a job kind — the tier deliberately runs under `sync_vehicles` so a manual
    // vehicle sync and the tier share one slot. Reading a kind named after the label finds nothing.
    const rec = seed({ ...healthy(), sync_vehicles: [done(ago(40 * HOUR))] });
    const r = await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW);
    expect(feed(r, "identity").state).toBe("late");
    expect(feed(r, "stats").state).toBe("fresh");
    const kinds = rec.forTable("jobs").map((q) => q.filters().find((f) => f.col === "kind")?.val);
    expect(kinds).toContain("sync_vehicles");
    expect(kinds).not.toContain("identity");
    expect(kinds).not.toContain("backfill");
  });

  it("does not count a run that skipped for want of a token as a delivery", async () => {
    // `runOrgTier` records NoSamsaraToken as done+skipped, on purpose. Counting it would show every
    // feed of an unconfigured org as freshly delivered forever — the `*_last_polled_at` trap again.
    const rec = seed({
      ...healthy(),
      sync_ifta: [done(ago(MIN), { skipped: true }), done(ago(90 * HOUR))],
    });
    const r = await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW);
    expect(feed(r, "ifta").state).toBe("late");
    expect(feed(r, "ifta").ageMinutes).toBe(90 * 60);
  });

  it("takes the error from the most recent run, so a tier that recovered is not left red", async () => {
    const recovered = seed({ ...healthy(), sync_stats: [done(ago(5 * MIN)), failed(ago(3 * HOUR))] });
    expect(feed(await readSamsaraFeedHealth(recovered.client, ENV, ORG, NOW), "stats").state).toBe("fresh");
    const failing = seed({ ...healthy(), sync_stats: [failed(ago(5 * MIN)), done(ago(3 * HOUR))] });
    const f = feed(await readSamsaraFeedHealth(failing.client, ENV, ORG, NOW), "stats");
    expect(f.state).toBe("failing");
    expect(f.lastError).toBe("429");
  });

  it("judges the per-fill tier by the stamp the recon path writes, not by a job row", async () => {
    // The recon tier dispatches `backfill`, which manual rebuilds also use — a `backfill` row proves
    // nothing about telematics. `samsara_recon_checked_at` is the same predicate S4's coverage card uses.
    const rec = seed(healthy(), { reconAt: ago(9 * HOUR) });
    const r = await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW);
    expect(feed(r, "telematics").state).toBe("late");
    expect(feed(r, "telematics").ageMinutes).toBe(9 * 60);
    expect(rec.forTable("fuel_transactions").length).toBeGreaterThan(0);
  });

  it("reports a carrier whose fills have never been reconciled as never, not as fresh", async () => {
    const r = await readSamsaraFeedHealth(seed(healthy(), { reconAt: null }).client, ENV, ORG, NOW);
    expect(feed(r, "telematics").state).toBe("never");
  });

  it("lets only a ruled, meetable, breached bound page somebody", async () => {
    const rec = seed({
      ...healthy(),
      sync_ifta: [done(ago(90 * HOUR))], // ruled 48 h → alerts
      sync_odometer: [done(ago(30 * 24 * HOUR))], // cadence-derived → never alerts
    });
    const r = await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW);
    expect(feed(r, "odometer").state).toBe("late");
    expect(r.alerting.map((f) => f.id)).toEqual(["ifta"]);
  });

  it("does not alert on a bound the configured interval cannot meet", async () => {
    // Stats polled every 90 minutes against the ruled 1-hour bound: breached the moment it succeeds.
    const rec = seed({ ...healthy(), sync_stats: [done(ago(80 * MIN))] });
    const r = await readSamsaraFeedHealth(rec.client, { ...ENV, SAMSARA_STATS_SYNC_MINUTES: 90 } as Env, ORG, NOW);
    expect(feed(r, "stats").state).toBe("late");
    expect(feed(r, "stats").targetUnreachable).toBe(true);
    expect(r.alerting).toEqual([]);
  });

  it("does not call a feed failing while a retry is still queued", async () => {
    // The worker records the attempt's error and leaves the row queued for another go
    // (`jobs.attempts` / `max_attempts`). Reading that error as the feed's state reports a tier that
    // is mid-retry — and has a fresh delivery behind it — as broken.
    const rec = seed({
      ...healthy(),
      sync_stats: [{ status: "queued", error: "429 on attempt 1", created_at: ago(MIN), finished_at: null }, done(ago(5 * MIN))],
    });
    const f = feed(await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW), "stats");
    expect(f.state).toBe("fresh");
    expect(f.lastError).toBeNull();
  });

  it("surfaces a read failure rather than reporting every feed healthy — from EITHER job read", async () => {
    for (const fail of ["latest", "delivered", true] as const) {
      const r = await readSamsaraFeedHealth(seed(healthy(), { fail }).client, ENV, ORG, NOW);
      expect(r.error, String(fail)).toBe("jobs read refused");
      expect(r.feeds).toEqual([]);
      expect(r.alerting).toEqual([]);
    }
  });

  it("surfaces a failure of the per-fill read too — it is a different query on a different table", async () => {
    const r = await readSamsaraFeedHealth(seed(healthy(), { fail: "fills" }).client, ENV, ORG, NOW);
    expect(r.error).toBe("fills read refused");
    expect(r.feeds).toEqual([]);
  });

  it("scopes every query it makes to one organization", async () => {
    // The service role bypasses RLS, so the `.eq("org_id", …)` is the only tenant boundary here —
    // without it a carrier would be told another carrier's collector was healthy.
    const rec = seed(healthy());
    await readSamsaraFeedHealth(rec.client, ENV, ORG, NOW);
    expectOrgScoped(rec, ORG);
  });
});
