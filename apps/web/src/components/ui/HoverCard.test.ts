import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import HoverCard from "./HoverCard.vue";

/**
 * The hover card's contract (HoverCard.vue): it opens on hover or focus, it is painted in `body` so a
 * table's scroller and sticky rows cannot clip or cover it, and the pointer can travel from the
 * trigger into the card to reach a button there without the card closing under it.
 */
vi.mock("@floating-ui/vue", () => ({
  useFloating: () => ({ floatingStyles: {} }),
  offset: () => undefined, flip: () => undefined, shift: () => undefined, autoUpdate: () => undefined,
}));

const Host = defineComponent({
  setup: () => () =>
    h("table", [h("tbody", [h("tr", [h("td", { "data-test": "cell" }, [
      h(HoverCard, null, {
        trigger: () => h("button", { type: "button", "data-test": "trigger" }, "thumb"),
        default: () => h("button", { type: "button", "data-test": "inside" }, "Download"),
      }),
    ])])])]),
});

const card = () => document.body.querySelector("[data-test=hover-card]");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("HoverCard", () => {
  it("is closed until hovered, then opens in body, outside the table cell", async () => {
    const w = mount(Host, { attachTo: document.body });
    expect(card()).toBeNull();
    await w.find("[data-test=trigger]").element.parentElement!.dispatchEvent(new Event("pointerenter"));
    await w.vm.$nextTick();
    expect(card()).not.toBeNull();
    expect(w.find("[data-test=cell]").element.contains(card())).toBe(false);
  });

  it("stays open while the pointer crosses from the trigger into the card, and closes once it leaves both", async () => {
    const w = mount(Host, { attachTo: document.body });
    const wrapper = w.find("[data-test=trigger]").element.parentElement!;
    wrapper.dispatchEvent(new Event("pointerenter"));
    await w.vm.$nextTick();
    wrapper.dispatchEvent(new Event("pointerleave"));
    card()!.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    await w.vm.$nextTick();
    expect(card()).not.toBeNull();
    card()!.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(500);
    await w.vm.$nextTick();
    expect(card()).toBeNull();
  });

  it("opens on keyboard focus and closes on Escape", async () => {
    const w = mount(Host, { attachTo: document.body });
    await w.find("[data-test=trigger]").trigger("focusin");
    expect(card()).not.toBeNull();
    await w.find("[data-test=trigger]").trigger("keydown", { key: "Escape" });
    expect(card()).toBeNull();
  });
});
