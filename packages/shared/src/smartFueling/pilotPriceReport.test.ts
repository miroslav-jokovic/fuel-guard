import { describe, it, expect } from "vitest";
import { parsePilotPriceReport, type Cell } from "./pilotPriceReport.js";

// Mirrors the real "Better Of Pricing Report" layout (blank rows, title, account/effective-date, header, data).
const HEADER: Cell[] = ["Site","City","ST","Prod","Rack ID","Rack City","Rack ST","Cost","Federal Tax/Fees","State Tax/ Fees","Sales Tax/ Fees","Lust/Insp Super Fund/Fees","Freight","Pump Fee",null,"Other","Total Cost","Retail Price","Disc Retail","Your Price","Savings Total"];
const grid: Cell[][] = [
  [], [], [],
  ["RETAIL PRICES ARE SUBJECT TO CHANGE AT ANY TIME", "US Restricted-Pilot Travel Centers LLC", "Retail Price @ 2026-07-14 04:33 PM"],
  ["Account: 262568 - Silvicom Inc", "Price Source: OPIS Contract Avg.", "Better Of Pricing Report", "Effective Date: 7/15/2026 To 07/15/2026"],
  HEADER,
  ["602","Birmingham","AL","DSL",615,"Birmingham","AL",3.8727,0.244,0.31,0.0117,0.01,0.0575,-0.04,null,0.0218,4.4877,5.099,5.049,4.4877,0.6113],
  ["075","Satsuma","AL","DSL",715,"Mobile","AL",3.9986,0.244,0.31,0,0.01,0.065,-0.04,null,0.0818,4.6694,5.299,5.249,4.6694,0.6296],
  ["764","Rock Springs","WY","DSL",835,"Salt Lake City","UT",3.803,0.244,0.23,0,0.01,0.1275,-0.04,null,0.0043,4.3788,5.099,5.049,4.3788,0.7202],
  ["999","Nowhere","XX","",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null], // no product -> skipped
  [null], // footer padding -> not counted
];

describe("parsePilotPriceReport", () => {
  it("reads metadata, header, and diesel rows with net='Your Price' / posted='Retail Price'", () => {
    const r = parsePilotPriceReport(grid);
    expect(r.headerFound).toBe(true);
    expect(r.account).toBe("262568");
    expect(r.effectiveDate).toBe("2026-07-15");
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ site: "602", city: "Birmingham", state: "AL", product: "diesel", postedPrice: 5.099, netPrice: 4.4877 });
    expect(r.rows[1]!.site).toBe("075"); // leading zero preserved
    expect(r.rows[2]!).toMatchObject({ site: "764", state: "WY", netPrice: 4.3788 });
    expect(r.skipped).toBe(1); // the XX/no-product near-miss row
  });

  it("parses $-formatted string cells", () => {
    const g: Cell[][] = [HEADER, ["10","Reno","NV","DSL",1,"x","NV","$3.50",null,null,null,null,null,null,null,null,"$4.10","$5.30","$5.25","$4.10","$1.20"]];
    const r = parsePilotPriceReport(g);
    expect(r.rows[0]!).toMatchObject({ netPrice: 4.1, postedPrice: 5.3 });
  });

  it("returns headerFound=false when the grid has no recognizable header", () => {
    const r = parsePilotPriceReport([["random"], ["stuff"]]);
    expect(r.headerFound).toBe(false);
    expect(r.rows).toEqual([]);
  });
});
