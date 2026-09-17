import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { AppCard } from "@silvicom/ui";
import ExplainerPanel from "./ExplainerPanel.vue";

/**
 * The disclosure the four Finance reports keep their method in.
 *
 * What matters here is that the content stays in the DOM while the panel is closed. The whole
 * argument for moving that text off the page was that none of it could be LOST, and a panel that
 * renders its slot only when open would lose it for anyone using the browser's in-page search or a
 * screen reader's document walk — which is exactly what a `v-if` toggle does and `<details>` does
 * not. If this ever becomes a JS-toggled panel, this test is what should stop it.
 */
describe("ExplainerPanel", () => {
  it("keeps the explanation in the document while collapsed", () => {
    const w = mount(ExplainerPanel, {
      slots: { default: "<p>Overhead is spread across the miles.</p>" },
      global: { stubs: { AppIcon: true } },
    });
    const details = w.get("details");
    expect(details.attributes("open")).toBeUndefined();
    expect(details.text()).toContain("Overhead is spread across the miles.");
  });

  it("defaults its summary to the question a report reader is asking", () => {
    const w = mount(ExplainerPanel, { global: { stubs: { AppIcon: true } } });
    expect(w.get("summary").text()).toBe("How this is calculated");
  });

  it("takes a summary of its own, because not every panel explains a calculation", () => {
    const w = mount(ExplainerPanel, {
      props: { summary: "Why this has to be entered by hand" },
      global: { stubs: { AppIcon: true } },
    });
    expect(w.get("summary").text()).toBe("Why this has to be entered by hand");
  });

  /**
   * The `inline` variant (`Q-LM19`) — the same disclosure on a surface that is already a panel.
   *
   * ⚠ What is pinned is the CONTAINER and the typography, because both are what a call-site class
   * could not have changed: `AppCard` is a component, so a class cannot remove it, and D-LM22
   * measured the other half on `AppButton` — a utility passed in shares a cascade layer with the
   * component's own and loses silently. Proved by mutation: making `inline` render the card fails
   * the first assertion, and dropping the variant from the summary's classes fails the second.
   */
  it("drops the card and the heading weight when it is inline, and keeps both when it is not", () => {
    const inline = mount(ExplainerPanel, {
      props: { variant: "inline", summary: "171 trucks in the fleet" },
      slots: { default: "<p>Per-dispatcher scoping needs McLeod.</p>" },
      global: { stubs: { AppIcon: true } },
    });
    expect(inline.findComponent(AppCard).exists()).toBe(false);
    expect(inline.get("summary").classes()).toContain("text-2xs");
    // The disclosure itself is unchanged — closed, with its content still in the document.
    expect(inline.get("details").attributes("open")).toBeUndefined();
    expect(inline.text()).toContain("Per-dispatcher scoping needs McLeod.");

    const card = mount(ExplainerPanel, { global: { stubs: { AppIcon: true } } });
    expect(card.findComponent(AppCard).exists()).toBe(true);
    expect(card.get("summary").classes()).toContain("font-semibold");
  });
});
