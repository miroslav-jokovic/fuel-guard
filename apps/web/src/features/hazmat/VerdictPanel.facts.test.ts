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

/** The owner's 2026-10-19 Mayo BOL: UN1824 + UN1830, both Class 8 totes — engine 0.17.0's verdict. */
const twoCorrosives = (idDisplays: unknown[]) =>
  ({
    engineVersion: "0.17.0", datasetVersion: "2026.1", datasetProvisional: false,
    verdict: {
      eligibility: { status: "eligible", blocks: [] }, segregation: [], trace: [], notices: [],
      placards: {
        required: [{ placard: "CORROSIVE", positions: "each_side_and_each_end", because: [] }],
        permitted: [], optionalSubstitutions: [], prohibited: [], marks: [], ergGuides: [], idDisplays, loadProfile: null, aggregate: null,
      },
    },
  }) as never;
const id = (idNumber: string, format: string, onPlacards: string[]) =>
  ({ idNumber, format, alternateFormats: [], onPlacards, positions: "each_side_and_each_end", because: [] });
const stubs = { PlacardDiamond: { props: ["name", "idNumber"], template: "<i class='dia'>{{ name }}·{{ idNumber }}</i>" }, VerdictDetails: true, FindingRow: true, CitationText: true };

describe("the identification numbers on the answer card", () => {
  it("draws one CORROSIVE diamond per number — both 1824 and 1830, nothing in the panel list", () => {
    const w = mount(VerdictPanel, {
      props: { result: twoCorrosives([id("UN1824", "on_placard", ["CORROSIVE"]), id("UN1830", "on_placard", ["CORROSIVE"])]) },
      global: { stubs },
    });
    expect(w.findAll(".dia").map((d) => d.text())).toEqual(["CORROSIVE·UN1824", "CORROSIVE·UN1830"]);
    expect(w.text()).toContain("One of 2 CORROSIVE placards");
    expect(w.text()).not.toContain("separate panel —");
  });

  it("lists a number no diamond carries as its own panel", () => {
    const w = mount(VerdictPanel, { props: { result: twoCorrosives([id("UN1830", "orange_panel", [])]) }, global: { stubs } });
    expect(w.findAll(".dia").map((d) => d.text())).toEqual(["CORROSIVE·"]);
    expect(w.text()).toContain("1 identification number needs a separate panel — UN1830");
  });
});
