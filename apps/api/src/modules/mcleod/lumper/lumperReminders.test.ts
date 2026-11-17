import { beforeEach, describe, expect, it, vi } from "vitest";
import { runLumperRemindersOnce } from "./lumperReminders.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecorderFixture, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";

/**
 * The daily lumper reminder (LUMPER-REVISED-RC-PLAN LRC4): it is silent until switched on (D-LRC9), goes
 * once a weekday morning per carrier whatever the restarts (D-LRC6), names each open case in the one
 * reminder its state asks for (D-LRC4), tells the order's dispatcher and the routes' roles, falls back to
 * the admins, and reads and writes only the carrier's rows.
 */
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/mailer.js", () => ({ sendEmail }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const TUESDAY_0815 = new Date("2026-11-17T14:15:00.000Z"); // 08:15 Central
const TUESDAY_0745 = new Date("2026-11-17T13:45:00.000Z");
const SATURDAY = new Date("2026-11-21T15:00:00.000Z");
const SWEPT = "2026-11-17T13:30:00.000Z";

const KANE = "90000000-0000-4000-8000-0000000000a0"; // dispatcher, McLeod login "kane", linked
const ADA = "90000000-0000-4000-8000-0000000000a1"; // admin
const ACC = "90000000-0000-4000-8000-0000000000a2"; // accountant
const REX = "90000000-0000-4000-8000-0000000000a3"; // recruiter: no Lumper fees screen
const CASE_WAIT = "50000000-0000-4000-8000-00000000000a";
const CASE_BILLED_NO_RC = "50000000-0000-4000-8000-00000000000b";
const CASE_GAP = "50000000-0000-4000-8000-00000000000c";
const CASE_OLD_GAP = "50000000-0000-4000-8000-00000000000d";
const CASE_UNLINKED = "50000000-0000-4000-8000-00000000000e";

const aCase = (id: string, order: string) => ({ id, org_id: ORG, company_id: "TMS", order_id: order, charge_code: "LUM", opened_at: "2026-11-02T12:00:00Z", closed_at: null, closed_by: null, close_reason: null, close_note: null });
const order = (id: string, dispatcher: string | null, seen = SWEPT) => ({
  org_id: ORG, company_id: "TMS", order_id: id, last_seen_at: seen, customer_name: "A Broker", dispatcher_user_id: dispatcher, dispatcher_name: dispatcher,
  consignee_name: "A Warehouse", consignee_city: "Joliet", consignee_state: "IL", consignee_arrived_at: null, consignee_departed_at: null,
});
const payment = (id: string, orderId: string, amount = "310.00") => ({
  org_id: ORG, company_id: "TMS", payment_id: id, settlement_state: "paid", order_id: orderId, deduct_code: "UNL", amount,
  transacted_at: "2026-11-02T00:00:00Z", reference_no: `EFS-${id}`, driver_code: "DRV1", tractor_unit: "101", is_void: false,
});
const charge = (orderId: string) => ({ org_id: ORG, company_id: "TMS", charge_id: `OC-${orderId}`, order_id: orderId, charge_code: "LUM", descr: "Unloading", amount: "310.00" });
const bill = (orderId: string, lumper: string) => ({ org_id: ORG, company_id: "TMS", bill_id: `B-${orderId}`, order_id: orderId, bill_type: "I", bill_date: "2026-11-05T00:00:00Z", invoice_no: `INV-${orderId}`, lumper_amount: lumper });

interface World {
  on?: boolean | null;
  claimed?: string[];
  routes?: Record<string, unknown>[];
  sweptAt?: string | null;
  failCases?: boolean;
  dispatchOn?: boolean;
  userSurfaces?: Record<string, unknown>[];
  sent?: Set<string>;
}

let rec: SupabaseRecorder;
let runs: FixtureRow[];
function world(w: World = {}): SupabaseRecorder {
  const sent = w.sent ?? new Set<string>();
  runs = (w.claimed ?? []).map((d) => ({ org_id: ORG, run_on: d, finished_at: "2026-11-17T14:00:00Z" }));
  const queued: Record<string, unknown>[] = [];
  const cases = [aCase(CASE_WAIT, "A"), aCase(CASE_BILLED_NO_RC, "B"), aCase(CASE_GAP, "C"), aCase(CASE_OLD_GAP, "D"), aCase(CASE_UNLINKED, "E")];
  const tables: Record<string, RecorderFixture> = {
    lumper_reminder_settings: postgrestFixture(w.on === null ? [] : [{ org_id: ORG, reminders_on: w.on ?? true, updated_by: ADA, updated_at: "2026-11-16T12:00:00Z" }]),
    lumper_reminder_runs: (q) => {
      if (q.write?.method === "insert") {
        const row = q.write.payload as FixtureRow;
        if (runs.some((r) => r.run_on === row.run_on)) return { data: null, error: { code: "23505", message: "duplicate key" }, writeError: { code: "23505", message: "duplicate key" } };
        runs.push({ ...row, finished_at: null });
        return [];
      }
      if (q.write?.method === "delete") {
        runs = runs.filter((r) => !(r.finished_at === null));
        return [];
      }
      if (q.write?.method === "update") {
        for (const r of runs) Object.assign(r, q.write.payload as object);
        return [];
      }
      return postgrestFixture(runs)(q);
    },
    organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
    lumper_cases: w.failCases ? { error: { message: "connection reset" } } : postgrestFixture(cases),
    mcleod_lumper_orders: postgrestFixture([order("A", "kane"), order("B", "kane"), order("C", "kane"), order("D", "kane", "2026-08-01T13:00:00.000Z"), order("E", "steve")]),
    mcleod_lumper_charges: postgrestFixture([charge("A"), charge("B"), charge("C"), charge("D"), charge("E")]),
    mcleod_lumper_payments: postgrestFixture([payment("P1", "A"), payment("P2", "B"), payment("P3", "C"), payment("P4", "D"), payment("P5", "E")]),
    // B invoiced with its lumper, no RC on file; C and D invoiced without it (D's facts are from August).
    mcleod_lumper_bills: postgrestFixture([bill("B", "310.00"), bill("C", "0.00"), bill("D", "0.00")]),
    lumper_case_files: postgrestFixture([]),
    mcleod_lumper_sweeps: postgrestFixture(w.sweptAt === null ? [] : [{ org_id: ORG, company_id: "TMS", swept_at: w.sweptAt ?? SWEPT }]),
    tms_dispatchers: postgrestFixture([
      { org_id: ORG, provider: "mcleod", external_id: "kane", display_name: "kane", is_system: false, is_active: true, user_id: KANE },
      { org_id: ORG, provider: "mcleod", external_id: "steve", display_name: "steve", is_system: false, is_active: true, user_id: null },
    ]),
    tms_fleets: postgrestFixture([]),
    notification_routes: postgrestFixture(w.routes ?? []),
    org_section_access: postgrestFixture([]),
    user_section_access: postgrestFixture([]),
    org_role_surface_access: postgrestFixture([]),
    user_surface_access: postgrestFixture(w.userSurfaces ?? []),
    notification_contacts: postgrestFixture([]),
    notification_channel_settings: [],
    notification_deliveries: (q) => (q.write ? [] : postgrestFixture(queued)(q)),
    driver_app_features: [],
    user_profiles: [],
  };
  rec = createSupabaseRecorder({
    tables,
    rpc: (fn: string, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (fn === "org_module_enabled") return w.dispatchOn !== false;
      if (fn === "org_member_directory") {
        return [
          { user_id: KANE, email: "kane@x.test", full_name: "Kane Dispatch", role: "dispatcher", suspended_at: null },
          { user_id: ADA, email: "ada@x.test", full_name: "Ada Admin", role: "admin", suspended_at: null },
          { user_id: ACC, email: "acc@x.test", full_name: "Acc Ounting", role: "accountant", suspended_at: null },
          { user_id: REX, email: "rex@x.test", full_name: "Rex Recruit", role: "recruiter", suspended_at: null },
        ];
      }
      if (fn === "emit_notification") {
        const key = `${String(a.p_user)}|${String(a.p_dedupe_key)}`;
        if (sent.has(key)) return null;
        sent.add(key);
        return "evt";
      }
      if (fn === "queue_notification_delivery") {
        const claim = (i: { key: string }) => `${String(a.p_user)}|${String(a.p_channel)}:${i.key}`;
        const fresh = (a.p_items as { key: string; line: string }[]).filter((i) => !sent.has(claim(i)));
        if (fresh.length === 0) return null;
        for (const i of fresh) sent.add(claim(i));
        const id = `60000000-0000-4000-8000-${String(queued.length + 1).padStart(12, "0")}`;
        queued.push({ id, org_id: ORG, user_id: a.p_user, destination: a.p_destination, title: a.p_title, items: fresh, not_before: a.p_not_before });
        return id;
      }
      return null;
    },
  });
  return rec;
}
const bells = () => rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);
const bellsTo = (user: string) => bells().filter((b) => b.p_user === user).map((b) => [b.p_category, b.p_title]);
const emailTo = (addr: string) => sendEmail.mock.calls.map((c) => c[1] as { to: string[]; subject: string; text: string }).filter((m) => m.to.includes(addr));
// `user_profiles` is keyed by the person.
const EXEMPT = { exempt: ["user_profiles"] };

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, provider: "resend" });
});

describe("silent until a person switches it on (D-LRC9)", () => {
  it("sends nothing, and reads nothing else, for a carrier with no setting or with it off", async () => {
    for (const on of [null, false]) {
      world({ on });
      expect(await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815)).toMatchObject({ sent: null, skipped: "off" });
      expect(rec.queries.map((q) => q.table)).toEqual(["lumper_reminder_settings"]);
    }
  });
});

describe("once a weekday morning (Q-LRC2, D-LRC6)", () => {
  it("is not due before 08:00 Central or at the weekend, and claims nothing", async () => {
    for (const at of [TUESDAY_0745, SATURDAY]) {
      world();
      expect(await runLumperRemindersOnce(rec.client, env, ORG, at)).toMatchObject({ skipped: "not_due" });
      expect(rec.writes()).toEqual([]);
    }
  });

  it("sends a morning once: a second tick, or another process, finds the day claimed and sends nothing", async () => {
    const sent = new Set<string>();
    world({ sent });
    const first = await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815);
    expect(first.sent).toBe("2026-11-17");
    expect(runs).toEqual([expect.objectContaining({ run_on: "2026-11-17", cases: 4, finished_at: expect.any(String) })]);
    const claimed = runs.map((r) => String(r.run_on));
    world({ sent, claimed });
    expect(await runLumperRemindersOnce(rec.client, env, ORG, new Date("2026-11-17T20:00:00Z"))).toMatchObject({ sent: null, skipped: "already_sent" });
    expect(bells()).toEqual([]);
    expect(sendEmail).toHaveBeenCalledTimes(first.emails);
  });

  it("gives the day back when the run fails, so the next tick sends it", async () => {
    world({ failCases: true });
    await expect(runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815)).rejects.toThrow(/connection reset/);
    expect(runs).toEqual([]);
  });

  it("sends nothing before the first McLeod read, and keeps the day unclaimed", async () => {
    world({ sweptAt: null });
    expect(await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815)).toMatchObject({ skipped: "never_read" });
    expect(runs).toEqual([]);
    expect(bells()).toEqual([]);
  });

  it("skips a carrier without the Dispatch module", async () => {
    world({ dispatchOn: false });
    expect(await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815)).toMatchObject({ skipped: "no_module" });
    expect(runs).toEqual([]);
  });
});

describe("who hears about which load (D-LRC4, D-LRC6, Q-LRC5)", () => {
  it("gives each person one bell per reminder counting their loads, and one email listing them", async () => {
    world();
    const r = await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815);
    // A (waiting), B (billed, no RC), C (billed without the lumper), E (waiting, dispatcher not linked).
    // D is billed without the lumper too, but its facts are from August: not a billing reminder (Q-LRC9).
    expect(r.cases).toBe(4);
    expect(bellsTo(KANE)).toEqual([
      ["lumper_rc_waiting", "Revised RC missing on 1 load"],
      ["lumper_rc_missing_billed", "Invoiced without the revised RC on 1 load"],
    ]);
    // The admin is a default "chosen person" on the dashboard for every reminder: A and E, B, C.
    expect(bellsTo(ADA)).toEqual([
      ["lumper_rc_waiting", "Revised RC missing on 2 loads"],
      ["lumper_rc_missing_billed", "Invoiced without the revised RC on 1 load"],
      ["lumper_billing_gap", "Lumper not billed in full on 1 load"],
    ]);
    expect(bellsTo(ACC).map(([k]) => k)).toEqual(["lumper_rc_missing_billed", "lumper_billing_gap"]);
    expect(bellsTo(REX)).toEqual([]);
    const kane = emailTo("kane@x.test");
    expect(kane.map((m) => m.subject)).toEqual([
      "Revised RC missing: Order A · A Broker · paid $310.00 on 11/02/2026 · Joliet, IL",
      "Invoiced without the revised RC: Order B · A Broker · paid $310.00 on 11/02/2026 · Joliet, IL",
    ]);
    expect(kane[0]!.text).toContain("Open Dispatch > Lumper fees in Silvicom 360.");
    expect(emailTo("acc@x.test").map((m) => m.subject)).toEqual([
      "Invoiced without the revised RC: Order B · A Broker · paid $310.00 on 11/02/2026 · Joliet, IL",
      "Lumper not billed in full: Order C · A Broker · paid $310.00 on 11/02/2026 · Joliet, IL · invoiced with no lumper",
    ]);
    expect(bells().every((b) => String(b.p_dedupe_key).startsWith("lumper:") && String(b.p_dedupe_key).endsWith(":2026-11-17"))).toBe(true);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("tells nobody who the carrier took the Lumper fees screen from, even the order's dispatcher", async () => {
    world({ userSurfaces: [{ org_id: ORG, user_id: KANE, surface_key: "dispatch.lumper-cases", allowed: false }] });
    await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815);
    expect(bellsTo(KANE)).toEqual([]);
    expect(emailTo("kane@x.test")).toEqual([]);
  });

  it("falls back to the admins on the dashboard when the routes reach nobody for a load", async () => {
    // The carrier routes the RC reminder to the order's dispatcher only; load E's dispatcher is not linked.
    world({ routes: [{ org_id: ORG, alert: "lumper_rc_waiting", recipient_kind: "relation", recipient_key: "order_dispatcher", channel: "bell", enabled: true }] });
    await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815);
    expect(bellsTo(KANE).filter(([k]) => k === "lumper_rc_waiting")).toEqual([["lumper_rc_waiting", "Revised RC missing on 1 load"]]);
    expect(bellsTo(ADA).filter(([k]) => k === "lumper_rc_waiting")).toEqual([["lumper_rc_waiting", "Revised RC missing on 1 load"]]);
  });

  it("says on the bell when McLeod was last read, once that is over a day", async () => {
    world({ sweptAt: "2026-11-14T13:30:00.000Z" });
    await runLumperRemindersOnce(rec.client, env, ORG, TUESDAY_0815);
    expect(bellsTo(KANE)[0]![1]).toBe("Revised RC missing on 1 load (McLeod last read 11/14/2026)");
  });
});
