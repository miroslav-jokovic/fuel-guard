import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { INSPECTION_RESULTS, inspectionItem, type InspectionSubjectType } from "@silvicom/shared";
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
      subjectType: "tractor" as InspectionSubjectType,
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
    const buttons = mountRow({ result: "needs_repair" }).findAll("button");
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

describe("an inapplicable component is locked, not merely defaulted", () => {
  it("disables everything but N/A on a part the equipment cannot have", () => {
    // A tractor has no rear impact guard. Certifying that an absent part is in place is a statement
    // nobody has standing to make — so the control refuses it rather than defaulting away from it.
    const w = mountRow({ item: inspectionItem("rear_impact_guard.present")!, result: "na" });
    const disabled = w.findAll("button").map((b) => b.attributes("disabled") !== undefined);
    expect(disabled).toEqual([true, true, false]);
  });

  it("leaves a FLEET default fully editable — that na is a fact about this fleet, not the rules", () => {
    // Silvicom's tractors run air brakes, so hydraulic brakes open as `na`. A different unit could
    // answer otherwise, and the form must let it.
    const w = mountRow({ item: inspectionItem("brake.hydraulic")!, result: "na" });
    expect(w.findAll("button").map((b) => b.attributes("disabled") !== undefined)).toEqual([false, false, false]);
  });

  it("unlocks the guard on a trailer, where the part exists", () => {
    const w = mountRow({ item: inspectionItem("rear_impact_guard.present")!, subjectType: "trailer", result: "ok" });
    expect(w.findAll("button").map((b) => b.attributes("disabled") !== undefined)).toEqual([false, false, false]);
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

  it("does not label a locked row as a default — there was never a choice to make", () => {
    const w = mountRow({ item: inspectionItem("rear_impact_guard.present")!, result: "na", source: "default" });
    expect(w.text()).not.toContain("default");
  });

  it("offers a repair date only for a defect, because a date anywhere else is a data-entry error", () => {
    expect(mountRow({ result: "ok" }).find('input[type="date"]').exists()).toBe(false);
    expect(mountRow({ result: "needs_repair" }).find('input[type="date"]').exists()).toBe(true);
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
