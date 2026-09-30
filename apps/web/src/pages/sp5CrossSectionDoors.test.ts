import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";

/**
 * SP5 (plan §4b): doors from one section's page into another's. Each of these was unconditional,
 * and each crosses a section boundary the router guard checks — a load (`dispatch`) into the hazmat
 * workspace (`hazmat`), a vehicle (`equipment`) into the shop (`maintenance`). The session is the
 * real shape (`testing/fakeSession`), so the answers are the matrix's and the catalogue's.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/features/inventory/useUnits", () => ({
  useUnitKitQuery: () => ({
    data: ref({ unit: { state: "complete", lines: [] } }),
    isLoading: ref(false),
    isError: ref(false),
  }),
}));

const HazmatPanel = (await import("@/features/hazmat/HazmatPanel.vue")).default;
const UnitKitCard = (await import("@/features/inventory/UnitKitCard.vue")).default;

const RouterLink = { props: ["to"], template: `<a :href="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>` };
const global = { plugins: [VueQueryPlugin], stubs: { RouterLink } };
const buttonTexts = (w: ReturnType<typeof mount>) => w.findAll("a, button").map((b) => b.text().trim());

beforeEach(() => {
  setActivePinia(createPinia());
  session.role = "admin";
  session.sections = null;
  session.surfaces = null;
});

describe("the hazmat panel on a load", () => {
  const load = {
    id: "l1", vehicle_id: null, trailer_id: null, driver_id: null, stops: [],
    hazmat_record: {
      id: "h1", status: "needs_review", tank_state: "loaded", updated_at: "2026-09-01T00:00:00Z",
      latest_outcome: null, latest_run_at: null,
    },
  };

  it("opens the workspace and the review queue for the admin", () => {
    const t = buttonTexts(mount(HazmatPanel, { props: { load, canManage: true }, global }));
    expect(t.some((x) => x.startsWith("Open workspace"))).toBe(true);
    expect(t).toContain("Open review queue");
  });

  it("offers neither to a dispatcher whose org took hazmat away", () => {
    session.role = "dispatcher";
    session.sections = { hazmat: "none" };
    const t = buttonTexts(mount(HazmatPanel, { props: { load, canManage: true }, global }));
    expect(t.some((x) => x.startsWith("Open workspace"))).toBe(false);
    expect(t).not.toContain("Open review queue");
  });
});

describe("the kit card on a vehicle", () => {
  it("opens the unit in the shop, and not for a person whose Units screen is off", () => {
    const shop = () => mount(UnitKitCard, { props: { kind: "tractor", unitId: "v1" }, global }).text();
    expect(shop()).toContain("Open in the shop");
    session.surfaces = { "maintenance.units": false };
    expect(shop()).not.toContain("Open in the shop");
  });
});
