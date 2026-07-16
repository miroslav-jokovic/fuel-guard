import { describe, it, expect } from "vitest";
import { parseKwikTripStoreList, composeKwikTripStations } from "./kwikTripStoreList.js";
import { KWIK_TRIP_TRUCK_FRIENDLY_STORES } from "./kwikTripTruckFriendly.js";

// Verbatim rows from the real 2026-07 store-list page (TablePress markup, 936 rows).
const HEADER_TR = `<tr class="row-1">\n\t<th class="column-1">Store Number</th><th class="column-2">Store Name</th><th class="column-3">Address</th><th class="column-4">City</th><th class="column-5">State</th><th class="column-6">Zip</th><th class="column-7">Phone</th><th class="column-8">Latitude</th><th class="column-9">Longitude</th><th class="column-10">Car Wash</th><th class="column-11">Sells Gas</th><th class="column-12">Sells Diesel</th><th class="column-13">Sells CNG</th><th class="column-14">Sells LNG</th><th class="column-15">Sells DEF</th><th class="column-16">Sells E85</th>\n</tr>`;
const TF_DIESEL_TR = `<tr class="row-413">\n\t<td class="column-1">885</td><td class="column-2">KWIK TRIP #885</td><td class="column-3">301 ELDERBERRY RD</td><td class="column-4">ABBOTSFORD</td><td class="column-5">WI</td><td class="column-6">54405</td><td class="column-7">(715) 223-0704</td><td class="column-8">44.92801</td><td class="column-9">-90.31212</td><td class="column-10">No</td><td class="column-11">Yes</td><td class="column-12">Yes</td><td class="column-13">No</td><td class="column-14">No</td><td class="column-15">Yes</td><td class="column-16">Yes</td>\n</tr>`;
const NO_DIESEL_TR = `<tr class="row-4">\n\t<td class="column-1">530</td><td class="column-2">KWIK SPIRITS #530</td><td class="column-3">204 S DUFF AVE</td><td class="column-4">AMES</td><td class="column-5">IA</td><td class="column-6">50010</td><td class="column-7">(515) 232-4389</td><td class="column-8">42.02167</td><td class="column-9">-93.61027</td><td class="column-10">No</td><td class="column-11">No</td><td class="column-12">No</td><td class="column-13">No</td><td class="column-14">No</td><td class="column-15">No</td><td class="column-16">No</td>\n</tr>`;
// Store 100 sells diesel in this fixture but is NOT on the official truck-friendly list (verified).
const DIESEL_NOT_TF_TR = TF_DIESEL_TR.replace(">885<", ">100<").replace("KWIK TRIP #885", "KWIK STAR #100");
const BAD_COORD_TR = TF_DIESEL_TR.replace(">885<", ">999999<").replace(">44.92801<", ">0<").replace(">-90.31212<", ">0<");
const PAGE = `<html><body><table id="tablepress-4">${HEADER_TR}<tbody>${TF_DIESEL_TR}${NO_DIESEL_TR}${DIESEL_NOT_TF_TR}${BAD_COORD_TR}</tbody></table></body></html>`;

describe("parseKwikTripStoreList", () => {
  const r = parseKwikTripStoreList(PAGE);

  it("parses store rows with exact coordinates and diesel/DEF flags", () => {
    expect(r.headerFound).toBe(true);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      storeNumber: "885", name: "KWIK TRIP #885", city: "ABBOTSFORD", state: "WI",
      lat: 44.92801, lng: -90.31212, sellsDiesel: true, sellsDef: true,
    });
    expect(r.rows[1]).toMatchObject({ storeNumber: "530", sellsDiesel: false });
  });

  it("skips defective rows (out-of-range coords) and counts them", () => {
    expect(r.skipped).toBe(1);
  });

  it("returns headerFound=false when the table is absent (markup change → loud failure)", () => {
    expect(parseKwikTripStoreList("<html><table><tr><td>x</td></tr></table></html>").headerFound).toBe(false);
  });
});

describe("composeKwikTripStations (truck-safety filter)", () => {
  it("admits ONLY official truck-friendly stores that sell diesel", () => {
    const r = parseKwikTripStoreList(PAGE);
    const c = composeKwikTripStations(r.rows);
    // 885 is on the real Truck-Friendly list and sells diesel; 530 (no diesel, not TF) and a
    // diesel-selling store NOT on the list must both be excluded.
    expect(KWIK_TRIP_TRUCK_FRIENDLY_STORES.has("885")).toBe(true);
    expect(c.stations.map((s) => s.storeNumber)).toEqual(["885"]);
  });

  it("reports truck-friendly stores missing from the table instead of inventing them", () => {
    const c = composeKwikTripStations([]);
    expect(c.stations).toEqual([]);
    expect(c.truckFriendlyNotInTable).toBe(KWIK_TRIP_TRUCK_FRIENDLY_STORES.size);
  });

  it("ships a plausibly-sized official list with provenance", () => {
    expect(KWIK_TRIP_TRUCK_FRIENDLY_STORES.size).toBeGreaterThan(300);
    expect(KWIK_TRIP_TRUCK_FRIENDLY_STORES.size).toBeLessThan(600);
  });
});
