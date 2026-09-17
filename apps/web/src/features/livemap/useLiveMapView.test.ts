import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { LiveMapBoard } from "@silvicom/shared";

/**
 * The live map's shared state — the decisions both the rail and the map read (D-DR5).
 *
 * ⚠ This file exists because D-LM21 was about to be written inside `LiveMapRail.vue`'s search
 * handler, where no assertion could reach it: the rail is a child of a workspace whose canvas cannot
 * mount, and a rule about the SELECTION is not the rail's to hold anyway. `useLiveMapView` is the one
 * place both surfaces agree, and it is plain reactive state, so it can be called directly.
 */
const BOARD: LiveMapBoard = {
  generatedAt: "2026-09-17T12:00:00.000Z",
  scope: "all",
  scopeReason: "Showing every truck in the fleet.",
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 5400 },
  truncated: false,
  vehicles: [
    {
      vehicleId: "veh-1",
      unitNumber: "1042",
      driver: { id: "drv-1", name: "Jordan Ellis" },
      state: "moving",
      ageSeconds: 6,
      load: null,
      position: {
        lat: 41.5, lng: -87.5, headingDegrees: 270, speedMph: 62, isEcuSpeed: true,
        formattedLocation: "Gary, IN",
        sampledAt: "2026-09-17T11:59:54.000Z", receivedAt: "2026-09-17T11:59:56.000Z",
      },
    },
    {
      vehicleId: "veh-2",
      unitNumber: "204",
      driver: null,
      state: "parked",
      ageSeconds: 400,
      load: null,
      position: {
        lat: 44.5, lng: -88.0, headingDegrees: null, speedMph: 0, isEcuSpeed: null,
        formattedLocation: "Green Bay, WI",
        sampledAt: "2026-09-17T11:53:20.000Z", receivedAt: "2026-09-17T11:53:22.000Z",
      },
    },
  ],
};

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

describe("useLiveMapView — clearing the search (D-LM21, the owner's item 4)", () => {
  let view: ReturnType<typeof useLiveMapView>;

  beforeEach(() => {
    view = useLiveMapView();
  });

  it("closes the truck card when the reader clears a search they had typed", () => {
    // The gesture this is about: find one truck, open it, then clear the box to get the fleet back.
    view.setSearch("1042");
    view.selectedId.value = "veh-1";
    expect(view.selected.value?.unitNumber).toBe("1042");

    view.setSearch("");
    expect(view.selectedId.value).toBeNull();
    expect(view.selected.value).toBeNull();
  });

  it("leaves a truck picked off the map alone, because an empty search is also how the rail opens", () => {
    // Nothing was ever typed, so nothing is being cleared. Closing the card on every empty search
    // would mean a truck clicked on the map or in the full list could never stay open.
    view.selectedId.value = "veh-2";
    view.setSearch("");
    expect(view.selectedId.value).toBe("veh-2");
  });

  it("keeps the selection while the search is being NARROWED, not only when it is empty", () => {
    view.setSearch("1");
    view.selectedId.value = "veh-1";
    view.setSearch("10");
    view.setSearch("1042");
    expect(view.selectedId.value).toBe("veh-1");
  });

  it("does not close the card when a census button narrows the list instead", () => {
    // The tempting one-rule version was "clear the selection when it leaves `filtered`". It is the
    // wrong rule twice over: it does nothing on the gesture the owner named, because clearing a
    // search makes the list LARGER — and it would shut a card the reader had not finished reading
    // the moment they pressed a status filter.
    view.selectedId.value = "veh-1";
    view.stateFilter.value = ["parked"];
    expect(view.filtered.value.map((v) => v.vehicleId)).toEqual(["veh-2"]);
    expect(view.selectedId.value).toBe("veh-1");
  });
});
