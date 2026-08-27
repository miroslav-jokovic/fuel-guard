import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { runDqAlertsOnce } from "./dqAlertScheduler.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * C3's done-when: two consecutive runs produce one notify() per alert per recipient and at most one
 * email — the second run is silent because the FIRST run's ledger rows are the second's
 * alreadySentKeys. The planner's dedupe math has its own 13-assertion suite in shared; this proves
 * the SERVICE wiring: horizon, ledger read-back, recipient fan-out, the single batched email, and
 * org scoping on every read.
 */
const ORG = "org1";

const notifyCalls: Array<Record<string, unknown>> = [];
vi.mock("../../services/notify.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    notifyCalls.push(input);
    return "evt";
  }),
}));
const emails: Array<{ to: string[]; subject: string }> = [];
vi.mock("../../lib/mailer.js", () => ({
  sendEmail: vi.fn(async (_env: unknown, email: { to: string[]; subject: string }) => {
    emails.push(email);
    return { sent: true };
  }),
}));

const env = testEnv();
const TODAY = new Date().toISOString().slice(0, 10);
const plus = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

function makeRecorder(sentDedupeKeys: string[] = []) {
  return createSupabaseRecorder({
    tables: {
      drivers: [{ id: "d1", full_name: "Marcus Reyes", status: "active", cdl_number: "D1" }],
      certifications: [
        // 60 days out — visible ONLY at the scheduler's 91-day horizon (C2).
        { subject_id: "d1", kind: "medical_card", qualifier: null, training_type: null, issued_at: null, expires_at: plus(60), document_id: null },
        // Expired 3 days ago — the weekly overdue case.
        { subject_id: "d1", kind: "cdl", qualifier: null, training_type: null, issued_at: null, expires_at: plus(-3), document_id: null },
      ],
      qualification_records: [],
      documents: [],
      notification_events: sentDedupeKeys.map((k) => ({ dedupe_key: k })),
      // The recorder returns fixtures verbatim (filters are RECORDED, not applied) — the office-only
      // narrowing is asserted below against the query's `.in("role", …)` ops instead.
      memberships: [
        { user_id: "u-admin", role: "admin" },
        { user_id: "u-safety", role: "safety_manager" },
      ],
      organizations: { data: [{ notifications_enabled: true, notification_emails: ["office@x.com"] }] },
    },
    rpc: { org_module_enabled: false },
  });
}

describe("runDqAlertsOnce (C3)", () => {
  beforeEach(() => {
    notifyCalls.length = 0;
    emails.length = 0;
  });

  it("first run: sees the 60-day item through the wide horizon, notifies each office user per alert, sends ONE email", async () => {
    const rec = makeRecorder();
    const n = await runDqAlertsOnce(rec.client, env, ORG);
    expect(n).toBe(2); // the 60-day crossing + the overdue CDL

    // 2 alerts × 2 office users — and the membership READ itself must narrow to the office roles,
    // which is what keeps drivers out of the fan-out (D-DQ13).
    expect(notifyCalls).toHaveLength(4);
    expect(new Set(notifyCalls.map((c) => c.userId))).toEqual(new Set(["u-admin", "u-safety"]));
    expect(notifyCalls.every((c) => String(c.dedupeKey).startsWith("dq:"))).toBe(true);
    const membershipQ = rec.queries.find((q) => q.table === "memberships");
    expect(membershipQ!.ops).toContainEqual({
      method: "in",
      args: ["role", ["admin", "fleet_manager", "safety_manager"]],
    });

    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toEqual(["office@x.com"]);
    expect(emails[0]!.subject).toContain("1 expired");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("second run: the first run's ledger keys silence everything — no notify, no email", async () => {
    const first = makeRecorder();
    await runDqAlertsOnce(first.client, env, ORG);
    const keys = [...new Set(notifyCalls.map((c) => String(c.dedupeKey)))];
    notifyCalls.length = 0;
    emails.length = 0;

    const second = makeRecorder(keys);
    const n = await runDqAlertsOnce(second.client, env, ORG);
    expect(n).toBe(0);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it("notifications_enabled=false suppresses the email but never the ledger", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: "d1", full_name: "Marcus Reyes", status: "active", cdl_number: "D1" }],
        certifications: [
          { subject_id: "d1", kind: "cdl", qualifier: null, training_type: null, issued_at: null, expires_at: plus(-3), document_id: null },
        ],
        qualification_records: [],
        documents: [],
        notification_events: [],
        memberships: [{ user_id: "u-admin", role: "admin" }],
        organizations: { data: [{ notifications_enabled: false, notification_emails: ["office@x.com"] }] },
      },
      rpc: { org_module_enabled: false },
    });
    const n = await runDqAlertsOnce(rec.client, env, ORG);
    expect(n).toBe(1);
    expect(notifyCalls).toHaveLength(1);
    expect(emails).toHaveLength(0);
  });
});
