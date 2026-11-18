import { describe, expect, it } from "vitest";
import { evidencePackSchema } from "./campaignPlan.js";
import { marketEvidence, oewsSeriesFor, oewsSeriesId, stateFips, type MarketWageFact } from "./marketWages.js";

// The API's answers of 2026-11-18 (ADS-PLATFORM-V2-PLAN V2r): the nation's four measures, and Illinois's.
const NATION = { annual_median: 58640, hourly_median: 28.19, annual_p10: 40140, annual_p90: 79380 };
const ILLINOIS = { annual_median: 60320, hourly_median: 29.0, annual_p10: 39710, annual_p90: 86300 };
function facts(area: { kind: "nation" } | { kind: "state"; code: string }, values: Record<string, number | null>, year = 2025): MarketWageFact[] {
  const series = oewsSeriesFor(area)!;
  return Object.entries(series).map(([m, id]) => ({ series_id: id, year, value: values[m] ?? null }));
}

describe("oewsSeriesId", () => {
  it("names the series the API answered for the nation and for Illinois", () => {
    expect(oewsSeriesId({ kind: "nation" }, "annual_median")).toBe("OEUN000000000000053303213");
    expect(oewsSeriesId({ kind: "state", code: "IL" }, "annual_median")).toBe("OEUS170000000000053303213");
    expect(oewsSeriesId({ kind: "state", code: "TX" }, "hourly_median")).toBe("OEUS480000000000053303208");
    for (const id of Object.values(oewsSeriesFor({ kind: "state", code: "IL" })!)) expect(id).toHaveLength(25);
  });

  it("names no series for a place with no FIPS code", () => {
    expect(stateFips("ON")).toBeNull();
    expect(oewsSeriesId({ kind: "state", code: "ON" }, "annual_median")).toBeNull();
    expect(oewsSeriesFor({ kind: "state", code: "ZZ" })).toBeNull();
  });
});

describe("marketEvidence", () => {
  it("writes the state of the area's centre and the nation, each with its year and its BLS page", () => {
    const items = marketEvidence("IL", [...facts({ kind: "state", code: "IL" }, ILLINOIS), ...facts({ kind: "nation" }, NATION)]);
    expect(items.map((i) => i.id)).toEqual(["market:oews_il", "market:oews_us"]);
    expect(items[0]!.text).toBe("BLS wage survey, 2025: heavy and tractor-trailer truck drivers in Illinois, the state this ad's area is centred in, earned a median of $60,320 a year ($29.00 an hour); a tenth earned $39,710 or less and a tenth $86,300 or more.");
    expect(items[1]!.text).toContain("across the United States earned a median of $58,640 a year ($28.19 an hour)");
    expect(items[1]!.source).toBe("https://data.bls.gov/timeseries/OEUN000000000000053303213");
    expect(evidencePackSchema.safeParse(items).success).toBe(true);
  });

  it("writes no item for an area missing a measure, or whose measures are of two years", () => {
    const withheld = facts({ kind: "state", code: "IL" }, { ...ILLINOIS, annual_p90: null });
    expect(marketEvidence("IL", [...withheld, ...facts({ kind: "nation" }, NATION)]).map((i) => i.id)).toEqual(["market:oews_us"]);
    const mixed = facts({ kind: "nation" }, NATION).map((f, i) => (i === 0 ? { ...f, year: 2024 } : f));
    expect(marketEvidence(null, mixed)).toEqual([]);
    expect(marketEvidence(null, facts({ kind: "nation" }, NATION).slice(1))).toEqual([]);
  });

  it("writes the nation alone when the centre is not a US state", () => {
    expect(marketEvidence("ON", facts({ kind: "nation" }, NATION)).map((i) => i.id)).toEqual(["market:oews_us"]);
    expect(marketEvidence(null, facts({ kind: "nation" }, NATION)).map((i) => i.id)).toEqual(["market:oews_us"]);
  });
});
