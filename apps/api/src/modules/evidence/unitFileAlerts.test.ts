import { describe, it, expect, vi, beforeEach } from "vitest";
import { organizationTimezone, rolesThatManage, todayInZone } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { runUnitFileAlertsOnce } from "./dqAlertScheduler.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * Truck and trailer file alerts (UNIT-FILES-PLAN UF6b): the unit-files rollup through the DQ alert
 * planner, inside the DQ alert timer. The planner's arithmetic has its own suite in shared
 * (`planFileAlerts, a truck or trailer`); this proves the wiring — a unit at 30 days alerts once and
 * not on the next run, a retired unit is silent, recipients are the equipment managers, one email
 * per subject type, no thumbnail signed, and every read org-scoped.
 */
const ORG = "org1";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const TR1 = "33333333-3333-4333-8333-333333333333";

const notifyCalls: Array<Record<string, unknown>> = [];
// notify() is faked; keysAlreadySent() is the REAL one, so the ledger RPC below is what it reads.
vi.mock("../messaging/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../messaging/index.js")>()),
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
// The run judges on the carrier's day; an org with no operating hours has the default zone.
const TODAY = todayInZone(new Date(), organizationTimezone(null));
const plus = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

const eq = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

const CERTS = [
  // 30 days out: inside equipment's 30-day window, so `expiring` and the 30 threshold.
  { subject_type: "tractor", subject_id: T1, kind: "registration", issued_at: null, expires_at: plus(30), document_id: null },
  // Lapsed, on a truck the carrier no longer runs.
  { subject_type: "tractor", subject_id: T2, kind: "registration", issued_at: null, expires_at: plus(-5), document_id: null },
  { subject_type: "trailer", subject_id: TR1, kind: "registration", issued_at: null, expires_at: plus(-2), document_id: null },
];

const DOCS = [
  { id: "reg1", subject_type: "tractor", subject_id: T1, kind: "registration", content_type: "application/pdf", variant: "original", derived_from: null, storage_path: "o/t/reg1.pdf", captured_at: null, created_at: "2026-03-01T00:00:00Z", uploaded_by: null },
  { id: "reg1t", subject_type: "tractor", subject_id: T1, kind: "registration", content_type: "image/webp", variant: "thumb", derived_from: "reg1", storage_path: "o/t/reg1t.thumb.webp", captured_at: null, created_at: "2026-03-01T00:00:05Z", uploaded_by: null },
];

const ledgerRpc = (sent: string[]) => (fn: string, args: unknown) => {
  if (fn !== "notification_keys_sent") return null;
  const { p_keys } = args as { p_keys: string[] };
  return sent.filter((k) => p_keys.includes(k));
};

const signed: string[][] = [];
function makeRecorder(opts: { sent?: string[]; trailers?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      vehicles: [
        { id: T1, unit_number: "1042", status: "active", ownership_type: "owned", registration_expires_at: null, dot_annual_inspection_expires_at: null },
        { id: T2, unit_number: "700", status: "retired", ownership_type: "owned", registration_expires_at: null, dot_annual_inspection_expires_at: null },
      ],
      trailers: opts.trailers
        ? [{ id: TR1, unit_number: "5310", status: "active", ownership_type: "owned", registration_expires_at: null, dot_annual_inspection_expires_at: null }]
        : [],
      certifications: (q) => CERTS.filter((c) => c.subject_type === eq(q, "subject_type")),
      // A paper with a thumbnail, so a rollup asked for papers WOULD sign one (the mutant that turns
      // `withPapers` on fails the "nothing is signed" line below).
      documents: (q) => (q.ops.some((o) => o.method === "in" && o.args[0] === "id") ? [] : DOCS.filter((d) => d.subject_type === eq(q, "subject_type"))),
      // The recorder returns fixtures verbatim; the equipment narrowing is asserted on the query's ops.
      memberships: [{ user_id: "u-fleet", role: "fleet_manager" }],
      organizations: { data: [{ notifications_enabled: true, notification_emails: ["office@x.com"], operating_hours: null }] },
    },
    storage: {
      createSignedUrls: (paths: string[]) => {
        signed.push(paths);
        return { data: [], error: null };
      },
    },
    rpc: ledgerRpc(opts.sent ?? []),
  });
}

describe("runUnitFileAlertsOnce (UF6b)", () => {
  beforeEach(() => {
    notifyCalls.length = 0;
    emails.length = 0;
    signed.length = 0;
  });

  it("a truck at 30 days alerts once, to the equipment managers, under a unit key; a retired truck is silent", async () => {
    const rec = makeRecorder();
    const n = await runUnitFileAlertsOnce(rec.client, env, ORG);
    expect(n).toBe(1);
    expect(notifyCalls).toEqual([
      expect.objectContaining({
        userId: "u-fleet",
        category: "unit_file_expiring",
        entityType: "tractor",
        entityId: T1,
        dedupeKey: `unit:tractor:${T1}:registration:${plus(30)}:30`,
        title: "Truck 1042 — Registration / IRP cab card expires in 30 days",
      }),
    ]);
    const membershipQ = rec.queries.find((q) => q.table === "memberships");
    expect(membershipQ!.ops).toContainEqual({ method: "in", args: ["role", [...rolesThatManage("equipment")]] });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toBe("Truck file: 1 item expiring");
    expect(emails[0]!.text).toContain("Open Vehicles");
    // Nothing draws a thumbnail here, so nothing is signed.
    expect(signed).toHaveLength(0);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("the next run is silent: the first run's ledger keys hold", async () => {
    await runUnitFileAlertsOnce(makeRecorder().client, env, ORG);
    const keys = notifyCalls.map((c) => String(c.dedupeKey));
    notifyCalls.length = 0;
    emails.length = 0;

    const n = await runUnitFileAlertsOnce(makeRecorder({ sent: keys }).client, env, ORG);
    expect(n).toBe(0);
    expect(notifyCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it("a trailer's lapsed paper is its own email and opens as a trailer", async () => {
    const n = await runUnitFileAlertsOnce(makeRecorder({ trailers: true }).client, env, ORG);
    expect(n).toBe(2);
    const trailer = notifyCalls.find((c) => c.entityType === "trailer");
    expect(trailer).toMatchObject({ category: "unit_file_expired", entityId: TR1 });
    expect(String(trailer!.dedupeKey)).toMatch(new RegExp(`^unit:trailer:${TR1}:registration:overdue:\\d+$`));
    expect(emails.map((e) => e.subject)).toEqual(["Truck file: 1 item expiring", "Trailer file: 1 expired, 0 expiring"]);
  });
});
