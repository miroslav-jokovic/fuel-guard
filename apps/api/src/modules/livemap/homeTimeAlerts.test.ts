import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHomeTimeOnce } from "./homeTimeAlerts.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecorderFixture, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";

/**
 * Home time's quarter-hourly job (HOME-TIME-PLAN D-HT6, D-HT12, D-HT13): what it closes by itself, what
 * it tells whom, that a second run says nothing twice, and that every read and write is the carrier's.
 */
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("../../lib/mailer.js", () => ({ sendEmail }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-0000-4000-8000-000000000000";
const NOW = new Date("2026-11-13T15:00:00.000Z"); // 09:00 Central
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

const MARCUS = "d0000000-0000-4000-8000-000000000001";
const RAY = "d0000000-0000-4000-8000-000000000002";
const T702 = "a0000000-0000-4000-8000-000000000001";
const T848 = "a0000000-0000-4000-8000-000000000002";
const DANA = "90000000-0000-4000-8000-0000000000a0"; // dispatcher who marked it
const IVO = "90000000-0000-4000-8000-0000000000a1"; // dispatcher who runs VINNIEV
const FRAN = "90000000-0000-4000-8000-0000000000a2"; // fleet manager
const P1 = "50000000-0000-4000-8000-00000000000a";
const P2 = "50000000-0000-4000-8000-00000000000b";

const period = (o: Record<string, unknown> = {}) => ({
  id: P1, org_id: ORG, provider: "silvicom", driver_id: MARCUS, vehicle_id: T702, start_at: hours(-48), expected_return_at: hours(72),
  end_at: null, end_reason: null, canceled_at: null, truck_disposition: "with_driver", created_by: DANA, created_at: hours(-48), updated_at: hours(-48), ...o,
});

interface World {
  periods?: Record<string, unknown>[];
  drivers?: Record<string, unknown>[];
  pickups?: Record<string, unknown>[];
  loads?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  settings?: Record<string, unknown>[];
  dispatchOn?: boolean;
  /** Keys the ledger already holds, as `<user>|<key>` — a second run. */
  sent?: Set<string>;
}

let rec: SupabaseRecorder;
function world(w: World = {}): SupabaseRecorder {
  const sent = w.sent ?? new Set<string>();
  const queued: Record<string, unknown>[] = [];
  const tables: Record<string, RecorderFixture> = {
    driver_time_off: postgrestFixture(w.periods ?? [period()]),
    drivers: postgrestFixture(w.drivers ?? [
      { id: MARCUS, org_id: ORG, full_name: "Marcus Hill", status: "active", archived_at: null },
      { id: RAY, org_id: ORG, full_name: "Ray Diaz", status: "active", archived_at: null },
    ]),
    vehicles: postgrestFixture([
      { id: T702, org_id: ORG, unit_number: "702", status: "active", assigned_driver_id: MARCUS, co_driver_id: null, mcleod_fleet_code: "VINNIEV" },
      { id: T848, org_id: ORG, unit_number: "848", status: "active", assigned_driver_id: RAY, co_driver_id: null, mcleod_fleet_code: "NOBODY" },
    ]),
    load_stops: postgrestFixture(w.pickups ?? []),
    loads: postgrestFixture(w.loads ?? []),
    home_time_settings: postgrestFixture(w.settings ?? []),
    organizations: postgrestFixture([{ id: ORG, operating_hours: { tz: "America/Chicago" } }]),
    tms_dispatchers: postgrestFixture([{ org_id: ORG, provider: "mcleod", external_id: "ivok", display_name: "ivok", is_system: false, is_active: true, user_id: IVO }]),
    tms_fleets: postgrestFixture([
      { org_id: ORG, provider: "mcleod", code: "VINNIEV", dispatcher_external_id: "ivok" },
      { org_id: ORG, provider: "mcleod", code: "NOBODY", dispatcher_external_id: null },
    ]),
    notification_routes: postgrestFixture(w.routes ?? []),
    notification_contacts: postgrestFixture([]),
    notification_deliveries: (q) => (q.write ? [] : postgrestFixture(queued)(q)),
    driver_app_features: [],
    user_profiles: [],
    audit_logs: [],
  };
  rec = createSupabaseRecorder({
    tables,
    rpc: (fn: string, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (fn === "org_module_enabled") return w.dispatchOn !== false;
      if (fn === "org_member_directory") {
        return [
          { user_id: DANA, email: "dana@x.test", full_name: "Dana Dispatch", role: "dispatcher", suspended_at: null },
          { user_id: IVO, email: "ivo@x.test", full_name: "Ivo K", role: "dispatcher", suspended_at: null },
          { user_id: FRAN, email: "fran@x.test", full_name: "Fran Fleet", role: "fleet_manager", suspended_at: null },
        ];
      }
      if (fn === "emit_notification") {
        const key = `${String(a.p_user)}|${String(a.p_dedupe_key)}`;
        if (sent.has(key)) return null;
        sent.add(key);
        return "evt";
      }
      if (fn === "queue_notification_delivery") {
        const fresh = (a.p_items as { key: string; line: string }[]).filter((i) => !sent.has(`${String(a.p_user)}|email:${i.key}`));
        if (fresh.length === 0) return null;
        for (const i of fresh) sent.add(`${String(a.p_user)}|email:${i.key}`);
        const id = `60000000-0000-4000-8000-${String(queued.length + 1).padStart(12, "0")}`;
        queued.push({ id, org_id: ORG, items: fresh });
        return id;
      }
      return null;
    },
  });
  return rec;
}
const bells = () => rec.rpcs().filter((r) => r.fn === "emit_notification").map((r) => r.args as Record<string, unknown>);
const bellTo = (user: string) => bells().filter((b) => b.p_user === user).map((b) => b.p_category);
const ends = () => rec.forTable("driver_time_off").filter((q) => q.write?.method === "update");
const audits = () => rec.writtenRows("audit_logs") as Record<string, unknown>[];
// `user_profiles` is keyed by user (memberLabels' read for somebody who left the carrier).
const EXEMPT = { exempt: ["user_profiles"] };

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, provider: "resend" });
});

describe("a quiet carrier", () => {
  it("costs one read when nobody is on home time", async () => {
    world({ periods: [] });
    expect(await runHomeTimeOnce(rec.client, env, ORG, NOW)).toEqual({ endedLeft: 0, endedOnLoad: 0, bells: 0, emails: 0 });
    expect(rec.queries.map((q) => q.table)).toEqual(["driver_time_off"]);
  });

  it("says nothing about a period that is neither near its return nor past it", async () => {
    world();
    expect(await runHomeTimeOnce(rec.client, env, ORG, NOW)).toEqual({ endedLeft: 0, endedOnLoad: 0, bells: 0, emails: 0 });
    expect(bells()).toEqual([]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("does nothing for a carrier without the Dispatch module", async () => {
    world({ periods: [period({ expected_return_at: hours(-5) })], dispatchOn: false });
    expect(await runHomeTimeOnce(rec.client, env, ORG, NOW)).toEqual({ endedLeft: 0, endedOnLoad: 0, bells: 0, emails: 0 });
    expect(ends()).toEqual([]);
    expect(bells()).toEqual([]);
  });

  it("ignores another carrier's periods and McLeod's windows", async () => {
    world({ periods: [period({ org_id: OTHER_ORG, expected_return_at: hours(-5) }), period({ id: P2, provider: "mcleod", expected_return_at: hours(-5) })] });
    expect((await runHomeTimeOnce(rec.client, env, ORG, NOW)).bells).toBe(0);
  });
});

describe("what it closes by itself (D-HT6)", () => {
  const pickup = (at: string, load = "l-1") => ({ org_id: ORG, load_id: load, kind: "pickup", actual_arrival_at: at });
  const load = (o: Record<string, unknown> = {}) => ({ id: "l-1", org_id: ORG, ref: "0136753", driver_id: MARCUS, co_driver_id: null, ...o });

  it("ends a period at the driver's first pickup after it began, signed by nobody, and audits the load", async () => {
    world({ periods: [period({ expected_return_at: hours(-30) })], pickups: [pickup(hours(-6)), pickup(hours(-2), "l-2")], loads: [load(), load({ id: "l-2", ref: "0136790" })] });
    const r = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(r).toMatchObject({ endedOnLoad: 1, bells: 0 });
    const q = ends()[0]!;
    expect(q.write!.payload).toMatchObject({ end_at: hours(-6), end_reason: "load_evidence", ended_by: null });
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: P1 }, { col: "end_at", val: null }, { col: "canceled_at", val: null }]));
    expect(audits()[0]).toMatchObject({ org_id: ORG, actor_id: null, action: "home_time.auto_ended", entity_id: P1, meta: { driverId: MARCUS, loadRef: "0136753", pickupAt: hours(-6) } });
    // He is hauling: the overstay is not announced.
    expect(bells()).toEqual([]);
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("counts the co-driver's seat as his pickup too", async () => {
    world({ pickups: [pickup(hours(-3))], loads: [load({ driver_id: RAY, co_driver_id: MARCUS })] });
    expect((await runHomeTimeOnce(rec.client, env, ORG, NOW)).endedOnLoad).toBe(1);
  });

  it("does not end on a pickup before the period began, on another driver's, or on one keyed ahead of the clock", async () => {
    world({ pickups: [pickup(hours(-60))], loads: [load()] });
    expect((await runHomeTimeOnce(rec.client, env, ORG, NOW)).endedOnLoad).toBe(0);
    world({ pickups: [pickup(hours(-3))], loads: [load({ driver_id: RAY })] });
    expect((await runHomeTimeOnce(rec.client, env, ORG, NOW)).endedOnLoad).toBe(0);
    world({ pickups: [pickup(hours(5))], loads: [load()] });
    expect((await runHomeTimeOnce(rec.client, env, ORG, NOW)).endedOnLoad).toBe(0);
    expect(ends()).toEqual([]);
  });

  it("asks only for PICKUPS since the earliest live period began — a delivery after the mark is the old load ending", async () => {
    world({ periods: [period({ start_at: hours(-100) }), period({ id: P2, driver_id: RAY, vehicle_id: T848, start_at: hours(-20) })] });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    const q = rec.forTable("load_stops")[0]!;
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "kind", val: "pickup" }, { col: "actual_arrival_at", val: hours(-100) }]));
  });

  it("leaves a scheduled period alone, whatever its driver hauls before it starts", async () => {
    world({ periods: [period({ start_at: hours(20), expected_return_at: hours(200) })], pickups: [pickup(hours(-3))], loads: [load()] });
    expect(await runHomeTimeOnce(rec.client, env, ORG, NOW)).toEqual({ endedLeft: 0, endedOnLoad: 0, bells: 0, emails: 0 });
    expect(rec.forTable("load_stops")).toEqual([]);
  });

  it("ends the period of a driver who left the company, now, and tells nobody he is overdue", async () => {
    world({
      periods: [period({ expected_return_at: hours(-30) })],
      drivers: [{ id: MARCUS, org_id: ORG, full_name: "Marcus Hill", status: "terminated", archived_at: null }],
    });
    const r = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(r).toMatchObject({ endedLeft: 1, bells: 0 });
    expect(ends()[0]!.write!.payload).toMatchObject({ end_at: NOW.toISOString(), end_reason: "driver_left", ended_by: null });
    expect(audits()[0]).toMatchObject({ action: "home_time.auto_ended", actor_id: null, meta: { reason: "driver_left" } });
  });
});

describe("what it tells whom (D-HT12, D-HT15)", () => {
  it("tells whoever marked it and the truck's dispatcher that home time is ending — on the dashboard, with the return on the carrier's clock", async () => {
    world({ periods: [period({ expected_return_at: "2026-11-14T14:00:00.000Z" })] });
    const r = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(r).toMatchObject({ bells: 2, emails: 0 });
    expect(bellTo(DANA)).toEqual(["home_time_return_due"]);
    expect(bellTo(IVO)).toEqual(["home_time_return_due"]);
    expect(bellTo(FRAN)).toEqual([]);
    expect(bells()[0]).toMatchObject({
      p_org: ORG,
      p_title: "Marcus Hill (truck 702) is due back from home time 11/14/2026 8:00 AM",
      p_severity: "info",
      p_entity_type: "driver",
      p_entity_id: MARCUS,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("adds the fleet manager by dashboard and ONE email for an overstay, and records the email's outcome", async () => {
    world({ periods: [period({ expected_return_at: hours(-5) }), period({ id: P2, driver_id: RAY, vehicle_id: T848, created_by: DANA, expected_return_at: hours(-9) })] });
    const r = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(r).toMatchObject({ emails: 1 });
    expect(bellTo(FRAN)).toEqual(["home_time_overdue", "home_time_overdue"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0]![1] as { to: string[]; subject: string; text: string };
    expect(mail.to).toEqual(["fran@x.test"]);
    expect(mail.subject).toBe("Home time overstayed: 2 drivers");
    expect(mail.text).toContain("Marcus Hill (truck 702) is past his home-time return of 11/13/2026 4:00 AM and is not marked back");
    expect(mail.text).toContain("Ray Diaz (truck 848)");
    expect(mail.text).toContain("Open the Dispatch board in Silvicom 360, Home time tab.");
    const outcome = rec.forTable("notification_deliveries").find((q) => q.write?.method === "update")!;
    expect(outcome.write!.payload).toMatchObject({ status: "sent" });
    expect(outcome.filters()).toContainEqual({ col: "org_id", val: ORG });
    expectOrgScoped(rec, ORG, EXEMPT);
  });

  it("records a failed email as failed, and still rings the dashboard", async () => {
    sendEmail.mockResolvedValue({ ok: false, provider: "resend", detail: "rate limited" });
    world({ periods: [period({ expected_return_at: hours(-5) })] });
    const r = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(r).toMatchObject({ emails: 0 });
    expect(r.bells).toBeGreaterThan(0);
    expect(rec.forTable("notification_deliveries").find((q) => q.write?.method === "update")!.write!.payload).toMatchObject({ status: "failed", last_error: "rate limited" });
  });

  it("names nobody as the truck's dispatcher when the fleet has no linked dispatcher, and still tells who marked it", async () => {
    world({ periods: [period({ driver_id: RAY, vehicle_id: T848, expected_return_at: hours(10) })] });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(bellTo(DANA)).toEqual(["home_time_return_due"]);
    expect(bellTo(IVO)).toEqual([]);
  });

  it("falls back to everyone who manages Dispatch when the routes resolve to nobody", async () => {
    // Marked by somebody who has since left, on a truck whose fleet nobody runs.
    world({ periods: [period({ driver_id: RAY, vehicle_id: T848, created_by: "90000000-0000-4000-8000-00000000dead", expected_return_at: hours(10) })] });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(new Set(bells().map((b) => b.p_user))).toEqual(new Set([DANA, IVO, FRAN]));
  });

  it("says a truck has been home too long, with the days", async () => {
    world({ periods: [period({ start_at: hours(-9 * 24), expected_return_at: hours(100) })] });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(bells().map((b) => b.p_title)).toContain("Truck 702 has been at Marcus Hill's home for 9 days");
    expect(bellTo(FRAN)).toEqual(["home_time_truck_limit"]);
  });

  it("uses the carrier's own thresholds and its own routes", async () => {
    world({
      periods: [period({ expected_return_at: hours(40) })],
      settings: [{ org_id: ORG, return_due_hours: 48, overdue_after_hours: 2, truck_limit_days: 30 }],
      routes: [{ org_id: ORG, alert: "home_time_return_due", recipient_kind: "role", recipient_key: "fleet_manager", channel: "bell", enabled: true }],
    });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(bells().map((b) => [b.p_user, b.p_category])).toEqual([[FRAN, "home_time_return_due"]]);
    expect(rec.forTable("notification_routes")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "alert", val: "home_time_return_due" }]));
  });

  it("says a fact once: a second run fifteen minutes later rings and emails nobody", async () => {
    const sent = new Set<string>();
    world({ periods: [period({ expected_return_at: hours(-5) })], sent });
    const first = await runHomeTimeOnce(rec.client, env, ORG, NOW);
    expect(first.bells).toBe(3);
    expect(first.emails).toBe(1);
    world({ periods: [period({ expected_return_at: hours(-5) })], sent });
    const second = await runHomeTimeOnce(rec.client, env, ORG, new Date(NOW.getTime() + 15 * 60_000));
    expect(second).toMatchObject({ bells: 0, emails: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("says it again the next day, and again when the return time is changed", async () => {
    const sent = new Set<string>();
    world({ periods: [period({ expected_return_at: hours(-5) })], sent });
    await runHomeTimeOnce(rec.client, env, ORG, NOW);
    world({ periods: [period({ expected_return_at: hours(-5) })], sent });
    expect((await runHomeTimeOnce(rec.client, env, ORG, new Date(NOW.getTime() + 24 * 3_600_000))).bells).toBe(3);
    // The dispatcher gave him two more days, and he missed those too.
    world({ periods: [period({ expected_return_at: hours(43) })], sent });
    expect((await runHomeTimeOnce(rec.client, env, ORG, new Date(NOW.getTime() + 48 * 3_600_000))).bells).toBe(3);
  });
});
