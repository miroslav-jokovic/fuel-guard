import { describe, it, expect } from "vitest";
import { FMCSA_DATASETS, FMCSA_DATASET_SPECS, fmcsaNaturalKeys } from "./fmcsaDatasets.js";

describe("the FMCSA dataset catalogue (INSPECTION-CHALLENGE-PLAN IC1)", () => {
  it("specs every dataset in the list under its own id", () => {
    expect(Object.keys(FMCSA_DATASET_SPECS).sort()).toEqual([...FMCSA_DATASETS].sort());
    for (const id of FMCSA_DATASETS) expect(FMCSA_DATASET_SPECS[id].id).toBe(id);
  });

  it("quotes inspection_id exactly where Socrata types it text (units and citations)", () => {
    const quoted = FMCSA_DATASETS.filter((d) => FMCSA_DATASET_SPECS[d].scope.by === "inspection_id" && FMCSA_DATASET_SPECS[d].scope.quoted);
    expect(quoted.sort()).toEqual(["qbt8-7vic", "wt8s-2hbx"]);
    expect(FMCSA_DATASET_SPECS["876r-jsdb"].scope).toEqual({ by: "inspection_id", quoted: false });
  });
});

describe("fmcsaNaturalKeys", () => {
  it("joins the key fields with | and trims them", () => {
    expect(fmcsaNaturalKeys("qbt8-7vic", [{ inspection_id: " 80228817", vioseqnum: "1", adjseq: "1 " }])).toEqual(["80228817|1|1"]);
  });

  it("numbers a repeated SMS violation triple #2, #3 in payload order", () => {
    const row = { unique_id: "742915269", viol_code: "393.75A3-TAOL", viol_unit: "1" };
    expect(fmcsaNaturalKeys("8mt8-2mdr", [row, { ...row, viol_unit: "2" }, row, row])).toEqual([
      "742915269|393.75A3-TAOL|1",
      "742915269|393.75A3-TAOL|2",
      "742915269|393.75A3-TAOL|1#2",
      "742915269|393.75A3-TAOL|1#3",
    ]);
  });

  it("refuses a row missing a key field rather than inventing a key", () => {
    expect(() => fmcsaNaturalKeys("fx4q-ay7w", [{ inspection_id: "1" }, { inspection_id: "" }])).toThrow(/row 1 has no inspection_id/);
    expect(() => fmcsaNaturalKeys("876r-jsdb", [{ inspection_id: "1" }])).toThrow(/insp_violation_id/);
  });
});
