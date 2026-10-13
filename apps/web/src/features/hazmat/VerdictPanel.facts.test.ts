import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VerdictPanel from "./VerdictPanel.vue";

/** D-US6 — what the §172.504(c) aggregate ran on is a FactList; a figure the paper omits is a dash. */
const result = {
  engineVersion: "0.13.0", datasetVersion: "2026.1", datasetProvisional: false,
  verdict: {
    eligibility: { status: "eligible", blocks: [] }, segregation: [], trace: [], notices: [],
    placards: {
      required: [], permitted: [], optionalSubstitutions: [], prohibited: [], marks: [], ergGuides: [], idDisplays: [],
      loadProfile: null,
      aggregate: {
        countedGrossWeightLb: null, countedPackages: 1200, countedLines: 2, thresholdMet: null,
        thresholds: { dangerousCategoryLb: 2205, nonBulkIdDisplayLb: 8820 }, alwaysPlacardLines: 0, residueExcludedLines: 0,
      },
    },
  },
} as never;

describe("the verdict's aggregate facts", () => {
  it("names each figure, formats the counts, and dashes an unstated weight", () => {
    const w = mount(VerdictPanel, { props: { result }, global: { stubs: { PlacardDiamond: true, VerdictDetails: true, FindingRow: true, CitationText: true } } });
    const dl = w.get("dl");
    expect(dl.findAll("dt").map((d) => d.text())).toEqual(["Counted gross weight", "Packages counted", "Lines in the aggregate"]);
    expect(dl.findAll("dd").map((d) => d.text())).toEqual(["—", "1,200", "2"]);
  });
});
