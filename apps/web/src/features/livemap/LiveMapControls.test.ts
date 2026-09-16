import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LiveMapControls from "./LiveMapControls.vue";

/**
 * The map's control rail (D-DR20/D-DR21).
 *
 * ── WHAT IS WORTH PINNING HERE ───────────────────────────────────────────────────────────────────
 * Not "three buttons render" — that was never in doubt. The two things that cost something if they
 * regress are the ones an owner found by looking at the screen, not by reading the code:
 *
 *   · the rail must offer exactly the three basemaps that EXIST on our HERE plan, and must not grow
 *     a fourth Day/Night button — D-DR8 ruled that the scheme is derived, and a button would put the
 *     same answer on screen twice and let the two disagree;
 *   · the zoom buttons must be OURS, because maplibre's own sat underneath the filters panel.
 *
 * The overlap itself cannot be asserted here — it is a layout fact measured in a browser (27×56px,
 * at every width) and recorded in §7. What this file can hold still is that the affordance exists at
 * all, so a future tidy-up that deletes it in favour of `NavigationControl` fails here.
 */
const render = (basemap: "map" | "satellite" | "terrain" = "map") =>
  mount(LiveMapControls, { props: { basemap } });

describe("the live map's control rail", () => {
  it("offers the three basemaps our HERE plan actually serves", () => {
    const labels = render().findAll('[role="radio"]').map((b) => b.text());
    expect(labels).toEqual(["Map", "Satellite", "Terrain"]);
  });

  /**
   * ⚠ D-DR8's ruling, defended from the other direction. Satellite and terrain have no night variant
   * at HERE, and the road map's day/night is the reader's colour scheme — so a Day/Night control here
   * would be a second answer to a settled question.
   */
  it("grows no day/night control, because the scheme already answers that", () => {
    const text = render().text();
    expect(text).not.toMatch(/night/i);
    expect(text).not.toMatch(/\bday\b/i);
    expect(render().findAll('[role="radio"]')).toHaveLength(3);
  });

  it("marks the active basemap with aria-checked rather than colour alone", () => {
    const w = render("satellite");
    const checked = w.findAll('[role="radio"]').filter((b) => b.attributes("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.text()).toBe("Satellite");
  });

  it("asks its parent to change basemap rather than holding the choice itself", async () => {
    const w = render("map");
    await w.findAll('[role="radio"]')[2]!.trigger("click");
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
