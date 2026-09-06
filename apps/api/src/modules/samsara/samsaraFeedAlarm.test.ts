import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * The alarm. Detection is `readSamsaraFeedHealth` and the decision is `decideSamsaraFeedAlerts`; what
 * is only testable here is the pair of facts that decide whether the alarm can be trusted — it speaks
 * before it remembers, and it never remembers something it did not manage to say.
 */
const sent: { to: string[]; subject: string; text: string }[] = [];
let accept = true;
let throwOnSend = false;
vi.mock("../../lib/mailer.js", () => ({
  makeSender: () => async (email: { to: string[]; subject: string; text: string }) => {
    if (throwOnSend) throw new Error("smtp exploded");
    sent.push(email);
    return accept;
  },
}));

const { runSamsaraFeedAlarm } = await import("./samsaraFeedAlarm.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-09-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const ENV = testEnv();

type Job = { status: string; error: string | null; created_at: string; finished_at: string | null };
const done = (at: string): Job => ({ status: "done", error: null, created_at: at, finished_at: at });

/** Everything healthy except the kinds named — the same shape the freshness reader's suite uses. */
const seed = (opts: {
  jobs?: Record<string, Job[]>;
  alerts?: Record<string, unknown>[];
  enabled?: boolean;
  emails?: string[];
  reconAt?: string;
} = {}) => {
  const jobs: Record<string, Job[]> = {
    sync_stats: [done(ago(5 * MIN))],
    sync_vehicles: [done(ago(HOUR))],
    sync_driver_scores: [done(ago(HOUR))],
    sync_ifta: [done(ago(2 * HOUR))],
    sync_odometer: [done(ago(2 * HOUR))],
    sync_hos: [done(ago(HOUR))],
    sync_idle: [done(ago(HOUR))],
    ...opts.jobs,
  };
  return createSupabaseRecorder({
    tables: {
      jobs: (q) => {
        const kind = q.filters().find((f) => f.col === "kind")?.val as string;
        const wantsDone = q.ops.some((o) => o.method === "eq" && o.args[0] === "status" && o.args[1] === "done");
        const rows = (jobs[kind] ?? []).filter((r) => !wantsDone || r.status === "done");
        return { data: rows.slice(0, 1), error: null };
      },
      fuel_transactions: [{ samsara_recon_checked_at: opts.reconAt ?? ago(10 * MIN) }],
      samsara_feed_alerts: opts.alerts ?? [],
      organizations: {
        data: {
          name: "Silvicom",
          notifications_enabled: opts.enabled ?? true,
          notification_emails: opts.emails ?? ["ops@silvicom.test"],
        },
      },
    },
  });
};

/** IFTA three days late against its ruled 48-hour bound — the one feed that alerts in these fixtures. */
const IFTA_LATE = { sync_ifta: [done(ago(90 * HOUR))] };

beforeEach(() => {
  sent.length = 0;
  accept = true;
  throwOnSend = false;
});

describe("runSamsaraFeedAlarm", () => {
  it("mails a breached ruled bound and remembers that it did", async () => {
    const rec = seed({ jobs: IFTA_LATE });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.error).toBeNull();
    expect(r.sent.map((d) => [d.feed, d.action])).toEqual([["ifta", "raise"]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["ops@silvicom.test"]);
    expect(sent[0]!.subject).toContain("late");

    const [row] = rec.writtenRows("samsara_feed_alerts");
    expect(row).toMatchObject({ org_id: ORG, feed: "ifta", state: "late", cleared_at: null });
    // The sentence the carrier actually received, kept on the row.
    expect(String(row!.lead)).toContain("past the 2 days");
  });

  it("says nothing on the next evaluation of the same outage", async () => {
    const rec = seed({
      jobs: IFTA_LATE,
      alerts: [{ feed: "ifta", state: "late", notified_at: ago(72 * HOUR), cleared_at: null }],
    });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(sent).toEqual([]);
    expect(r.held).toContainEqual({ feed: "ifta", why: "unchanged" });
    expect(rec.writtenRows("samsara_feed_alerts")).toEqual([]);
  });

  it("sends ONE message when several feeds break at once, not one each", async () => {
    const rec = seed({ jobs: { ...IFTA_LATE, sync_stats: [done(ago(9 * HOUR))] } });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.sent.length).toBeGreaterThan(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("feeds need attention");
    for (const d of r.sent) expect(sent[0]!.text).toContain(d.health.label);
  });

  it("tells them when it recovers, and keeps the row rather than deleting it", async () => {
    const rec = seed({ alerts: [{ feed: "ifta", state: "late", notified_at: ago(200 * HOUR), cleared_at: null }] });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.sent.map((d) => d.action)).toEqual(["clear"]);
    expect(sent[0]!.subject).toContain("back on time");
    const writes = rec.forTable("samsara_feed_alerts").filter((q) => q.write);
    expect(writes.map((q) => q.write!.method)).toEqual(["update"]);
    expect(rec.writtenRows("samsara_feed_alerts")[0]).toMatchObject({ cleared_at: NOW.toISOString() });
  });

  it("remembers nothing it could not send, so a refused mail is retried rather than swallowed", async () => {
    // `makeSender` REPORTS failure, it does not throw. Persisting here would mark the carrier as
    // notified about an outage they were never told about — and the memory would then silence it.
    accept = false;
    const rec = seed({ jobs: IFTA_LATE });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.error).toContain("not accepted");
    expect(r.sent).toEqual([]);
    expect(rec.writtenRows("samsara_feed_alerts")).toEqual([]);
  });

  it("does the same when the transport throws instead", async () => {
    throwOnSend = true;
    const rec = seed({ jobs: IFTA_LATE });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.error).toBe("smtp exploded");
    expect(rec.writtenRows("samsara_feed_alerts")).toEqual([]);
  });

  it("stays quiet for a carrier with notifications off — and remembers nothing", async () => {
    // So the outage still reaches them the day they turn notifications back on. Recording it here
    // would mean it never did.
    const rec = seed({ jobs: IFTA_LATE, enabled: false });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.muted).toBe(true);
    expect(r.error).toBeNull();
    expect(sent).toEqual([]);
    // `sent` is what the scheduler LOGS. Reporting the decisions here would print "raise ifta" for a
    // message nobody received, which is a lie in the one place somebody looks during an incident.
    expect(r.sent).toEqual([]);
    expect(rec.writtenRows("samsara_feed_alerts")).toEqual([]);
  });

  it("treats a carrier with no address the same way", async () => {
    const rec = seed({ jobs: IFTA_LATE, emails: [] });
    expect((await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW)).muted).toBe(true);
    expect(sent).toEqual([]);
  });

  it("mails nothing off a freshness read it could not complete", async () => {
    const rec = createSupabaseRecorder({
      tables: { jobs: { data: null, error: { message: "jobs read refused" } } },
    });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(r.error).toBe("jobs read refused");
    expect(sent).toEqual([]);
  });

  it("never alerts on a bound nobody agreed to, however far past it", async () => {
    const rec = seed({ jobs: { sync_odometer: [done(ago(40 * 24 * HOUR))] } });
    const r = await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expect(sent).toEqual([]);
    expect(r.held).toContainEqual({ feed: "odometer", why: "not alertable" });
  });

  it("scopes every query it makes to one organization", async () => {
    const rec = seed({ jobs: IFTA_LATE });
    await runSamsaraFeedAlarm(rec.client, ENV, ORG, NOW);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});
