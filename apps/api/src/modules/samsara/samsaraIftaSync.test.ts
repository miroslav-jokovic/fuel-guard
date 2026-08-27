import { describe, it, expect } from "vitest";
import { parseIftaVehicleReport, type RawIftaResponse } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { isProvisionalMonth, monthsToSync, syncIftaMilesForMonth } from "./samsaraIftaSync.js";

/**
 * The server side of the IFTA pull. Its parsing is tested in `packages/shared`; what is only testable
 * here is everything that makes the pull a RECORD rather than a fetch:
 *
 *   • it reads only this org's vehicles — `admin` is the service role and bypasses RLS, so the
 *     `.eq("org_id", …)` is the only tenant boundary between one carrier's tax miles and another's;
 *   • a vehicle Samsara reports that we cannot join is COUNTED, because it means the fleet and the
 *     telematics account disagree about what exists — a finding for a human, not a row to drop;
 *   • it writes metres, not miles. A conversion here would bake this month's policy into stored data.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENV = { SAMSARA_API_URL: "https://api.samsara.test" } as unknown as Parameters<typeof syncIftaMilesForMonth>[1];

const body = (reports: unknown[], troubleshooting: Record<string, unknown> = {}): RawIftaResponse => ({
  data: {
    year: 2026, month: "April",
    vehicleReports: reports as never,
    troubleshooting: { noPurchasesFound: false, unassignedFuelTypeVehicles: 187, ...troubleshooting },
  },
});

const report = (reports: unknown[], t?: Record<string, unknown>) => parseIftaVehicleReport(body(reports, t));

/** Two of our trucks; `s-3` is Samsara-only and must be counted rather than written. */
const seed = () =>
  createSupabaseRecorder({
    tables: {
      vehicles: [
        { id: "v1", samsara_vehicle_id: "s-1" },
        { id: "v2", samsara_vehicle_id: "s-2" },
      ],
      samsara_ifta_fetches: { data: { id: "fetch-1" } },
      samsara_ifta_jurisdiction_miles: [],
    },
  });

const TWO_TRUCKS = [
  { vehicle: { id: "s-1", name: "701" }, jurisdictions: [
    { jurisdiction: "TX", taxableMeters: 8570727.866541315, totalMeters: 8570727.866541315, taxPaidLiters: 0 },
    { jurisdiction: "CA", taxableMeters: 2336991.399, totalMeters: 2336991.399 },
  ] },
  { vehicle: { id: "s-2", name: "702" }, jurisdictions: [
    { jurisdiction: "AZ", taxableMeters: 1000, totalMeters: 1100, taxPaidLiters: 12.5 },
  ] },
];

const run = (rec: ReturnType<typeof seed>, reports: unknown[], t?: Record<string, unknown>) =>
  syncIftaMilesForMonth(rec.client, ENV, ORG, 2026, "April", {
    fetcherOverride: async () => report(reports, t),
    now: new Date("2026-08-26T12:00:00Z"),
  });

describe("syncIftaMilesForMonth", () => {
  it("scopes every tenant query to one organization", async () => {
    const rec = seed();
    await run(rec, TWO_TRUCKS);
    expectOrgScoped(rec, ORG);
  });

  it("writes METRES, exactly as Samsara sent them", async () => {
    // A miles figure in this table would be a policy — which conversion, what rounding — baked into
    // stored data, and unfixable for history without re-fetching a period Samsara may have restated.
    const rec = seed();
    await run(rec, TWO_TRUCKS);
    const rows = rec.writtenRows("samsara_ifta_jurisdiction_miles");
    const tx = rows.find((r) => (r as { jurisdiction: string }).jurisdiction === "TX")!;
    expect(tx).toMatchObject({ taxable_meters: 8570727.866541315, period_year: 2026, period_month: 4 });
  });

  it("joins Samsara's vehicle id to ours and keeps both", async () => {
    const rec = seed();
    await run(rec, TWO_TRUCKS);
    const rows = rec.writtenRows("samsara_ifta_jurisdiction_miles") as Record<string, unknown>[];
    expect(rows.every((r) => r.vehicle_id === "v1" || r.vehicle_id === "v2")).toBe(true);
    expect(rows.find((r) => r.jurisdiction === "AZ")).toMatchObject({ vehicle_id: "v2", samsara_vehicle_id: "s-2" });
  });

  it("counts a vehicle it cannot map instead of dropping it silently", async () => {
    const rec = seed();
    const r = await run(rec, [
      ...TWO_TRUCKS,
      { vehicle: { id: "s-3", name: "GHOST" }, jurisdictions: [{ jurisdiction: "NM", taxableMeters: 500 }] },
    ]);
    expect(r.unmappedVehicles).toBe(1);
    expect(r.vehiclesReported).toBe(3);
    // …and its miles are not written against somebody else's truck.
    const rows = rec.writtenRows("samsara_ifta_jurisdiction_miles") as Record<string, unknown>[];
    expect(rows.some((x) => x.jurisdiction === "NM")).toBe(false);
    expect(rec.writtenRows("samsara_ifta_fetches")[0]).toMatchObject({ unmapped_vehicles: 1 });
  });

  it("stores Samsara's troubleshooting block rather than logging it", async () => {
    // 187 vehicles with no fuel type is WHY Samsara's own fuel figure is 668 gallons a quarter against
    // our 439,153. Without it beside the number, the number cannot be explained.
    const rec = seed();
    await run(rec, TWO_TRUCKS);
    expect(rec.writtenRows("samsara_ifta_fetches")[0]).toMatchObject({
      troubleshooting: expect.objectContaining({ unassignedFuelTypeVehicles: 187 }),
    });
  });

  it("records what Samsara said it answered, not only what we asked for", async () => {
    // Asking for April and being handed May is obvious in a response and invisible once rows are stored.
    const rec = seed();
    await run(rec, TWO_TRUCKS);
    expect(rec.writtenRows("samsara_ifta_fetches")[0]).toMatchObject({ echoed_year: 2026, echoed_month: "April" });
  });

  it("writes a fetch row even when the month is empty, so a silent zero is distinguishable", async () => {
    const rec = seed();
    const r = await run(rec, []);
    expect(r.rows).toBe(0);
    expect(rec.writtenRows("samsara_ifta_fetches")).toHaveLength(1);
    expect(rec.writtenRows("samsara_ifta_jurisdiction_miles")).toHaveLength(0);
  });

  it("refuses a month name the endpoint does not accept", async () => {
    const rec = seed();
    await expect(
      syncIftaMilesForMonth(rec.client, ENV, ORG, 2026, "Apr", { fetcherOverride: async () => report([]) }),
    ).rejects.toThrow(/IFTA month/);
  });
});

describe("isProvisionalMonth", () => {
  it("marks a month whose end is inside Samsara's 72-hour processing window", () => {
    // August 2026 ends on the 31st; on the 26th the month is still open, so it is provisional.
    expect(isProvisionalMonth(2026, 8, new Date("2026-08-26T12:00:00Z"))).toBe(true);
    // Two days after it closes, still inside the window.
    expect(isProvisionalMonth(2026, 8, new Date("2026-09-02T12:00:00Z"))).toBe(true);
  });

  it("settles a month once the window has passed", () => {
    expect(isProvisionalMonth(2026, 8, new Date("2026-09-05T12:00:00Z"))).toBe(false);
    expect(isProvisionalMonth(2026, 4, new Date("2026-08-26T12:00:00Z"))).toBe(false);
  });

  it("is carried onto the stored fetch, so a surface can say the figure may still move", async () => {
    const rec = seed();
    const r = await syncIftaMilesForMonth(rec.client, ENV, ORG, 2026, "August", {
      fetcherOverride: async () => report(TWO_TRUCKS),
      now: new Date("2026-08-26T12:00:00Z"),
    });
    expect(r.provisional).toBe(true);
    expect(rec.writtenRows("samsara_ifta_fetches")[0]).toMatchObject({ provisional: true });
  });
});

describe("monthsToSync", () => {
  /**
   * ── THE CURRENT MONTH IS NEVER SYNCED, AND THIS IS THE TEST THAT WOULD HAVE CAUGHT IT ───────────
   * Samsara returns HTTP 400 for a month in progress — "IFTA data may still be processing. Please
   * request data prior to 2026-08-01" — not a warning, a refusal. The first version of this function
   * put the current month first and the handler iterated without catching, so every scheduled run
   * would have thrown on request one and the completed months behind it would never have been
   * fetched. Measured while running the backfill: seven months landed, August 400'd.
   */
  it("returns only COMPLETED months, newest first — never the one in progress", () => {
    expect(monthsToSync(new Date("2026-08-26T12:00:00Z"))).toEqual([
      { year: 2026, month: "July" },
      { year: 2026, month: "June" },
      { year: 2026, month: "May" },
    ]);
  });

  it("still excludes the current month on its very last day", () => {
    // 23:00 on the 31st is still inside August, and Samsara still refuses it.
    expect(monthsToSync(new Date("2026-08-31T23:00:00Z"))[0]).toEqual({ year: 2026, month: "July" });
  });

  it("reaches back three completed months, because a carrier files a quarter", () => {
    expect(monthsToSync(new Date("2026-08-26T12:00:00Z"))).toHaveLength(3);
  });

  it("crosses a year boundary without inventing month zero", () => {
    expect(monthsToSync(new Date("2026-01-15T12:00:00Z"))).toEqual([
      { year: 2025, month: "December" },
      { year: 2025, month: "November" },
      { year: 2025, month: "October" },
    ]);
  });
});
