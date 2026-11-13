import { beforeEach, describe, expect, it } from "vitest";
import { HOME_TIME_DEFAULTS, needsAttention, type DispatchBoardRow } from "@silvicom/shared";
import { __resetDispatchBoardCaches, readDispatchBoard, withHomeTimes } from "./dispatchBoard.js";
import { createSupabaseRecorder, expectOrgScoped, type RecorderFixture } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import type { HomeTimeRow } from "../roster/index.js";

/**
 * Home time on the dispatch board (HOME-TIME-PLAN D-HT9..D-HT11): each seat's live period is merged
 * into its truck's row after the row cache — the chips, the urgent flag, and Available reading "Home
 * until" when every seat is home and the truck is with one of them.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const READER = { userId: "7e3c1a2b-0000-4000-8000-000000000001", role: "dispatcher" as const, sections: null };
const NOW = new Date("2026-11-13T15:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

const ANA = { id: "d0000000-0000-4000-8000-000000000001", name: "Ana Ruiz" };
const BEN = { id: "d0000000-0000-4000-8000-000000000002", name: "Ben Cole" };

const period = (o: Partial<HomeTimeRow> = {}): HomeTimeRow => ({
  id: "50000000-0000-4000-8000-000000000001",
  driver_id: ANA.id,
  vehicle_id: "veh-773",
  start_at: hours(-48),
  expected_return_at: hours(72),
  end_at: null,
  end_reason: null,
  canceled_at: null,
  truck_disposition: "with_driver",
  created_by: null,
  created_at: hours(-48),
  updated_at: hours(-48),
  ...o,
});

/** An empty truck standing in Joliet, as `readBoardRows` would hand it over. */
const row = (o: Partial<DispatchBoardRow> = {}): DispatchBoardRow =>
  ({
    vehicleId: "veh-773",
    unitNumber: "773",
    inShop: false,
    fleetCode: "VINNIEV",
    driver: ANA,
    coDriver: null,
    hos: null,
    position: { place: "Joliet, IL, 60431", lat: 41.5, lng: -88.1, speedMph: 0, sampledAt: hours(0), ageSeconds: 20 },
    fuelPercent: null,
    current: null,
    trailerId: null,
    next: null,
    eta: null,
    onTime: "unknown",
    available: { place: "Joliet, IL, 60431", city: "Joliet", state: "IL", postalCode: "60431", lat: 41.5, lng: -88.1, at: NOW.toISOString(), basis: "now" },
    milesLeft: null,
    warnings: [],
    noteMentions: [],
    homeTimes: [],
    flags: { lateRisk: false, noNextLoad: false, emptyNow: true, hosLow: false, noGps: false, warningUrgent: false, homeTimeUrgent: false },
    ...o,
  }) as DispatchBoardRow;

const merged = (r: DispatchBoardRow, periods: HomeTimeRow[]) => withHomeTimes([r], periods, HOME_TIME_DEFAULTS, NOW)[0]!;

describe("withHomeTimes — a solo truck", () => {
  it("leaves a row alone when nobody on it is home", () => {
    const r = row();
    expect(merged(r, [period({ driver_id: BEN.id })])).toBe(r);
    expect(withHomeTimes([r], [], HOME_TIME_DEFAULTS, NOW)[0]).toBe(r);
  });

  it("holds the truck when it is home with its driver: Available is the return, where the truck stands, and it is not 'empty now'", () => {
    const r = merged(row(), [period()]);
    expect(r.available).toEqual({ place: "Joliet, IL, 60431", city: "Joliet", state: "IL", postalCode: "60431", lat: 41.5, lng: -88.1, at: hours(72), basis: "home_time" });
    expect(r.flags.emptyNow).toBe(false);
    expect(r.homeTimes).toEqual([
      { periodId: period().id, driverId: ANA.id, driverName: "Ana Ruiz", state: "active", startAt: hours(-48), expectedReturnAt: hours(72), disposition: "with_driver", chips: [] },
    ]);
    expect(r.flags.homeTimeUrgent).toBe(false);
  });

  it("does not hold a truck left at the yard: it stays free now, and the chip says whose driver is home", () => {
    const r = merged(row(), [period({ truck_disposition: "at_yard" })]);
    expect(r.available!.basis).toBe("now");
    expect(r.flags.emptyNow).toBe(true);
    expect(r.homeTimes[0]!.chips).toEqual(["home"]);
  });

  it("warns inside the carrier's window and stays calm", () => {
    const r = merged(row(), [period({ expected_return_at: hours(20) })]);
    expect(r.homeTimes[0]!.chips).toEqual(["return_due"]);
    expect(r.flags.homeTimeUrgent).toBe(false);
    expect(needsAttention(r.flags)).toBe(false);
  });

  it("calls an overstay urgent, keeps holding the truck, and puts the row in Needs attention", () => {
    const r = merged(row(), [period({ expected_return_at: hours(-5) })]);
    expect(r.homeTimes[0]).toMatchObject({ state: "overdue", chips: ["overdue"] });
    expect(r.available).toMatchObject({ basis: "home_time", at: hours(-5) });
    expect(r.flags.homeTimeUrgent).toBe(true);
    expect(needsAttention(r.flags)).toBe(true);
  });

  it("calls a truck at home past the limit urgent", () => {
    const r = merged(row(), [period({ start_at: hours(-9 * 24), expected_return_at: hours(48) })]);
    expect(r.homeTimes[0]!.chips).toEqual(["truck_limit"]);
    expect(r.flags.homeTimeUrgent).toBe(true);
  });

  it("uses the carrier's own thresholds", () => {
    const r = withHomeTimes([row()], [period({ start_at: hours(-3 * 24), expected_return_at: hours(40) })], { returnDueHours: 48, overdueAfterHours: 2, truckLimitDays: 3 }, NOW)[0]!;
    expect(r.homeTimes[0]!.chips).toEqual(["truck_limit", "return_due"]);
  });

  it("says a scheduled period is coming and holds nothing", () => {
    const r = merged(row(), [period({ start_at: hours(30), expected_return_at: hours(200) })]);
    expect(r.homeTimes[0]).toMatchObject({ state: "scheduled", chips: ["scheduled"] });
    expect(r.available!.basis).toBe("now");
    expect(r.flags.emptyNow).toBe(true);
  });

  it("never holds a truck that carries a load or stands in the shop — but still shows the chip", () => {
    const loaded = row({ current: { loadId: "l-1" } as DispatchBoardRow["current"], available: { place: "Indianapolis, IN", city: "Indianapolis", state: "IN", postalCode: null, lat: 39.7, lng: -86.1, at: hours(6), basis: "appointment" }, flags: { ...row().flags, emptyNow: false } });
    const a = merged(loaded, [period()]);
    expect(a.available!.basis).toBe("appointment");
    expect(a.homeTimes[0]!.chips).toEqual(["home"]);
    const shop = merged(row({ inShop: true, flags: { ...row().flags, emptyNow: false } }), [period()]);
    expect(shop.available!.basis).toBe("now");
    expect(shop.homeTimes[0]!.chips).toEqual(["home"]);
  });

  it("holds a truck with no GPS position too: the time is known even when the place is not", () => {
    const r = merged(row({ position: null, available: null }), [period()]);
    expect(r.available).toEqual({ place: null, city: null, state: null, postalCode: null, lat: null, lng: null, at: hours(72), basis: "home_time" });
  });

  it("shows the newest of two live periods (a merge of two drivers who were both home)", () => {
    const newest = period({ id: "50000000-0000-4000-8000-000000000002", start_at: hours(-10), expected_return_at: hours(100) });
    const r = merged(row(), [newest, period()]);
    expect(r.homeTimes).toHaveLength(1);
    expect(r.homeTimes[0]!.periodId).toBe(newest.id);
  });
});

describe("withHomeTimes — a team truck", () => {
  const team = () => row({ coDriver: BEN });

  it("keeps running with one seat home, and names him", () => {
    const r = merged(team(), [period({ driver_id: BEN.id })]);
    expect(r.available!.basis).toBe("now");
    expect(r.flags.emptyNow).toBe(true);
    expect(r.homeTimes).toHaveLength(1);
    expect(r.homeTimes[0]).toMatchObject({ driverId: BEN.id, driverName: "Ben Cole", chips: ["home"] });
  });

  it("is held when both seats are home, until the later return", () => {
    const r = merged(team(), [
      period({ expected_return_at: hours(48) }),
      period({ id: "50000000-0000-4000-8000-000000000003", driver_id: BEN.id, truck_disposition: "at_yard", expected_return_at: hours(96) }),
    ]);
    expect(r.available).toMatchObject({ basis: "home_time", at: hours(96) });
    expect(r.homeTimes.map((h) => h.driverName)).toEqual(["Ana Ruiz", "Ben Cole"]);
    // Available says it, so neither seat repeats it.
    expect(r.homeTimes.map((h) => h.chips)).toEqual([[], []]);
  });
});

describe("the board's composition", () => {
  beforeEach(() => __resetDispatchBoardCaches());

  const tables = (periods: Record<string, unknown>[], settings: Record<string, unknown>[] = []): Record<string, RecorderFixture> => ({
    vehicles: { data: [{ id: "veh-773", unit_number: "773", status: "active", assigned_driver_id: ANA.id, mcleod_fleet_code: "VINNIEV" }] },
    drivers: { data: [{ id: ANA.id, first_name: "Ana", last_name: "Ruiz", full_name: "Ana Ruiz", status: "active", samsara_driver_id: "5551" }] },
    vehicle_positions: {
      data: [{ vehicle_id: "veh-773", lat: 41.525, lng: -88.0817, heading_degrees: 0, speed_mph: 0, is_ecu_speed: true, formatted_location: "Joliet, IL, 60431", sampled_at: hours(0), received_at: hours(0), engine_state: "off" }],
    },
    driver_time_off: postgrestFixture(periods),
    home_time_settings: postgrestFixture(settings),
  });
  const live = (o: Record<string, unknown> = {}) => ({ ...period(), org_id: ORG, provider: "silvicom", ...o });

  it("reads the carrier's live periods, org-scoped, and shows a driver's home time on his truck's row", async () => {
    const rec = createSupabaseRecorder({ tables: tables([live()]), rpc: { org_module_enabled: false } });
    const board = await readDispatchBoard(rec.client, ORG, READER, NOW);
    const r = board.rows[0]!;
    expect(r.available).toMatchObject({ basis: "home_time", at: hours(72), state: "IL" });
    expect(r.homeTimes[0]).toMatchObject({ driverName: "Ana Ruiz", state: "active" });
    expect(r.flags.emptyNow).toBe(false);
    const q = rec.forTable("driver_time_off")[0]!;
    expect(q.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "provider", val: "silvicom" }, { col: "end_at", val: null }, { col: "canceled_at", val: null }]));
    expectOrgScoped(rec, ORG);
  });

  it("ignores an ended period, a canceled one, another carrier's and a McLeod window", async () => {
    const rec = createSupabaseRecorder({
      tables: tables([
        live({ id: "50000000-0000-4000-8000-00000000000a", end_at: hours(-1), end_reason: "returned" }),
        live({ id: "50000000-0000-4000-8000-00000000000b", canceled_at: hours(-1) }),
        live({ id: "50000000-0000-4000-8000-00000000000c", org_id: "99999999-0000-4000-8000-000000000000" }),
        live({ id: "50000000-0000-4000-8000-00000000000d", provider: "mcleod" }),
      ]),
      rpc: { org_module_enabled: false },
    });
    const r = (await readDispatchBoard(rec.client, ORG, READER, NOW)).rows[0]!;
    expect(r.homeTimes).toEqual([]);
    expect(r.available!.basis).toBe("now");
    expect(r.flags.emptyNow).toBe(true);
  });

  it("judges the chips on the carrier's saved thresholds", async () => {
    const rec = createSupabaseRecorder({
      tables: tables([live({ expected_return_at: hours(40) })], [{ org_id: ORG, return_due_hours: 48, overdue_after_hours: 2, truck_limit_days: 30 }]),
      rpc: { org_module_enabled: false },
    });
    expect((await readDispatchBoard(rec.client, ORG, READER, NOW)).rows[0]!.homeTimes[0]!.chips).toEqual(["return_due"]);
    expect(rec.forTable("home_time_settings")[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });

  it("shows a mark on the very next read, although the rows themselves are cached", async () => {
    const periods: Record<string, unknown>[] = [];
    const rec = createSupabaseRecorder({ tables: tables(periods), rpc: { org_module_enabled: false } });
    expect((await readDispatchBoard(rec.client, ORG, READER, NOW)).rows[0]!.homeTimes).toEqual([]);
    periods.push(live());
    const again = await readDispatchBoard(rec.client, ORG, READER, new Date(NOW.getTime() + 1000));
    expect(again.rows[0]!.homeTimes).toHaveLength(1);
    // One composition of the rows, two reads of the periods.
    expect(rec.forTable("vehicles")).toHaveLength(1);
    expect(rec.forTable("driver_time_off")).toHaveLength(2);
  });
});
