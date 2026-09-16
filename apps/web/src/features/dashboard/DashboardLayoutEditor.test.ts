import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { section, type DashboardWidget, type StoredDashboardLayout } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";

/**
 * The Dashboard layout drawer (LM10, D-DW3).
 *
 * What is worth pinning here is the PAYLOAD and the RESET, because both are ways to destroy
 * something a person meant to keep and neither looks wrong in a diff:
 *
 *  · the payload must carry what they see AND leave the other tab's decisions alone — `mergeTabLayout`
 *    owns that rule and is tested in `packages/shared`, so what this file proves is that the drawer
 *    hands it the right three arguments and not, say, the whole catalogue;
 *  · "Restore the default" must DELETE the row. An empty save means "show me nothing" and would
 *    freeze this person out of every default the product ever changes again — the one bug in this
 *    component that a person could not undo themselves.
 *
 * Everything else is a list with two buttons per row.
 */
const save = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
const stored = ref<StoredDashboardLayout | null>(null);
vi.mock("@/composables/useDashboardLayout", () => ({
  useDashboardLayout: () => ({
    layout: computed(() => stored.value),
    loading: computed(() => false),
    saving: computed(() => false),
    save,
    reset,
  }),
}));

/** Renders both slots inline, footer included — Save and Restore live in `#footer`. */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const DashboardLayoutEditor = (await import("./DashboardLayoutEditor.vue")).default;

const w = (key: string, label: string): DashboardWidget => ({
  key,
  label,
  tab: "fleet",
  gate: section("fuel"),
  span: "full",
});
const ALPHA = w("fleet.alpha", "Alpha");
const BETA = w("fleet.beta", "Beta");
const GAMMA = w("fleet.gamma", "Gamma");
const OFFERED = [ALPHA, BETA, GAMMA];

let pinia: ReturnType<typeof createPinia>;

const editor = (arranged: DashboardWidget[]) =>
  mount(DashboardLayoutEditor, {
    props: { open: true, offered: OFFERED, arranged },
    global: { plugins: [pinia], stubs: { SlideOver: SlideOverStub } },
  });

type Editor = ReturnType<typeof editor>;
const labels = (e: Editor) => e.findAll("li span").map((s) => s.text());
const click = async (e: Editor, label: string) => {
  const b = e.findAll("button").find((x) => (x.attributes("aria-label") ?? x.text()).trim() === label);
  expect(b, `no button "${label}"`).toBeTruthy();
  await b!.trigger("click");
};

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  save.mockReset();
  save.mockResolvedValue(undefined);
  reset.mockReset();
  reset.mockResolvedValue(undefined);
  stored.value = null;
});

describe("the dashboard layout drawer", () => {
  it("lists what is on screen first, then what is not, so the list reads like the page", async () => {
    // GAMMA is offered but not arranged — the caller has it hidden.
    expect(labels(editor([BETA, ALPHA]))).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("saves the arrangement, split into what is kept and what is hidden", async () => {
    const e = editor([ALPHA, BETA]);
    await click(e, "Hide Beta");
    await click(e, "Save");

    expect(save).toHaveBeenCalledWith({
      widgetKeys: ["fleet.alpha"],
      hiddenKeys: ["fleet.beta", "fleet.gamma"],
    });
  });

  it("saves the ORDER a move produced, not the order it started in", async () => {
    const e = editor([ALPHA, BETA, GAMMA]);
    await click(e, "Move Gamma up");
    await click(e, "Save");

    expect(save).toHaveBeenCalledWith({
      widgetKeys: ["fleet.alpha", "fleet.gamma", "fleet.beta"],
      hiddenKeys: [],
    });
  });

  /**
   * ⚠ The drawer edits ONE tab and the row spans every tab. A save that sent only what it is showing
   * would silently erase what this person decided about Dispatch — invisible until they next opened
   * the other tab and found it rearranged.
   */
  it("leaves another tab's decisions untouched", async () => {
    stored.value = { widgetKeys: ["dispatch.live-map"], hiddenKeys: ["dispatch.something"] };
    const e = editor([ALPHA]);
    await click(e, "Save");

    expect(save).toHaveBeenCalledWith({
      widgetKeys: ["dispatch.live-map", "fleet.alpha"],
      hiddenKeys: ["dispatch.something", "fleet.beta", "fleet.gamma"],
    });
  });

  it("restores the default by DELETING the row, never by saving an empty one", async () => {
    const e = editor([ALPHA, BETA, GAMMA]);
    await click(e, "Restore the default");

    expect(reset).toHaveBeenCalledOnce();
    // The bug this asserts against: `save({ widgetKeys: [], hiddenKeys: […] })` looks identical on
    // screen and means the opposite — "show me nothing", for ever.
    expect(save).not.toHaveBeenCalled();
  });

  it("tells the person it worked, and says what went wrong when it did not", async () => {
    const ok = editor([ALPHA]);
    await click(ok, "Save");
    await ok.vm.$nextTick();
    expect(useToastStore().toasts.some((t) => t.title === "Dashboard saved")).toBe(true);

    save.mockRejectedValueOnce(new Error("Could not reach the server"));
    const bad = editor([ALPHA]);
    await click(bad, "Save");
    await bad.vm.$nextTick();
    expect(useToastStore().toasts.some((t) => t.title.includes("Could not save"))).toBe(true);
  });

  it("warns before the save, while an empty tab is still a choice", async () => {
    const e = editor([ALPHA]);
    expect(e.text()).not.toContain("Nothing is showing on this tab");
    await click(e, "Hide Alpha");
    expect(e.text()).toContain("Nothing is showing on this tab");
  });
});
