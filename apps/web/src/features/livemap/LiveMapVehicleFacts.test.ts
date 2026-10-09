import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import type { LiveMapBoard, LiveMapVehicle } from "@silvicom/shared";
import LiveMapVehicleFacts from "./LiveMapVehicleFacts.vue";

// SP5: the links here ask the router guard's own function (`useOpens`), which reads the session. The
// real shape, from `testing/fakeSession`; the admin opens everything unless a test says otherwise.
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

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

/**
 * SP5 (plan §4b): each door on the card opens only where its page does. The map is `dispatch` view;
 * a truck is `equipment`, a driver `roster`, and Loads can be switched off per person. Mounted without
 * the catch-all router above, so the links are judged against the app's real route table.
 */
describe("LiveMapVehicleFacts — its doors (SP5)", () => {
  const RouterLink = { props: ["to"], template: `<a :href="String(to)"><slot /></a>` };
  const compact = () =>
    mount(LiveMapVehicleFacts, {
      props: {
        vehicle: { ...vehicle({ id: "l1", ref: "0003", status: "in_transit", source: "tms", externalStatus: "P", nextStop: null }), driver: { id: "d1", name: "Reyes" } } as LiveMapVehicle,
        board,
        density: "compact",
      },
      global: { stubs: { RouterLink } },
    });

  it("opens the load, the truck and the driver for the admin", () => {
    const hrefs = compact().findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/loads/l1", "/vehicles/veh-1", "/drivers/d1"]));
  });

  it("draws the truck and driver doors as icons that keep their words as name and tooltip (D-TC1)", () => {
    const RouterLinkWithAttrs = { props: ["to"], inheritAttrs: true, template: `<a :href="String(to)"><slot /></a>` };
    const w = mount(LiveMapVehicleFacts, {
      props: {
        vehicle: { ...vehicle(null), driver: { id: "d1", name: "Reyes" } } as LiveMapVehicle,
        board,
        density: "compact",
      },
      global: { stubs: { RouterLink: RouterLinkWithAttrs } },
    });
    const door = (href: string) => w.find(`a[href="${href}"]`);
    for (const [href, words] of [["/vehicles/veh-1", "Open truck"], ["/drivers/d1", "Open driver"]] as const) {
      expect(door(href).attributes("aria-label")).toBe(words);
      expect(door(href).attributes("title")).toBe(words);
      expect(door(href).find("svg").exists()).toBe(true);
      // The words are the name, not the picture: no visible text competes with the icon.
      expect(door(href).text()).toBe("");
    }
  });

  it("keeps the load as words and drops the driver for a person whose Loads and Drivers are off", async () => {
    const { __session: session } = (await import("@/stores/session")) as unknown as {
      __session: import("@/testing/fakeSession").FakeSession;
    };
    session.surfaces = { "dispatch.loads": false, "fleet.drivers": false };
    try {
      const w = compact();
      const hrefs = w.findAll("a").map((a) => a.attributes("href"));
      expect(hrefs).toEqual(["/vehicles/veh-1"]);
      expect(w.text()).toContain("0003 · In transit");
    } finally {
      session.surfaces = null;
    }
  });
});
