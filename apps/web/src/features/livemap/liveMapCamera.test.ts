import { describe, expect, it } from "vitest";
import { planCameraMove, SELECT_FLY_MS, SELECT_ZOOM } from "./liveMapCamera";

/**
 * The camera's rule, held still (D-LM19).
 *
 * ⚠ These exist because the rule used to live inside `LiveMapCanvas.vue`, which every test that
 * mounts this surface stubs — so no assertion in this repo could see it. The measurement behind each
 * case is in `liveMapCamera.ts`'s header; what is pinned here is the RULE, not the tile count.
 */

/** The continental US, roughly — the view a dispatcher gets when the map first fits the fleet. */
const FLEET_VIEW = { west: -125, south: 25, east: -66, north: 49 };
/** One truck's neighbourhood at zoom 11, which is about a quarter of a degree across. */
const CORRIDOR = { west: -87.3, south: 41.7, east: -87.1, north: 41.9 };

describe("planCameraMove", () => {
  it("travels to a truck the reader can already see, so they keep their bearings", () => {
    const move = planCameraMove({ lng: -87.2, lat: 41.8 }, CORRIDOR, 12);
    expect(move.kind).toBe("fly");
    expect(move).toMatchObject({ center: [-87.2, 41.8], durationMs: SELECT_FLY_MS });
  });

  it("arrives at a truck that is off screen, because there is no journey to follow", () => {
    // Chicago, from a reader looking at a Los Angeles corridor. The old camera dragged a zoom-11
    // viewport across every tile between the two.
    const move = planCameraMove({ lng: -87.6, lat: 41.9 }, { west: -118.4, south: 33.9, east: -118.1, north: 34.1 }, 12);
    expect(move.kind).toBe("jump");
    expect(move).toMatchObject({ center: [-87.6, 41.9], zoom: 12 });
  });

  it("keeps the reader's own zoom when they are already closer than the selection zoom", () => {
    expect(planCameraMove({ lng: -87.2, lat: 41.8 }, CORRIDOR, 14).zoom).toBe(14);
  });

  it("raises the zoom to the selection zoom when the reader is further out than it", () => {
    // The whole fleet is on screen at this zoom, so this is also the ONE case that still animates a
    // long move: the reader can see the destination and is watching the map dive into it.
    const move = planCameraMove({ lng: -87.6, lat: 41.9 }, FLEET_VIEW, 4);
    expect(move.zoom).toBe(SELECT_ZOOM);
    expect(move.kind).toBe("fly");
  });

  it("counts a truck exactly on the edge of the viewport as visible", () => {
    // An exclusive edge test would make the camera's behaviour turn on a float comparison no reader
    // could predict — the truck is drawn on screen, so it is one the reader can see.
    expect(planCameraMove({ lng: CORRIDOR.west, lat: CORRIDOR.north }, CORRIDOR, 12).kind).toBe("fly");
  });

  it("arrives when the truck is outside on latitude alone, not only on longitude", () => {
    // The first draft of the visibility test compared longitude only and passed everything above;
    // a fleet that runs I-80 east to west would have animated every click.
    expect(planCameraMove({ lng: -87.2, lat: 44 }, CORRIDOR, 12).kind).toBe("jump");
  });
});
