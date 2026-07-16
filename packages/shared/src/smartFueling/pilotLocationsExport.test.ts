import { describe, it, expect } from "vitest";
import { parsePilotLocationsExport } from "./pilotLocationsExport.js";
import type { Cell } from "./pilotPriceReport.js";

// Verbatim rows from the real 2026-07 "Download All Locations" export (877 rows).
const HEADER: Cell[] = ["Store #","Name","Address","City","State","Zip Code","Interstate","Latitude","Longitude","Phone Number","Parking Spaces Count","Fuel Lane Count","Shower Count","Amenities","Restaurants"];
const grid: Cell[][] = [
  HEADER,
  ["30","Pilot Travel Center","2640 N 600 W","Greenfield","IN","46140","I-70, Exit 96","39.82150283618834","-85.91623097168883","(463) 388-0606","90","9","9","Diesel Lanes | Showers | Prime Parking Spaces | DEF Lanes | Truck Parking Spaces","Pilot Eats"],
  ["869","Flying J Cardlock","2110 21st Ave","Nanton","AB","T0L 1R0","Provincial Route 2","50.35462938","-113.7761319","(403) 646-2810","0","2","0","Diesel Lanes","" ],
  ["466","ONE9 Dealer","1441 Hwy 41 South","Calhoun","GA","30701","I-75, Exit 315","34.44766971","-84.92375987","(706) 629-2262","60","4","4","Showers | ATM","Subway"],
  ["50","Mystery Fuel Depot","1 Elm","Springfield","MO","65801","I-44, Exit 80","37.2","-93.3","","10","2","1","Diesel Lanes | DEF Lanes",""],
  ["","Pilot Travel Center","No store number","Nowhere","TX","75001","","32.9","-96.9","","0","0","0","",""], // defect: no store #
  ["999","Pilot Travel Center","Bad coords","Nowhere","TX","75001","","0","0","","0","0","0","",""], // defect: 0,0 coords
  [null], // padding
];

describe("parsePilotLocationsExport", () => {
  const r = parsePilotLocationsExport(grid);

  it("parses valid rows with exact coordinates, brand mapping, and amenity-derived flags", () => {
    expect(r.headerFound).toBe(true);
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({
      storeNumber: "30", brand: "pilot", brandKnown: true, city: "Greenfield", state: "IN",
      country: "US", exit: "I-70, Exit 96", lat: 39.82150283618834, lng: -85.91623097168883,
      parkingSpaces: 90, fuelLaneCount: 9, showerCount: 9, hasDiesel: true, hasDef: true,
    });
    expect(r.rows[0]!.amenities).toContain("Prime Parking Spaces");
    expect(r.rows[0]!.restaurants).toEqual(["Pilot Eats"]);
  });

  it("maps Canadian provinces to country=CA and cardlock names to the flying_j brand", () => {
    expect(r.rows[1]).toMatchObject({ storeNumber: "869", brand: "flying_j", country: "CA", state: "AB" });
  });

  it("derives hasDiesel/hasDef strictly from amenities (a stop without Diesel Lanes is not plannable diesel)", () => {
    expect(r.rows[2]).toMatchObject({ brand: "one9", hasDiesel: false, hasDef: false });
  });

  it("flags unknown brands deterministically instead of guessing", () => {
    expect(r.rows[3]).toMatchObject({ brand: "mystery_fuel_depot", brandKnown: false });
    expect(r.unknownBrandNames).toEqual(["Mystery Fuel Depot"]);
  });

  it("skips defective rows (missing store #, out-of-range coords) and counts them", () => {
    expect(r.skipped).toBe(2);
  });

  it("returns headerFound=false on unrecognized input", () => {
    expect(parsePilotLocationsExport([["random"], ["stuff"]]).headerFound).toBe(false);
  });
});
