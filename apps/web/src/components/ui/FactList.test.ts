import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FactList from "./FactList.vue";

/** D-US6 — one shape for label/value facts, with the table's answer for a blank. */
describe("FactList", () => {
  it("pairs each label with its value, in order, as a description list", () => {
    const w = mount(FactList, { props: { facts: [{ label: "Tank", value: "150 gal" }, { label: "Odometer", value: 412_000, numeric: true }] } });
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Tank", "Odometer"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["150 gal", "412000"]);
    expect(w.findAll("dd")[1]!.classes()).toContain("tabular-nums");
  });

  it("shows an em dash for a blank, never an empty cell or a stray unit", () => {
    const w = mount(FactList, { props: { facts: [{ label: "Tank", value: null }, { label: "MPG", value: "" }, { label: "Zero", value: 0 }] } });
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["—", "—", "0"]);
  });

  it("lets a fact fill its own value through value-<key>, inside the same dd", () => {
    const w = mount(FactList, {
      props: { facts: [{ key: "status", label: "Status", value: "active" }] },
      slots: { "value-status": "<span class='badge'>Active</span>" },
    });
    expect(w.get("dd .badge").text()).toBe("Active");
  });

  it("lays out as rows, label left and value right, for a summary in a card or drawer", () => {
    const w = mount(FactList, { props: { layout: "rows", facts: [{ label: "Miles", value: "1,200" }] } });
    expect(w.get("dl > div").classes()).toEqual(expect.arrayContaining(["flex", "justify-between"]));
  });

  it("uses the column count it is given from sm up, and two on a phone", () => {
    const w = mount(FactList, { props: { columns: 3, facts: [] } });
    expect(w.get("dl").classes()).toEqual(expect.arrayContaining(["grid-cols-2", "sm:grid-cols-3"]));
  });
});
