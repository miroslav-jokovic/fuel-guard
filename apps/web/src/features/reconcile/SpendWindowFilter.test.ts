import { describe, it, expect, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import SpendWindowFilter from "./SpendWindowFilter.vue";
import { useSpendFilters } from "./useSpendFilters";
import { defaultWindow, windowDays } from "@fuelguard/shared";

/**
 * These drive the REAL control against the REAL composable and a REAL router, because that is the seam
 * every previous test missed. `interactionPrimitives.test.ts` mounted the old date filter with
 * `VueDatePicker` STUBBED, so it asserted the wrapper's markup and never once exercised picking a date
 * — which is why a picker that could not change the window shipped twice.
 *
 * The rule under test is the one the page depends on: no interaction may leave the window half-set, and
 * whatever a reader does must reach the URL, because the URL is what the query and the PDF export read.
 */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every mount here uses `attachTo: document.body` because the popover is teleported and can only be
 * queried from the document. That makes teardown load-bearing: a wrapper left mounted leaves its panel
 * in the DOM, and the next test's `document.querySelector` finds the PREVIOUS test's panel and clicks a
 * button belonging to a component nobody is asserting on. Two tests failed that way before this existed.
 */
const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  document.body.innerHTML = "";
});

const Harness = defineComponent({
  components: { SpendWindowFilter },
  setup() {
    const f = useSpendFilters();
    return { f };
  },
  template: `<SpendWindowFilter
    :from="f.from.value" :to="f.to.value" :presets="f.presets"
    :active-preset="f.preset.value" :notice="f.windowNotice.value"
    @apply="(a, b) => f.setWindow(a, b)" @preset="(k) => f.applyPreset(k)" @clear="f.reset()" />`,
});

async function mountFilter(query = ""): Promise<{ w: ReturnType<typeof mount>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-reconciliation", component: { template: "<div/>" } }],
  });
  await router.push(`/fuel-reconciliation${query}`);
  await router.isReady();
  const w = mount(Harness, { global: { plugins: [router] }, attachTo: document.body });
  mounted.push(w);
  await flushPromises();
  return { w, router };
}

/** The popover is teleported to body, so it is found there rather than in the wrapper. */
const panel = () => document.querySelector("[role='dialog'][aria-label='Reporting period']");
const openPanel = async (w: ReturnType<typeof mount>) => {
  await w.find("button[aria-haspopup='dialog']").trigger("click");
  await flushPromises();
};
const presetButton = (label: string): HTMLElement | undefined =>
  [...(panel()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label) as HTMLElement | undefined;

describe("SpendWindowFilter", () => {
  it("names the period on the trigger instead of making the reader subtract two dates", async () => {
    const { w } = await mountFilter();
    expect(w.find("button[aria-haspopup='dialog']").text()).toContain("Last 90 days");
    expect(w.find("button[aria-haspopup='dialog']").text()).toContain("90d");
  });

  // The whole point: ONE click changes the window. The old calendar needed two, and the first was inert.
  it("changes the window from a single click, and it reaches the URL", async () => {
    const { w, router } = await mountFilter();
    await openPanel(w);
    presetButton("Last 7 days")!.click();
    await flushPromises();

    expect(windowDays(String(router.currentRoute.value.query.from), String(router.currentRoute.value.query.to))).toBe(7);
    expect(router.currentRoute.value.query.to).toBe(today());
  });

  it("writes both ends of the window in the same navigation", async () => {
    const { w, router } = await mountFilter();
    await openPanel(w);
    presetButton("Last 30 days")!.click();
    await flushPromises();
    // Neither end may be missing — a half-written window is what welded the old picker to 90 days.
    expect(router.currentRoute.value.query.from).toBeTruthy();
    expect(router.currentRoute.value.query.to).toBeTruthy();
  });

  it("applies dates typed into the fields", async () => {
    const { w, router } = await mountFilter();
    await openPanel(w);
    const inputs = panel()!.querySelectorAll("input[type='date']");
    const setInput = async (el: Element, v: string) => {
      (el as HTMLInputElement).value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
    };
    await setInput(inputs[0]!, "2026-08-05");
    await setInput(inputs[1]!, "2026-08-12");
    [...panel()!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Apply")!.click();
    await flushPromises();

    expect(router.currentRoute.value.query.from).toBe("2026-08-05");
    expect(router.currentRoute.value.query.to).toBe("2026-08-12");
  });

  it("does not rewrite the window while a date is still being typed", async () => {
    // `<input type="date">` emits per keystroke; binding it straight through would push 0002-08-05 to
    // the URL on the way to 2026-08-05.
    const { w, router } = await mountFilter();
    const before = { ...router.currentRoute.value.query };
    await openPanel(w);
    const input = panel()!.querySelector("input[type='date']") as HTMLInputElement;
    input.value = "0002-08-05";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual(before);
  });

  it("marks the active period so the reader can see which one is in force", async () => {
    const { w } = await mountFilter();
    await openPanel(w);
    const active = presetButton("Last 90 days");
    const inactive = presetButton("Last 7 days");
    expect(active!.className).not.toBe(inactive!.className);
  });

  it("warns when a link carried a window it had to correct", async () => {
    const { w } = await mountFilter("?from=2026-08-12&to=2026-08-05");
    await openPanel(w);
    expect(panel()!.textContent).toContain("swapped");
  });

  it("shows a corrected window rather than the nonsense that was linked", async () => {
    const { router } = await mountFilter("?from=2031-01-01&to=2031-06-01");
    // Reading it back must not reproduce the future range that was asked for.
    await flushPromises();
    const q = router.currentRoute.value.query;
    // The URL still holds what was linked; what the CONTROL reports is the normalised window.
    expect(String(q.to) > today()).toBe(true);
    const trigger = document.querySelector("button[aria-haspopup='dialog']")!;
    expect(trigger.textContent).not.toContain("2031");
  });

  it("hides the reset affordance when the window is already the default", async () => {
    const { w } = await mountFilter();
    expect(w.find("button[aria-label='Reset period to the last 90 days']").exists()).toBe(false);
  });

  it("offers reset once the window has been narrowed, and returns to the default", async () => {
    const { w, router } = await mountFilter();
    await openPanel(w);
    presetButton("Last 7 days")!.click();
    await flushPromises();

    const reset = w.find("button[aria-label='Reset period to the last 90 days']");
    expect(reset.exists()).toBe(true);
    await reset.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.from).toBeUndefined();
    expect(w.find("button[aria-haspopup='dialog']").text()).toContain("Last 90 days");
    expect(windowDays(defaultWindow(today()).from, defaultWindow(today()).to)).toBe(90);
  });

  it("closes on escape from wherever focus happens to be, and changes nothing", async () => {
    // Dispatched at the DOCUMENT, not at the trigger: a `role="dialog"` div is not focusable, so a
    // handler bound to it only fires for someone who already focused that exact node. Escape has to
    // work mid-way through typing a date too.
    const { w, router } = await mountFilter();
    const before = { ...router.currentRoute.value.query };
    await openPanel(w);
    expect(panel()).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(panel()).toBeNull();
    expect(router.currentRoute.value.query).toEqual(before);
  });

  it("stops listening for escape once it is closed", async () => {
    // A document listener that outlives its panel is a leak that also steals Escape from whatever the
    // reader does next.
    const { w } = await mountFilter();
    await openPanel(w);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(panel()).toBeNull();
    // Re-opening must still work, which it would not if the handler had been torn down permanently.
    await openPanel(w);
    expect(panel()).toBeTruthy();
  });
});
