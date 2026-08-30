import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppCombobox from "./AppCombobox.vue";

/**
 * `AppCombobox` (D-H20/D-H21).
 *
 * ⚠ What is pinned here is the OVERLAY CONTRACT, because that is what the hazmat audit broke on.
 * The list used to be `absolute` inside this component's own wrapper at `z-sticky-lead` (20), which
 * meant an ancestor with `overflow: hidden` clipped it and the app top bar (`z-chrome`, 40) painted
 * over it. Both are invisible in a unit test unless the ESCAPE ROUTE is asserted directly: the list
 * has to leave this subtree for `<body>` and it has to carry the popover layer.
 *
 * The server-search props are pinned alongside because `ProductPicker` exists only for them — if a
 * remote result set ever gets filtered a second time locally, the HMT search silently loses rows.
 */
const OPTIONS = [
  { value: "drum", label: "Drums" },
  { value: "ibc_tote", label: "IBC / tote" },
  { value: "cylinder", label: "Cylinders" },
];

const mountCombo = (props: Record<string, unknown> = {}) =>
  mount(AppCombobox, { props: { modelValue: "", options: OPTIONS, ...props }, attachTo: document.body });

describe("AppCombobox overlay contract", () => {
  it("teleports the list out of its own subtree, so no ancestor can clip it", async () => {
    const w = mountCombo();
    await w.find("input").trigger("focusin");

    expect(w.element.querySelector('[role="listbox"]')).toBeNull();
    const list = document.body.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    expect(list!.parentElement).toBe(document.body);
    w.unmount();
  });

  it("puts the list on the popover layer, not the sticky-table layer", async () => {
    const w = mountCombo();
    await w.find("input").trigger("focusin");
    const list = document.body.querySelector('[role="listbox"]')!;
    expect(list.className).toContain("z-popover");
    expect(list.className).not.toContain("z-sticky");
    w.unmount();
  });

  it("removes the list from the document when it closes", async () => {
    const w = mountCombo();
    await w.find("input").trigger("focusin");
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    await w.find("input").trigger("keydown", { key: "Escape" });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    w.unmount();
  });

  it("keeps every option a real option, selectable by keyboard", async () => {
    const w = mountCombo();
    const input = w.find("input");
    await input.trigger("focusin");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["ibc_tote"]);
    w.unmount();
  });
});

describe("AppCombobox server search (D-H20)", () => {
  it("does not filter options a second time when the server already did", async () => {
    const w = mountCombo({ serverFiltered: true });
    const input = w.find("input");
    await input.trigger("focusin");
    await input.setValue("zzz-no-local-match");
    // A remote result set rarely contains the typed substring in its label; a local pass would
    // throw away every row the server just found.
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(3);
    w.unmount();
  });

  it("emits what was typed, which is the only way a server caller learns the query", async () => {
    const w = mountCombo({ serverFiltered: true });
    await w.find("input").setValue("UN1203");
    expect(w.emitted("update:query")?.at(-1)).toEqual(["UN1203"]);
    w.unmount();
  });

  it("says it is searching instead of showing an empty list", async () => {
    const w = mountCombo({ serverFiltered: true, options: [], loading: true });
    await w.find("input").trigger("focusin");
    expect(document.body.querySelector('[role="listbox"]')!.textContent).toContain("Searching…");
    w.unmount();
  });

  it("lets the caller say what an empty result means", async () => {
    const w = mountCombo({ serverFiltered: true, options: [], emptyText: "No matching product." });
    await w.find("input").trigger("focusin");
    expect(document.body.querySelector('[role="listbox"]')!.textContent).toContain("No matching product.");
    w.unmount();
  });
});
