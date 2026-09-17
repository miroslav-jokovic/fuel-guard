import { afterEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LiveMapControls from "./LiveMapControls.vue";

/**
 * The map's control rail (D-DR20/D-DR21, relaid out by D-LM22).
 *
 * ── WHAT IS WORTH PINNING HERE ───────────────────────────────────────────────────────────────────
 * Not "three buttons render" — that was never in doubt. The things that cost something if they
 * regress are the ones an owner found by looking at the screen, not by reading the code:
 *
 *   · the rail must offer exactly the three basemaps that EXIST on our HERE plan, and must not grow
 *     a fourth Day/Night entry — D-DR8 ruled that the scheme is derived, and a control would put the
 *     same answer on screen twice and let the two disagree;
 *   · the zoom buttons must be OURS, because maplibre's own sat underneath the filters panel;
 *   · D-LM22 — the basemap is behind a button, and that button NAMES the active basemap. Hiding the
 *     row was the owner's ask; hiding which basemap you are on was not, and the difference between
 *     the two is the whole reason the trigger carries a label.
 *
 * ⚠ The panel is TELEPORTED to `body` by `KebabMenu`, so it is not inside the wrapper's element and
 * `wrapper.findAll` cannot see it. These read `document.body` after opening, which is also the only
 * way to assert the thing that matters: that the entries are behind a click rather than on screen.
 */
const render = (basemap: "map" | "satellite" | "terrain" = "map") =>
  mount(LiveMapControls, { props: { basemap }, attachTo: document.body });

/** The menu's own entries, wherever in the document they were teleported to. */
const entries = () =>
  [...document.querySelectorAll<HTMLElement>("button.kebab-item")].map((el) => el.textContent!.trim());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the live map's control rail", () => {
  it("keeps the basemaps behind a button rather than in a permanent row (D-LM22)", () => {
    render("satellite");
    // Nothing is open, so the two basemaps the reader is NOT on are not on the canvas at all…
    expect(entries()).toEqual([]);
    // …but the one they ARE on is still named, which is what the row used to tell them.
    expect(document.body.textContent).toContain("Satellite");
    expect(document.body.textContent).not.toContain("Terrain");
  });

  it("offers the three basemaps our HERE plan actually serves, once opened", async () => {
    const w = render();
    await w.get('[aria-label="Basemap: Map"]').trigger("click");
    expect(entries()).toEqual(["Map", "Satellite", "Terrain"]);
  });

  /**
   * ⚠ D-DR8's ruling, defended from the other direction and surviving the control's new shape.
   * Satellite and terrain have no night variant at HERE, and the road map's day/night is the reader's
   * colour scheme — so a Day/Night entry here would be a second answer to a settled question.
   */
  it("grows no day/night entry, because the scheme already answers that", async () => {
    const w = render();
    await w.get('[aria-label="Basemap: Map"]').trigger("click");
    expect(entries()).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/night/i);
    expect(document.body.textContent).not.toMatch(/\bday\b/i);
  });

  /**
   * ⚠ `aria-current` and NOT a colour, which is a measured limit rather than a preference. A brand
   * tint on the active entry was tried and did nothing: read back from the rendered DOM, all three
   * entries measured one background and one font weight, because a call-site utility and
   * `AppButton`'s own utility share a cascade layer. The trigger is what names the active basemap for
   * a sighted reader; this is the same answer for everybody else.
   */
  it("marks the active basemap with aria-current, which is the only mark the primitive allows", async () => {
    const w = render("satellite");
    await w.get('[aria-label="Basemap: Satellite"]').trigger("click");
    const current = [...document.querySelectorAll<HTMLElement>("button.kebab-item")].filter(
      (el) => el.getAttribute("aria-current") === "true",
    );
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent!.trim()).toBe("Satellite");
  });

  it("asks its parent to change basemap rather than holding the choice itself", async () => {
    const w = render("map");
    await w.get('[aria-label="Basemap: Map"]').trigger("click");
    document.querySelectorAll<HTMLElement>("button.kebab-item")[2]!.click();
    await w.vm.$nextTick();
    expect(w.emitted("update:basemap")?.[0]).toEqual(["terrain"]);
  });

  /**
   * The zoom affordance is the half that replaced maplibre's own control. It emits a direction and
   * lets the canvas own the camera — the rail has no map reference and should not grow one.
   */
  it("emits a zoom direction for each button", async () => {
    const w = render();
    await w.find('[aria-label="Zoom in"]').trigger("click");
    await w.find('[aria-label="Zoom out"]').trigger("click");
    expect(w.emitted("zoom")).toEqual([[1], [-1]]);
  });
});
