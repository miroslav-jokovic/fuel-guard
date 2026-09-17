import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { LiveMapBoard } from "@silvicom/shared";

/**
 * The live map's shared state — the decisions both the rail and the map read (D-DR5).
 *
 * ⚠ This file exists because two rulings were each about to be written into a template, where no
 * assertion could reach them. D-LM21 (clearing the search closes the card) was heading for
 * `LiveMapRail.vue`'s search handler, and a rule about the SELECTION is not the rail's to hold
 * anyway. D-LM23's ORDER — the viewport is a SCOPE and the state/search filters narrow within it — is
 * only visible in the relationship between `counts` and `filtered`, which no component test can see
 * because the workspace's canvas cannot mount in jsdom. `useLiveMapView` is the one place both
 * surfaces agree, and it is plain reactive state, so it can be called directly.
 */
const BOARD: LiveMapBoard = {
  generatedAt: "2026-09-17T12:00:00.000Z",
  scope: "all",
  scopeReason: "Showing every truck in the fleet.",
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 5400 },
  truncated: false,
  vehicles: [
    // Two in Chicago, one moving and one offline; one parked in Los Angeles. The geography is what
    // D-LM23 needs and the unit numbers are what D-LM21 searches for, so one board serves both.
    truck("chi-moving", "1042", "moving", 41.8, -87.6),
    truck("chi-offline", "1043", "offline", 41.9, -87.7),
    truck("la-parked", "204", "parked", 34.0, -118.2),
  ],
};

function truck(
  id: string,
  unit: string,
  state: LiveMapBoard["vehicles"][number]["state"],
  lat: number,
  lng: number,
) {
  return {
    vehicleId: id,
    unitNumber: unit,
    driver: null,
    state,
    ageSeconds: 6,
    load: null,
    position: {
      lat,
      lng,
      headingDegrees: 90,
      speedMph: state === "moving" ? 62 : 0,
      isEcuSpeed: true,
      formattedLocation: "Somewhere",
      sampledAt: "2026-09-17T11:59:54.000Z",
      receivedAt: null,
    },
  };
}

const board = {
  data: ref<LiveMapBoard | undefined>(BOARD),
  isLoading: ref(false),
  isFetching: ref(false),
  isError: ref(false),
  error: ref<Error | null>(null),
  refetch: vi.fn(),
};

vi.mock("./useLiveMapBoard", () => ({
  LIVE_MAP_POLL_MS: 5_000,
  LIVE_MAP_QUERY_KEY: ["livemap", "positions"],
  useLiveMapBoard: () => board,
}));

const { useLiveMapView } = await import("./useLiveMapView");

/** The camera parked over Chicago, which leaves the Los Angeles truck off screen. */
const CHICAGO = { west: -88.5, south: 41, east: -87, north: 42.5 };

describe("useLiveMapView — clearing the search (D-LM21, the owner's item 4)", () => {
  let view: ReturnType<typeof useLiveMapView>;

  beforeEach(() => {
    view = useLiveMapView();
  });

  it("closes the truck card when the reader clears a search they had typed", () => {
    // The gesture this is about: find one truck, open it, then clear the box to get the fleet back.
    view.setSearch("1042");
    view.selectedId.value = "chi-moving";
    expect(view.selected.value?.unitNumber).toBe("1042");

    view.setSearch("");
    expect(view.selectedId.value).toBeNull();
    expect(view.selected.value).toBeNull();
  });

  it("leaves a truck picked off the map alone, because an empty search is also how the rail opens", () => {
    // Nothing was ever typed, so nothing is being cleared. Closing the card on every empty search
    // would mean a truck clicked on the map or in the full list could never stay open.
    view.selectedId.value = "la-parked";
    view.setSearch("");
    expect(view.selectedId.value).toBe("la-parked");
  });

  it("keeps the selection while the search is being NARROWED, not only when it is empty", () => {
    view.setSearch("1");
    view.selectedId.value = "chi-moving";
    view.setSearch("10");
    view.setSearch("1042");
    expect(view.selectedId.value).toBe("chi-moving");
  });

  it("does not close the card when a census button narrows the list instead", () => {
    // The tempting one-rule version was "clear the selection when it leaves `filtered`". It is the
    // wrong rule twice over: it does nothing on the gesture the owner named, because clearing a
    // search makes the list LARGER — and it would shut a card the reader had not finished reading
    // the moment they pressed a status filter.
    view.selectedId.value = "chi-moving";
    view.stateFilter.value = ["parked"];
    expect(view.filtered.value.map((v) => v.vehicleId)).toEqual(["la-parked"]);
    expect(view.selectedId.value).toBe("chi-moving");
  });
});

describe("useLiveMapView — the viewport is a scope, not a fourth filter (D-LM23, item 7)", () => {
  let view: ReturnType<typeof useLiveMapView>;

  beforeEach(() => {
    view = useLiveMapView();
  });

  it("shows the whole fleet until a viewport is set, so null is OFF", () => {
    expect(view.filtered.value).toHaveLength(3);
    expect(view.counts.value.parked).toBe(1);
  });

  it("narrows the list to what the camera can see", () => {
    view.viewport.value = CHICAGO;
    expect(view.filtered.value.map((v) => v.unitNumber)).toEqual(["1042", "1043"]);
  });

  it("makes the CENSUS follow the viewport, so a count describes what pressing it gives you", () => {
    view.viewport.value = CHICAGO;
    expect(view.counts.value).toEqual({ moving: 1, stopped: 0, parked: 0, offline: 1 });
  });

  it("leaves the census alone when a status filter narrows the LIST, which is what makes it a filter", () => {
    // The order is the whole design: if the viewport were one more field inside `filters`, the census
    // would count its own output and pressing "Moving" would zero the other three.
    view.viewport.value = CHICAGO;
    view.stateFilter.value = ["moving"];
    expect(view.filtered.value.map((v) => v.unitNumber)).toEqual(["1042"]);
    expect(view.counts.value.offline).toBe(1);
  });

  it("keeps the whole fleet available for the foot's total, which is what keeps the census honest", () => {
    view.viewport.value = CHICAGO;
    // A dispatcher zoomed into one metro reads "Offline 0" for the metro. `vehicles` is the
    // denominator that tells them how much of the fleet those counts exclude.
    expect(view.vehicles.value).toHaveLength(3);
    expect(view.scoped.value).toHaveLength(2);
  });

  /**
   * ⚠ Found by walking the surface, not by reasoning about it: zooming into open country with the
   * toggle on emptied the rail under "No trucks match these filters", which sends a reader hunting
   * through a census where nothing is pressed. The camera is the filter, so the sentence names it.
   */
  it("says the CAMERA is what emptied the list, when the camera is what emptied the list", () => {
    view.viewport.value = { west: -100, south: 10, east: -99, north: 11 };
    expect(view.scoped.value).toHaveLength(0);
    expect(view.emptyText.value).toContain("No trucks in view");
    expect(view.emptyText.value).toContain("Only trucks in view");
  });

  it("still blames the filters when a filter is what emptied the list", () => {
    view.viewport.value = CHICAGO;
    view.stateFilter.value = ["stopped"];
    expect(view.filtered.value).toHaveLength(0);
    // The viewport is not empty — two trucks are in it — so the camera is not the thing to name.
    expect(view.emptyText.value).toBe("No trucks match these filters.");
  });

  it("keeps a selected truck's card open after the reader pans away from it", () => {
    // `selected` resolves against the whole board on purpose: the panel answers "what is 204 doing",
    // and that answer does not stop being true because the camera moved.
    view.selectedId.value = "la-parked";
    view.viewport.value = CHICAGO;
    expect(view.selected.value?.unitNumber).toBe("204");
  });
});
