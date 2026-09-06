import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { planFreshnessFindings, runFinancialFreshnessOnce, STALE_AFTER_HOURS } from "./financialFreshness.js";

/**
 * D-FIN3's done-when, at service grain: a stale sweep and a failed finance job each become ONE
 * finding per office user with a stable dedupe key, the office gets ONE email per run, a second run
 * against the ledger's keys is silent, and every read is org-scoped. The planner is pure and
 * tested first; the service test proves the wiring around it.
 */
const ORG = "org1";
const NOW = new Date("2026-09-03T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

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

describe("planFreshnessFindings", () => {
  it("says nothing when the sweep is fresh and no job failed", () => {
    expect(planFreshnessFindings(ORG, hoursAgo(5), [], NOW)).toEqual([]);
    expect(planFreshnessFindings(ORG, hoursAgo(STALE_AFTER_HOURS - 0.5), [], NOW)).toEqual([]);
  });

  it("a sweep older than 26 hours is a warning keyed by the day, so it re-alerts once a day while down", () => {
    const [f] = planFreshnessFindings(ORG, hoursAgo(30), [], NOW);
    expect(f?.severity).toBe("warning");
    expect(f?.dedupeKey).toBe("finance:stale:org1:2026-09-03");
    expect(f?.title).toBe("McLeod financial sweep is 1 day old");
  });

  it("three days without a sweep is critical, and it names the stamp the pages are reading from", () => {
    const [f] = planFreshnessFindings(ORG, hoursAgo(6 * 24), [], NOW);
    expect(f?.severity).toBe("critical");
    expect(f?.title).toBe("McLeod financial sweep is 6 days old");
    expect(f?.body).toContain("2026-08-28 18:00 UTC");
  });

  it("a sweep that never ran is critical and keyed by the day", () => {
    const [f] = planFreshnessFindings(ORG, null, [], NOW);
    expect(f?.severity).toBe("critical");
    expect(f?.dedupeKey).toBe("finance:never-swept:org1:2026-09-03");
  });

  it("a failed job is its own finding, keyed by the job id, carrying the database's error text", () => {
    const fs = planFreshnessFindings(
      ORG,
      hoursAgo(1),
      [{ id: "job-9", kind: "efs_window_refetch", error: "refetch failed for 1/3 window(s): numeric field overflow", finished_at: hoursAgo(2) }],
      NOW,
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({
      title: "Finance job failed: efs window refetch",
      severity: "critical",
      dedupeKey: "finance:job-failed:job-9",
      entityType: "job",
      entityId: "job-9",
    });
    expect(fs[0]!.body).toContain("numeric field overflow");
  });
});

function recorder(over: { syncedAt?: string | null; failed?: Record<string, unknown>[]; sentKeys?: string[]; emails?: string[] | null }) {
  return createSupabaseRecorder({
    tables: {
      org_integrations: over.syncedAt === undefined ? [] : [{ last_synced_at: over.syncedAt }],
      jobs: over.failed ?? [],
      notification_events: (over.sentKeys ?? []).map((dedupe_key) => ({ dedupe_key })),
      memberships: [{ user_id: "u-owner" }, { user_id: "u-acct" }, { user_id: "u-owner" }],
      organizations: [{ notifications_enabled: true, notification_emails: over.emails === undefined ? ["office@example.test"] : over.emails }],
    },
  });
}

describe("runFinancialFreshnessOnce", () => {
  it("a stale sweep and a failed job: one notify per finding per office user, one email, org-scoped reads", async () => {
    const rec = recorder({
      syncedAt: hoursAgo(50),
      failed: [{ id: "job-9", kind: "efs_window_refetch", error: "numeric field overflow", finished_at: hoursAgo(40) }],
    });
    const fresh = await runFinancialFreshnessOnce(rec.client, env, ORG, NOW);
    expect(fresh.map((f) => f.dedupeKey)).toEqual(["finance:stale:org1:2026-09-03", "finance:job-failed:job-9"]);
    // 2 findings × 2 distinct office users (the duplicate membership row collapses).
    expect(notifyCalls).toHaveLength(4);
    expect(new Set(notifyCalls.map((c) => c.userId))).toEqual(new Set(["u-owner", "u-acct"]));
    expect(notifyCalls.every((c) => c.category === "system" && c.orgId === ORG)).toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toEqual(["office@example.test"]);
    expect(emails[0]!.subject).toBe("Finance data: 2 findings need attention");
    expect(emails[0]!.text).toContain("numeric field overflow");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] }); // read by its own id, like the DQ scheduler
  });

  it("the ledger's keys silence a second run — no notify, no email", async () => {
    const rec = recorder({
      syncedAt: hoursAgo(50),
      failed: [{ id: "job-9", kind: "efs_window_refetch", error: "x", finished_at: hoursAgo(40) }],
      sentKeys: ["finance:stale:org1:2026-09-03", "finance:job-failed:job-9"],
    });
    const fresh = await runFinancialFreshnessOnce(rec.client, env, ORG, NOW);
    expect(fresh).toEqual([]);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it("a fresh sweep with no failures touches nothing — no notify, no email, no recipient lookup", async () => {
    const rec = recorder({ syncedAt: hoursAgo(3) });
    expect(await runFinancialFreshnessOnce(rec.client, env, ORG, NOW)).toEqual([]);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
    expect(rec.queries.some((q) => q.table === "memberships")).toBe(false);
  });

  it("no notification e-mail configured: the ledger rows are still written, the email is not sent", async () => {
    const rec = recorder({ syncedAt: null, emails: [] });
    const fresh = await runFinancialFreshnessOnce(rec.client, env, ORG, NOW);
    expect(fresh[0]?.dedupeKey).toBe("finance:never-swept:org1:2026-09-03");
    expect(notifyCalls).toHaveLength(2);
    expect(emails).toHaveLength(0);
  });
});
