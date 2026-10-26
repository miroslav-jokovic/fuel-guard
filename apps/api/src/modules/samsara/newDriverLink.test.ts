// A driver in a truck whose Samsara id no row carries is linked by the five-minute tier — truck 797,
// 2026-10-21: Samsara had driver 61252434 in it and our 797 showed nobody until the 12-hour sync.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { linkNewDriversInTrucks, forgetTriedDrivers, RETRY_MS } from "./newDriverLink.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv();
const NOW = Date.parse("2026-10-21T20:40:00Z");

const KNOWN = { id: "d-known", samsara_driver_id: "5551", full_name: "VINNIE VALLE", phone: null, samsara_username: null, identity_source: "mcleod", status: "active", cdl_number: "X1", archived_at: null };
const NEW_HIRE = { id: "d-new", samsara_driver_id: null, full_name: "SAM SOOALO", phone: null, samsara_username: null, identity_source: "mcleod", status: "active", cdl_number: null, archived_at: null };

/** The drivers read answers by what the `.in("samsara_driver_id", …)` asked, from the rows given. */
function seed(rows: Array<Record<string, unknown>>) {
  return createSupabaseRecorder({
    tables: { drivers: { data: rows }, org_integrations: { data: [{ enabled: true, config: { roster_master: true } }] } },
  });
}

beforeEach(() => forgetTriedDrivers());
afterEach(() => vi.restoreAllMocks());

describe("linkNewDriversInTrucks", () => {
  it("does nothing — no Samsara call — when every driver in a truck is already linked", async () => {
    const rec = seed([KNOWN]);
    const lister = vi.fn(async () => []);
    const r = await linkNewDriversInTrucks(rec.client, env, ORG, ["5551"], { now: NOW, driverLister: lister });
    expect(r).toEqual({ unknown: 0, ran: false, linked: 0 });
    expect(lister).not.toHaveBeenCalled();
    expect(rec.forTable("drivers").filter((q) => q.write)).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("runs the driver sync once for a driver it cannot name, and writes the link onto their row", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const rec = seed([KNOWN, NEW_HIRE]);
    const lister = vi.fn(async () => [{ id: "61252434", name: "Sam Sooalo", driverActivationStatus: "active" }]);
    const r = await linkNewDriversInTrucks(rec.client, env, ORG, ["5551", "61252434", "61252434"], { now: NOW, driverLister: lister });
    expect(lister).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ unknown: 1, ran: true });
    const link = rec.forTable("drivers").find((q) => q.write?.method === "update")!;
    expect(link.write!.payload).toMatchObject({ samsara_driver_id: "61252434" });
    expect(Object.fromEntries(link.filters().map((f) => [f.col, f.val]))).toMatchObject({ id: "d-new", org_id: ORG });
    expectOrgScoped(rec, ORG);
  });

  it("does not ask Samsara again for the same unknown driver until the retry interval has passed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const rec = seed([KNOWN]);
    const lister = vi.fn(async () => []);
    await linkNewDriversInTrucks(rec.client, env, ORG, ["50443650"], { now: NOW, driverLister: lister });
    const again = await linkNewDriversInTrucks(rec.client, env, ORG, ["50443650"], { now: NOW + 5 * 60_000, driverLister: lister });
    expect(again).toEqual({ unknown: 1, ran: false, linked: 0 });
    expect(lister).toHaveBeenCalledTimes(1);
    await linkNewDriversInTrucks(rec.client, env, ORG, ["50443650"], { now: NOW + RETRY_MS, driverLister: lister });
    expect(lister).toHaveBeenCalledTimes(2);
  });

  it("asks at once for a NEW unknown driver even while an older one is waiting out its retry", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const rec = seed([KNOWN]);
    const lister = vi.fn(async () => []);
    await linkNewDriversInTrucks(rec.client, env, ORG, ["50443650"], { now: NOW, driverLister: lister });
    await linkNewDriversInTrucks(rec.client, env, ORG, ["50443650", "61242169"], { now: NOW + 5 * 60_000, driverLister: lister });
    expect(lister).toHaveBeenCalledTimes(2);
  });
});
