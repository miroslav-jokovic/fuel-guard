import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { APPLICATION_SECTION_ORDER } from "@silvicom/shared";
import ApplyProgress from "./ApplyProgress.vue";

/**
 * The progress card (X4).
 *
 * What is worth pinning is not that a bar renders. It is the two decisions underneath it: the bar
 * INDICATES and the list NAVIGATES — because a 6px segment is a third of a usable touch target and a
 * driver aiming for step 3 in a moving truck would hit step 4 — and the list cannot reach a screen
 * the driver has never been to, because jumping does not validate and `next()` does.
 */
const card = (props: Partial<{ index: number; furthest: number; saveStatus: string | null }> = {}) =>
  mount(ApplyProgress, {
    props: { index: 3, furthest: 4, saveStatus: "Saved", ...props },
  });

const stepButtons = (w: ReturnType<typeof card>) =>
  w.findAll("#apply-step-list button");

describe("where the driver is", () => {
  it("names the current screen and counts it", () => {
    const w = card({ index: 3 });
    expect(w.text()).toContain("Where you have worked");
    expect(w.text()).toContain(`Step 4 of ${APPLICATION_SECTION_ORDER.length}`);
  });

  it("keeps the bar out of the accessibility tree, so the facts are announced once", () => {
    // The heading and the counter already say this in words; a screen reader reading nine unlabelled
    // segments as well would be told the same thing twice and understand it less.
    expect(card().find('[aria-hidden="true"]').exists()).toBe(true);
  });

  it("fills a segment for every screen behind the driver and for the one they are on", () => {
    const filled = card({ index: 3 })
      .findAll('[aria-hidden="true"] > div')
      .filter((d) => d.classes().includes("bg-brand-500"));
    expect(filled).toHaveLength(4);
  });
});

describe("the step list, which is the part that navigates", () => {
  it("stays closed until it is asked for", () => {
    expect(stepButtons(card())).toHaveLength(0);
  });

  it("opens on the counter, and names every screen", async () => {
    const w = card();
    await w.find('button[aria-controls="apply-step-list"]').trigger("click");
    expect(stepButtons(w)).toHaveLength(APPLICATION_SECTION_ORDER.length);
    expect(w.text()).toContain("Your licence");
    expect(w.text()).toContain("Sign and send");
  });

  it("refuses a screen the driver has never reached", async () => {
    // Not a style choice: `next()` validates the screen it leaves and jumping does not, so an open
    // door here is a way round the validation — and the driver would meet everything they skipped at
    // the Send button instead of one screen at a time.
    const w = card({ index: 1, furthest: 2 });
    await w.find('button[aria-controls="apply-step-list"]').trigger("click");
    const buttons = stepButtons(w);
    expect(buttons[2]!.attributes("disabled")).toBeUndefined();
    expect(buttons[3]!.attributes("disabled")).toBeDefined();
  });

  it("goes where it is told, and closes behind itself", async () => {
    const w = card({ index: 3, furthest: 4 });
    await w.find('button[aria-controls="apply-step-list"]').trigger("click");
    await stepButtons(w)[1]!.trigger("click");
    expect(w.emitted("goTo")).toEqual([["addresses"]]);
    expect(stepButtons(w)).toHaveLength(0);
  });

  it("emits nothing for a screen it will not go to", async () => {
    const w = card({ index: 0, furthest: 0 });
    await w.find('button[aria-controls="apply-step-list"]').trigger("click");
    await stepButtons(w)[5]!.trigger("click");
    expect(w.emitted("goTo")).toBeUndefined();
  });

  it("marks the current step for a reader who cannot see the dot", async () => {
    const w = card({ index: 3 });
    await w.find('button[aria-controls="apply-step-list"]').trigger("click");
    expect(stepButtons(w)[3]!.attributes("aria-current")).toBe("step");
    expect(stepButtons(w)[2]!.attributes("aria-current")).toBeUndefined();
  });
});

describe("that the answers are being kept", () => {
  it("shows what autosave last did", () => {
    expect(card({ saveStatus: "Saving…" }).text()).toContain("Saving…");
  });

  it("promises it before autosave has done anything, rather than showing a blank", () => {
    // A card that is empty until the first save reads, on the first screen, as a form that is not
    // keeping anything.
    const w = card({ saveStatus: null });
    expect(w.text()).toContain("Your answers save as you go");
  });

  it("says how to come back, where the evidence of saving is", () => {
    expect(card().text()).toContain("You can close this page and open your link again later.");
  });
});
