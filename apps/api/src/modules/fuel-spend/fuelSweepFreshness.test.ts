import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { rolesThatManage } from "@silvicom/shared";
import { planFuelSweepFindings, runFuelSweepFreshnessOnce } from "./fuelSweepFreshness.js";
import { SWEEP_CRITICAL_AFTER_MS, SWEEP_STALE_AFTER_MS } from "./fuelSweepCadence.js";

/**
 * Queue item 3's done-when, at service grain: the 2026-09-13 outage — a rollup that threw every six
 * hours for seven days with `console.error` as its only evidence — becomes a finding in the fuel
 * manager's inbox and ONE email, with a stable dedupe key so it re-alerts daily while down rather
 * than every six hours or never. The planner is pure and is where the thresholds are pinned; the
 * service test proves the wiring and the org scoping around it.
 */
const ORG = "org1";
const NOW = new Date("2026-09-20T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const STALE_HOURS = SWEEP_STALE_AFTER_MS / 3_600_000;
const BORN_LONG_AGO = hoursAgo(5_000);

const notifyCalls: Array<Record<string, unknown>> = [];
vi.mock("../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    notifyCalls.push(input);
    return "evt";
  }),
}));
const emails: Array<{ to: string[]; subject: string; text: string }> = [];
vi.mock("../../lib/mailer.js", () => ({
  sendEmail: vi.fn(async (_env: unknown, email: { to: string[]; subject: string; text: string }) => {
    emails.push(email);
    return { sent: true };
  }),
}));
const env = testEnv();

beforeEach(() => {
  notifyCalls.length = 0;
  emails.length = 0;
});

describe("planFuelSweepFindings", () => {
  const born = { orgCreatedAt: BORN_LONG_AGO };

  it("says nothing about a sweep that completed within the cadence it promises", () => {
    expect(planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(5), ...born }, [], NOW)).toEqual([]);
    // 26 hours is what a HEALTHY org looks like at a check: due at 20, checked every 6.
    expect(planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(26), ...born }, [], NOW)).toEqual([]);
    expect(planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(STALE_HOURS - 0.5), ...born }, [], NOW)).toEqual([]);
  });

  it("two consecutive checks without a completed rebuild is a warning, keyed by the day", () => {
    const [f] = planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(STALE_HOURS + 1), ...born }, [], NOW);
    expect(f?.severity).toBe("warning");
    expect(f?.dedupeKey).toBe("fuel:stale:org1:2026-09-20");
    expect(f?.title).toBe("Fuel spend figures last rebuilt 33 hours ago");
  });

  /*
   * The real one. `last_fuel_sweep_at` sat at 2026-09-15 08:55 for 136.6 hours while the rollup
   * threw every six hours, and the first thing that noticed was a human reading a dashboard tile.
   */
  it("the 2026-09-13 outage, at the moment it was actually found, is critical and names the stamp", () => {
    const [f] = planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(136), ...born }, [], NOW);
    expect(f?.severity).toBe("critical");
    expect(f?.title).toBe("Fuel spend figures last rebuilt 5 days ago");
    expect(f?.body).toContain("2026-09-15 02:00 UTC");
  });

  it("crosses from warning to critical at the three-day mark and not before", () => {
    const hours = SWEEP_CRITICAL_AFTER_MS / 3_600_000;
    expect(planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(hours - 1), ...born }, [], NOW)[0]?.severity).toBe("warning");
    expect(planFuelSweepFindings(ORG, { lastSweptAt: hoursAgo(hours + 1), ...born }, [], NOW)[0]?.severity).toBe("critical");
  });

  it("a sweep that has never run is critical and keyed by the day", () => {
    const [f] = planFuelSweepFindings(ORG, { lastSweptAt: null, ...born }, [], NOW);
    expect(f?.severity).toBe("critical");
    expect(f?.dedupeKey).toBe("fuel:never-swept:org1:2026-09-20");
  });

  // The false alarm that would teach people to ignore the real one: an org onboarded this morning
  // has not missed a rebuild, it has not had one yet.
  it("says nothing about an organisation younger than the threshold, even with no sweep at all", () => {
    expect(planFuelSweepFindings(ORG, { lastSweptAt: null, orgCreatedAt: hoursAgo(2) }, [], NOW)).toEqual([]);
    expect(planFuelSweepFindings(ORG, { lastSweptAt: null, orgCreatedAt: hoursAgo(STALE_HOURS + 1) }, [], NOW)).toHaveLength(1);
  });

  it("an unknown creation date is reported rather than excused", () => {
    expect(planFuelSweepFindings(ORG, { lastSweptAt: null, orgCreatedAt: null }, [], NOW)).toHaveLength(1);
  });

  it("a failed attempt is its own finding, keyed by the job id, carrying the database's error text", () => {
    const fs = planFuelSweepFindings(
      ORG,
      { lastSweptAt: hoursAgo(1), ...born },
      [{ id: "job-7", kind: "fuel_spend_rollup", error: "allocated 1.565 gallons against 0.00 miles", finished_at: hoursAgo(2) }],
      NOW,
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({
      title: "Fuel spend rebuild failed",
      severity: "warning",
      dedupeKey: "fuel:rollup-failed:job-7",
      entityType: "job",
      entityId: "job-7",
    });
    expect(fs[0]!.body).toContain("allocated 1.565 gallons against 0.00 miles");
  });

  // Seven days of the outage in one call: it threw AND the marker went stale. Two findings, because
  // "it failed again" and "your figures are five days old" are two different things to be told.
  it("a stale marker and a failed attempt are reported separately", () => {
    const fs = planFuelSweepFindings(
      ORG,
      { lastSweptAt: hoursAgo(136), ...born },
      [{ id: "job-7", kind: "fuel_spend_rollup", error: "boom", finished_at: hoursAgo(2) }],
      NOW,
    );
    expect(fs.map((f) => f.dedupeKey)).toEqual(["fuel:stale:org1:2026-09-20", "fuel:rollup-failed:job-7"]);
  });
});

function recorder(over: { sweptAt?: string | null; failed?: Record<string, unknown>[]; sentKeys?: string[]; emails?: string[] | null }) {
  return createSupabaseRecorder({
    tables: {
      jobs: over.failed ?? [],
      notification_events: (over.sentKeys ?? []).map((dedupe_key) => ({ dedupe_key })),
      memberships: [{ user_id: "u-admin" }, { user_id: "u-fuel" }, { user_id: "u-admin" }],
      organizations: [{ notifications_enabled: true, notification_emails: over.emails === undefined ? ["office@example.test"] : over.emails }],
    },
  });
}

const state = (sweptAt: string | null) => ({ lastSweptAt: sweptAt, orgCreatedAt: BORN_LONG_AGO });

describe("runFuelSweepFreshnessOnce", () => {
  it("a stale marker and a failed rebuild: one notify per finding per fuel manager, one email, org-scoped reads", async () => {
    const rec = recorder({
      failed: [{ id: "job-7", kind: "fuel_spend_rollup", error: "allocated 1.565 gallons against 0.00 miles", finished_at: hoursAgo(40) }],
    });
    const fresh = await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(hoursAgo(136)), NOW);

    expect(fresh.map((f) => f.dedupeKey)).toEqual(["fuel:stale:org1:2026-09-20", "fuel:rollup-failed:job-7"]);
    // 2 findings × 2 distinct fuel managers (the duplicate membership row collapses).
    expect(notifyCalls).toHaveLength(4);
    expect(new Set(notifyCalls.map((c) => c.userId))).toEqual(new Set(["u-admin", "u-fuel"]));
    expect(notifyCalls.every((c) => c.category === "system" && c.orgId === ORG)).toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toEqual(["office@example.test"]);
    expect(emails[0]!.subject).toBe("Fuel data: 2 findings need attention");
    expect(emails[0]!.text).toContain("allocated 1.565 gallons against 0.00 miles");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] }); // read by its own id, like the finance pass
  });

  it("only asks the ledger about ITS OWN kind — a failed Samsara sync is not a fuel finding", async () => {
    const rec = recorder({ failed: [] });
    await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(hoursAgo(136)), NOW);
    const kinds = rec.forTable("jobs").flatMap((q) => q.filters().filter((f) => f.col === "kind").map((f) => f.val));
    expect(kinds).toEqual([["fuel_spend_rollup"]]);
  });

  /*
   * Who hears it is a ruling, not an implementation detail: a dead fuel rollup is a WRONG NUMBER on
   * the fuel pages, so it goes to whoever holds `fuel` manage — not to the accounting office that
   * hears the finance findings. The recorder does not apply filters, so without this the two are
   * indistinguishable; the expectation reads the matrix rather than re-typing the roles, because a
   * hand-written role list beside a derived matrix is the thing that drifts.
   */
  it("asks for the people who manage FUEL, off the section matrix, not the finance office", async () => {
    const rec = recorder({});
    await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(hoursAgo(136)), NOW);

    const roles = rec.forTable("memberships").flatMap((q) => q.filters().filter((f) => f.col === "role").map((f) => f.val));
    expect(roles).toEqual([rolesThatManage("fuel")]);
    expect(rolesThatManage("fuel")).not.toEqual(rolesThatManage("accounting"));
  });

  it("the ledger's keys silence a second run — no notify, no email", async () => {
    const rec = recorder({
      failed: [{ id: "job-7", kind: "fuel_spend_rollup", error: "boom", finished_at: hoursAgo(40) }],
      sentKeys: ["fuel:stale:org1:2026-09-20", "fuel:rollup-failed:job-7"],
    });
    expect(await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(hoursAgo(136)), NOW)).toEqual([]);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it("a rebuild that is keeping up touches nothing — no notify, no email, no recipient lookup", async () => {
    const rec = recorder({});
    expect(await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(hoursAgo(3)), NOW)).toEqual([]);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
    expect(rec.queries.some((q) => q.table === "memberships")).toBe(false);
  });

  it("no notification e-mail configured: the ledger rows are still written, the email is not sent", async () => {
    const rec = recorder({ emails: [] });
    const fresh = await runFuelSweepFreshnessOnce(rec.client, env, ORG, state(null), NOW);
    expect(fresh[0]?.dedupeKey).toBe("fuel:never-swept:org1:2026-09-20");
    expect(notifyCalls).toHaveLength(2);
    expect(emails).toHaveLength(0);
  });
});
