import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import type { LiveMapBoard, LiveMapVehicle } from "@silvicom/shared";
import LiveMapVehicleFacts from "./LiveMapVehicleFacts.vue";

/**
 * The load line of a selected truck (2026-09-28). Until then it printed `loads.status` raw —
 * `in_transit` — and a McLeod load McLeod has planned but not started would have read `approved`, the
 * approval chain's word. It now reads the Loads board's words (`loadBoardState`), with McLeod's own
 * code in the tooltip, and must still word a status when an older api sends no `source`.
 */
const board: Pick<LiveMapBoard, "generatedAt" | "bounds"> = {
  generatedAt: "2026-09-28T12:00:00.000Z",
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 5400, fuelFreshSeconds: 900 },
};

const vehicle = (load: LiveMapVehicle["load"]): LiveMapVehicle => ({
  vehicleId: "veh-1",
  unitNumber: "47",
  driver: null,
  state: "moving",
  ageSeconds: 12,
  engineState: null,
  inShop: false,
  fuel: null,
  load,
  position: {
    lat: 41.5, lng: -87.5, headingDegrees: 270, speedMph: 62, isEcuSpeed: true,
    formattedLocation: "Gary, IN", sampledAt: "2026-09-28T11:59:48.000Z", receivedAt: "2026-09-28T11:59:50.000Z",
  },
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }],
});

const facts = (load: LiveMapVehicle["load"]) =>
  mount(LiveMapVehicleFacts, { props: { vehicle: vehicle(load), board }, global: { plugins: [router] } });

describe("LiveMapVehicleFacts — the load line", () => {
  it("words a McLeod load planned but not started as the board does, with McLeod's code on hover", () => {
    const w = facts({ id: "l1", ref: "0001", status: "approved", source: "tms", externalStatus: "P", nextStop: null });
    const link = w.get('a[href="/loads/l1"]');
    expect(link.text()).toBe("0001 · Planned");
    expect(link.get("span").attributes("title")).toBe("McLeod status P (planned)");
    expect(link.text()).not.toContain("approved");
  });

  it("words a load under way 'In transit', never the raw enum", () => {
    const w = facts({ id: "l1", ref: "0002", status: "in_transit", source: "tms", externalStatus: "P", nextStop: null });
    expect(w.get('a[href="/loads/l1"]').text()).toBe("0002 · In transit");
  });

  it("still words the status against an api that sends no source (web and api deploy separately)", () => {
    const w = facts({ id: "l1", ref: "0003", status: "in_transit", nextStop: null });
    expect(w.get('a[href="/loads/l1"]').text()).toBe("0003 · In transit");
    expect(w.get('a[href="/loads/l1"] span').attributes("title")).toBeUndefined();
  });

  it("names the next stop the api chose", () => {
    const w = facts({
      id: "l1", ref: "0004", status: "in_transit", source: "tms", externalStatus: "P",
      nextStop: { seq: 2, kind: "dropoff", name: "Consignee", city: "Green Bay", state: "WI", appointmentStart: null, appointmentEnd: null, status: "pending" },
    });
    expect(w.text().replace(/\s+/g, " ")).toContain("Next stop: Consignee — Green Bay, WI");
  });
});
