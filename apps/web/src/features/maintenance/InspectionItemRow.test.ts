import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { INSPECTION_RESULTS, inspectionItem } from "@silvicom/shared";
import InspectionItemRow from "@/features/maintenance/InspectionItemRow.vue";

/**
 * One of the 56 component rows (plan step A7).
 *
 * The row's job is not "render a label" — it is to make two things impossible: certifying a part the
 * equipment cannot have, and losing track of which answers the inspector actually gave.
 */

const mountRow = (over: Record<string, unknown> = {}) =>
  mount(InspectionItemRow, {
    props: {
      item: inspectionItem("brake.hose")!,
      result: "ok",
      source: "default",
      repairedAt: null,
      ...over,
    },
  });

describe("the three-state control", () => {
  it("offers exactly the three results the form's own instruction line defines", () => {
    const buttons = mountRow().findAll("button");
    expect(buttons).toHaveLength(INSPECTION_RESULTS.length);
    expect(buttons.map((b) => b.text())).toEqual(["OK", "Repair", "N/A"]);
  });

  it("marks the current answer with aria-pressed, so a screen reader hears the state", () => {
    // Scoped to the group: a row marked "Repair" also shows a repair-date field, and that field's
    // calendar button is a button in this row that is not one of the three answers.
    const buttons = mountRow({ result: "needs_repair" }).findAll('[role="group"] button');
    expect(buttons.map((b) => b.attributes("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("names the component on the group, so the buttons are not three bare OKs in a list of 56", () => {
    const group = mountRow().find('[role="group"]');
    expect(group.attributes("aria-label")).toBe(inspectionItem("brake.hose")!.label);
  });

  it("emits the result the inspector chose", async () => {
    const w = mountRow();
    await w.findAll("button")[1]!.trigger("click");
    expect(w.emitted("set")).toEqual([["needs_repair"]]);
  });
});

describe("every row is answerable — the form is the same for both (owner ruling, 2026-08-31)", () => {
  it("leaves a part the equipment does not normally carry fully markable", () => {
    // This used to disable everything but N/A. Truck and trailer share one form and one decal, and
    // the difference is the unit number and which boxes are marked — so refusing a mark the paper
    // permits would be a rule the office does not have. A converter dolly carries a fifth wheel.
    const w = mountRow({ item: inspectionItem("rear_impact_guard.present")!, result: "na" });
    expect(w.findAll('[role="group"] button').map((b) => b.attributes("disabled") !== undefined)).toEqual([false, false, false]);
  });

  it("leaves a fleet default markable too — that na is about this fleet, not the rules", () => {
    const w = mountRow({ item: inspectionItem("brake.hydraulic")!, result: "na" });
    expect(w.findAll('[role="group"] button').map((b) => b.attributes("disabled") !== undefined)).toEqual([false, false, false]);
  });

  it("still disables everything once the inspection is completed (D-AVI4)", () => {
    const w = mountRow({ disabled: true });
    expect(w.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  });
});

describe("what the row tells the inspector about itself", () => {
  it("shows the component's name and NOT its CFR reference (D-AVI15)", () => {
    // The citation still travels on the catalogue for the renderer and any audit export; it is not
    // something the person doing the inspection is reading.
    const w = mountRow();
    expect(w.text()).toContain(inspectionItem("brake.hose")!.label);
    expect(w.text()).not.toContain("App. A");
    expect(w.text()).not.toContain("§");
  });

  it("says when an answer is still the one the form opened with (D-AVI13)", () => {
    expect(mountRow({ source: "default" }).text()).toContain("default");
    expect(mountRow({ source: "inspector" }).text()).not.toContain("default");
  });

  it("offers a repair date only for a defect, because a date anywhere else is a data-entry error", () => {
    // Asked of the COMPONENT, not of `input[type="date"]`: the date field is a real picker now
    // (D-DS17) and its input is a text one, so a selector on the native type would report "no date
    // field here" for every row that has one.
    const has = (result: "ok" | "needs_repair") =>
      mountRow({ result }).findComponent({ name: "AppDateField" }).exists();
    expect(has("ok")).toBe(false);
    expect(has("needs_repair")).toBe(true);
  });

  it("clears the repair date to null rather than an empty string", () => {
    // `''::date` is a Postgres error — the same trap `isoDateSchema` was written for.
    const w = mountRow({ result: "needs_repair", repairedAt: "2026-06-17" });
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "");
    expect(w.emitted("set-repaired")).toEqual([[null]]);
  });

  it("disables every control once the report is certified (D-AVI4)", () => {
    const w = mountRow({ disabled: true });
    expect(w.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  });
});
