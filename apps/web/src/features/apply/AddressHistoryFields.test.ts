import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { emptyAddress, emptyDraft, type ApplicationDraft, type DraftAddress } from "./draft";
import AddressHistoryFields from "./AddressHistoryFields.vue";
import AddressDrawer from "./AddressDrawer.vue";
import { provideApplyIssues } from "./issues";
import { fieldId } from "./fieldLabels";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * §391.21(b)(3) on the screen (C3c1): the months the list does not cover, from `addressCoverage` — the
 * arithmetic a v2 filing refuses on — over the addresses as they would be FILED. 09/26/2026 opens the
 * window in 09/2023.
 */
const AS_OF = "2026-09-26";
const copy = APPLY_COPY.addresses;
const at = (from: string, to: string, over: Partial<DraftAddress> = {}): DraftAddress =>
  ({ ...emptyAddress(), line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from, to, ...over });
const screen = (addresses: DraftAddress[]) =>
  mount(AddressHistoryFields, { props: { modelValue: { ...emptyDraft(), addresses } as ApplicationDraft, asOf: AS_OF } });

describe("the three years of addresses (C3c1)", () => {
  it("names the months with no address", () => {
    const w = screen([at("2025-02", "")]);
    expect(w.text()).toContain(copy.gap("09/2023", "01/2025"));
    expect(w.text()).not.toContain(copy.coverageComplete);
  });

  it("says when every month is covered", () => {
    const w = screen([at("2020-01", "2024-05"), at("2024-06", "")]);
    expect(w.text()).toContain(copy.coverageComplete);
  });

  it("does not count a row with no street and no city, which is never filed", () => {
    const w = screen([at("2020-01", "", { line1: "", city: "" })]);
    expect(w.text()).toContain(copy.gap("09/2023", "09/2026"));
  });
});

/** Renders both slots inline, footer included — the panel's Save button lives in `#footer`. */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

/** The v2 screen under a page whose issues are `issues`, as `ApplyPage` provides them. */
const v2Screen = (addresses: DraftAddress[], issues: SectionIssue[] = []) => {
  const draft = ref<ApplicationDraft>({ ...emptyDraft(), addresses });
  const w = mount(
    defineComponent({
      setup() {
        provideApplyIssues(ref(issues));
        return () => h(AddressHistoryFields, {
          modelValue: draft.value, asOf: AS_OF, v2AsOf: AS_OF,
          "onUpdate:modelValue": (v: ApplicationDraft) => { draft.value = v; },
        });
      },
    }),
    { global: { stubs: { SlideOver: SlideOverStub } }, attachTo: document.body },
  );
  return { w, draft };
};
const button = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text().trim() === label);

/**
 * One address per screen on a v2 link (C3c2c1, §6.4 item 2): a list of the addresses and a panel per
 * address, the job loop's shape. A legacy link keeps its inline cards.
 */
describe("one address per screen (C3c2c1)", () => {
  it("offers where they live now first, in a panel, reusing the empty draft's blank row", async () => {
    const { w, draft } = v2Screen([emptyAddress()]);
    expect(w.findAll("li")).toHaveLength(0);
    await button(w, copy.addFirst)!.trigger("click");
    expect(w.find("#apply-addresses-0-line1").exists()).toBe(true);
    expect(draft.value.addresses).toHaveLength(1);
    w.unmount();
  });

  it("commits the address on Save and lists it by street and months", async () => {
    const { w, draft } = v2Screen([emptyAddress()]);
    await button(w, copy.addFirst)!.trigger("click");
    const panel = w.findComponent(AddressDrawer);
    panel.vm.$emit("save", at("2025-02", ""));
    await w.vm.$nextTick();
    expect(draft.value.addresses).toEqual([at("2025-02", "")]);
    expect(w.find("li").text()).toContain("1 Road, Joliet, IL");
    expect(w.find("li").text()).toContain(`02/2025 — ${copy.toNow}`);
    expect(w.find("#apply-addresses-0-line1").exists()).toBe(false);
    w.unmount();
  });

  it("adds a second address as a new row once the first is filled", async () => {
    const { w, draft } = v2Screen([at("2025-02", "")]);
    await button(w, copy.add)!.trigger("click");
    expect(draft.value.addresses).toHaveLength(2);
    expect(w.find("#apply-addresses-1-line1").exists()).toBe(true);
    w.unmount();
  });

  it("removes an address from inside its panel, and never leaves the list without a row", async () => {
    const { w, draft } = v2Screen([at("2025-02", "")]);
    await button(w, copy.change)!.trigger("click");
    await button(w, copy.remove)!.trigger("click");
    expect(draft.value.addresses).toEqual([emptyAddress()]);
    expect(w.findAll("li")).toHaveLength(0);
    w.unmount();
  });

  it("says on an address's own row that something inside it is missing — and on no other row", () => {
    const issue: SectionIssue = {
      path: ["addresses", 1, "postal_code"], key: "addresses", message: "x", label: "x", say: "x",
      fieldId: fieldId(["addresses", 1, "postal_code"]), section: "addresses",
    };
    const { w } = v2Screen([at("2020-01", "2024-05"), at("2024-06", "")], [issue]);
    const rows = w.findAll("li");
    expect(rows[0]!.text()).not.toContain(copy.needsAnswers);
    expect(rows[1]!.text()).toContain(copy.needsAnswers);
    w.unmount();
  });

  it("keeps the meter beside the list, as the place a (b)(3) refusal lands", () => {
    const { w } = v2Screen([at("2025-02", "")]);
    expect(w.text()).toContain(copy.gap("09/2023", "01/2025"));
    expect(w.find("#apply-addresses").text()).toContain(copy.coverageHeading);
    w.unmount();
  });

  it("keeps a legacy link's inline cards", () => {
    const w = screen([at("2025-02", "")]);
    expect(w.text()).not.toContain(copy.listHeading);
    expect(w.find("#apply-addresses-0-line1").exists()).toBe(true);
  });
});

describe("the address panel", () => {
  const panel = (address: DraftAddress | null) =>
    mount(AddressDrawer, {
      props: { open: true, index: 2, address },
      global: { stubs: { SlideOver: SlideOverStub } },
      attachTo: document.body,
    });

  it("will not save an address the contract refuses, and says so beside the box", async () => {
    const w = panel(emptyAddress());
    await w.find("#apply-addresses-2-line1").setValue("1 Road");
    await button(w, copy.drawerSave)!.trigger("click");
    expect(w.emitted("save")).toBeUndefined();
    expect(w.find("#apply-addresses-2-city").attributes("aria-invalid")).toBe("true");
    expect(w.text()).toContain("This is needed.");
    expect(document.activeElement?.id).toBe("apply-addresses-2-city");
    w.unmount();
  });

  it("saves a whole address", async () => {
    const w = panel(at("2025-02", ""));
    await button(w, copy.drawerSave)!.trigger("click");
    expect(w.emitted("save")![0]![0]).toEqual(at("2025-02", ""));
    w.unmount();
  });

  it("changes nothing on Cancel", async () => {
    const original = at("2025-02", "");
    const w = panel(original);
    await w.find("#apply-addresses-2-line1").setValue("Typed by mistake");
    await button(w, copy.drawerCancel)!.trigger("click");
    expect(w.emitted("close")).toBeTruthy();
    expect(original.line1).toBe("1 Road");
    w.unmount();
  });

  it("offers no Remove for an address never saved", () => {
    const w = panel(emptyAddress());
    expect(button(w, copy.remove)).toBeUndefined();
    w.unmount();
  });
});
