import { describe, it, expect } from "vitest";
import { parsePilotPublicPricesXlsx, parsePilotPricesPageHtml, stateNameToCode } from "./pilotPublicPrices.js";
import type { Cell } from "./pilotPriceReport.js";

// Verbatim rows from the real 2026-07 "Download Fuel Prices" .xlsx (875 rows).
const HEADER: Cell[] = ["Pilot Travel Center","City","State/Province","Diesel","Pump DEF","Bio Blend","Unleaded","Midgrade","Super","Propane"];
const grid: Cell[][] = [
  HEADER,
  ["907","Miles City","Montana",4.599,3.049,"B0",3.759,3.959,4.159,"N/A"],
  ["1341","Arlington","Washington",5.399,3.899,"N/A","N/A","N/A","N/A","N/A"],
  ["803","Portage La Prairie","Manitoba",1.999,"N/A","N/A",1.489,"N/A",1.769,"N/A"], // CAD per LITER
  ["abc","Bad","Texas","N/A","N/A","N/A","N/A","N/A","N/A","N/A"], // defect: non-numeric store, no price
  [null],
];

describe("parsePilotPublicPricesXlsx", () => {
  const r = parsePilotPublicPricesXlsx(grid);

  it("fans a station row out into diesel + def price rows with the bio-blend label on diesel only", () => {
    expect(r.headerFound).toBe(true);
    expect(r.stationRows).toBe(3);
    const s907 = r.rows.filter((x) => x.storeNumber === "907");
    expect(s907).toHaveLength(2);
    expect(s907[0]).toMatchObject({ product: "diesel", price: 4.599, bioBlend: "B0", state: "MT", country: "US", currency: "USD", unit: "gal" });
    expect(s907[1]).toMatchObject({ product: "def", price: 3.049, bioBlend: null });
  });

  it("treats N/A as no price (station with diesel only yields one row)", () => {
    expect(r.rows.filter((x) => x.storeNumber === "1341")).toHaveLength(2); // diesel + def both present here
    expect(r.rows.filter((x) => x.storeNumber === "803")).toHaveLength(1); // def is N/A
  });

  it("marks Canadian provinces as CAD per liter — never comparable to USD/gal rows", () => {
    const ca = r.rows.find((x) => x.storeNumber === "803")!;
    expect(ca).toMatchObject({ state: "MB", country: "CA", currency: "CAD", unit: "L", price: 1.999 });
  });

  it("skips defective rows and counts them", () => {
    expect(r.skipped).toBe(1);
  });

  it("returns headerFound=false on unrecognized input", () => {
    expect(parsePilotPublicPricesXlsx([["nope"]]).headerFound).toBe(false);
  });
});

describe("stateNameToCode", () => {
  it("maps full names, passes through codes, rejects unknowns", () => {
    expect(stateNameToCode("British Columbia")).toBe("BC");
    expect(stateNameToCode("montana")).toBe("MT");
    expect(stateNameToCode("tx")).toBe("TX");
    expect(stateNameToCode("Atlantis")).toBeNull();
  });
});

// Verbatim <tr> from the real fuel-prices page (Svelte SSR markup, 2026-07): store link, exit + city
// address divs, $-prefixed prices, "--"/"Not available" for missing, bio label column.
const REAL_TR = `<tr class="svelte-t6mqyp"><!--[--><td class="store-col svelte-t6mqyp"><!--[0--><!--[--><div class="store-cell-container"><span class="store-cell svelte-bdwvze"><a href="https://locations.pilotflyingj.com/907" title="Pilot Travel Center #907" class="svelte-bdwvze">Pilot Travel Center #907</a> <!--[-1--><!--]--></span></div> <div class="address svelte-bdwvze">I-94, Exit 138</div> <div class="address svelte-bdwvze">Miles City, MT</div> <!--[-1--><!--]--><!--]--><!--]--></td><td class="group-a start svelte-t6mqyp"><!--[1--><!---->$4.599<!----><!--]--></td><td class="group-a svelte-t6mqyp"><!--[1--><!---->$3.049<!----><!--]--></td><td class="group-a group-end svelte-t6mqyp"><!--[1--><!---->B0<!----><!--]--></td><td class="group-b start svelte-t6mqyp"><!--[1--><!---->$3.759<!----><!--]--></td><td class="group-b svelte-t6mqyp"><!--[1--><!---->$3.959<!----><!--]--></td><td class="group-b group-end svelte-t6mqyp"><!--[1--><!---->$4.159<!----><!--]--></td><td class="group-last svelte-t6mqyp"><!--[1--><!----><span><span aria-hidden="true">--</span><span class="sr-only">Not available</span> </span><!----><!--]--></td><!--]--></tr>`;
const NA_DEF_TR = REAL_TR.replace('locations.pilotflyingj.com/907"', 'locations.pilotflyingj.com/801"')
  .replace('<div class="address svelte-bdwvze">Miles City, MT</div>', '<div class="address svelte-bdwvze">Prince George, BC</div>')
  .replace('<!--[1--><!---->$3.049<!----><!--]-->', '<!--[1--><!----><span><span aria-hidden="true">--</span><span class="sr-only">Not available</span> </span><!----><!--]-->')
  .replace('<!--[1--><!---->$4.599<!----><!--]-->', '<!--[1--><!---->$1.859<!----><!--]-->');
const PAGE = `<html><body><table id="data-table" class="svelte-t6mqyp"><thead><tr><th>Store</th><th>Diesel</th></tr></thead><tbody>${REAL_TR}${NA_DEF_TR}</tbody></table></body></html>`;

describe("parsePilotPricesPageHtml", () => {
  const r = parsePilotPricesPageHtml(PAGE);

  it("extracts store number from the locations link, city/state, and $-prices in column order", () => {
    expect(r.headerFound).toBe(true);
    expect(r.stationRows).toBe(2);
    const s907 = r.rows.filter((x) => x.storeNumber === "907");
    expect(s907[0]).toMatchObject({ product: "diesel", price: 4.599, bioBlend: "B0", city: "Miles City", state: "MT", currency: "USD", unit: "gal" });
    expect(s907[1]).toMatchObject({ product: "def", price: 3.049 });
  });

  it("treats -- / Not available as no price, and Canadian provinces as CAD/L", () => {
    const s801 = r.rows.filter((x) => x.storeNumber === "801");
    expect(s801).toHaveLength(1); // DEF was "--"
    expect(s801[0]).toMatchObject({ product: "diesel", price: 1.859, state: "BC", country: "CA", currency: "CAD", unit: "L" });
  });

  it("never mistakes the exit address div for the city (Exit 138 is not a state code)", () => {
    expect(r.rows[0]!.city).toBe("Miles City");
  });

  it("returns headerFound=false when the data table is absent (markup change → loud ingest failure)", () => {
    expect(parsePilotPricesPageHtml("<html><table id='other'></table></html>").headerFound).toBe(false);
  });
});
