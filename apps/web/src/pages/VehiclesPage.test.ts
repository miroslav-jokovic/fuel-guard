import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { answerConfirm } from "@/testing/confirm";

/**
 * The Vehicles page arrives narrowed from the Operations tab's doors (FLEET-MANAGER-HOME-PLAN D-FM9):
 * `?check=` from the Seats and Truck paperwork cards, `?status=` from "Trucks on order". What is pinned
 * is that the list behind a door is the set the card counted — the same `matchesVehicleCheck`, on the
 * carrier's day, over the page's default `active` status.
 */
const idle = () => ({ isPending: ref(false), mutateAsync: vi.fn() });
const retire = vi.hoisted(() => vi.fn(async (_id: string) => ({})));
const vehicles = ref([
  { id: "t1", unit_number: "T-101", status: "active", assigned_driver_id: "a", dot_annual_inspection_expires_at: "2026-10-01", registration_expires_at: "2027-01-01" },
  { id: "t2", unit_number: "T-202", status: "active", assigned_driver_id: null, dot_annual_inspection_expires_at: "2027-03-01", registration_expires_at: "2026-09-30" },
  { id: "t3", unit_number: "T-303", status: "ordered", assigned_driver_id: null, dot_annual_inspection_expires_at: null, registration_expires_at: null },
]);
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: vehicles, isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
  useCreateVehicle: idle, useUpdateVehicle: idle, useRetireVehicle: () => ({ isPending: ref(false), mutateAsync: retire }), useBulkUpdateVehicles: idle,
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago"), isResolved: ref(true) }) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("fleet_manager");
  return { useSessionStore: () => s };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header><slot name='actions' /></header>" } }));
vi.mock("@/components/RosterFreshnessLine.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/features/roster/VehicleSetupImport.vue", () => ({ default: { template: "<span />" } }));

const VehiclesPage = (await import("./VehiclesPage.vue")).default;

async function mountAt(at: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
  await router.push(at);
  await router.isReady();
  const w = mount(VehiclesPage, { global: { plugins: [VueQueryPlugin, router], stubs: { RouterLink: RouterLinkStub } } });
  return { w, router };
}
const units = (w: Awaited<ReturnType<typeof mountAt>>["w"]) =>
  ["T-101", "T-202", "T-303"].filter((u) => w.text().includes(u));

beforeEach(() => {
  // The product's confirm (D-US7) is a Pinia store, so the page needs one to ask through.
  setActivePinia(createPinia());
  retire.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("the Vehicles page behind the Operations tab's doors", () => {
  it("opens on active trucks, as it always has", async () => {
    expect(units((await mountAt("/vehicles")).w)).toEqual(["T-101", "T-202"]);
  });

  it("narrows to the trucks a check names", async () => {
    expect(units((await mountAt("/vehicles?check=no_driver")).w)).toEqual(["T-202"]);
    expect(units((await mountAt("/vehicles?check=inspection_overdue")).w)).toEqual(["T-101"]);
    expect(units((await mountAt("/vehicles?check=registration_overdue")).w)).toEqual(["T-202"]);
  });

  it("opens on a status the link names, and reads `any` as every status", async () => {
    expect(units((await mountAt("/vehicles?status=ordered")).w)).toEqual(["T-303"]);
    expect(units((await mountAt("/vehicles?status=any")).w)).toEqual(["T-101", "T-202", "T-303"]);
  });

  it("ignores a check it does not know, rather than emptying the fleet", async () => {
    expect(units((await mountAt("/vehicles?check=banana")).w)).toEqual(["T-101", "T-202"]);
  });

  it("clears both back to where it opens", async () => {
    const { w, router } = await mountAt("/vehicles?status=ordered&check=no_driver");
    await w.findAll("button").find((b) => b.text().includes("Clear"))!.trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({}));
  });
});

/** Retire asks through the product's dialog, not the browser's (D-US7): the unit, the verb, in red. */
describe("retiring a vehicle", () => {
  async function pressRetire() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
    await router.push("/vehicles");
    await router.isReady();
    // The kebab's panel opens on a click the floating layer measures; its items are drawn inline here.
    const w = mount(VehiclesPage, {
      global: { plugins: [VueQueryPlugin, router], stubs: { RouterLink: RouterLinkStub, KebabMenu: { template: "<div><slot /></div>" } } },
    });
    await w.findAll("button").filter((b) => b.text() === "Retire vehicle")[0]!.trigger("click");
    await flushPromises();
  }

  it("asks which unit, in red, and retires nothing on a no", async () => {
    const asked = answerConfirm(false);
    await pressRetire();
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Retire vehicle T-101?", confirmLabel: "Retire", tone: "danger" }),
    );
    expect(retire).not.toHaveBeenCalled();
  });

  it("retires it on a yes", async () => {
    answerConfirm(true);
    await pressRetire();
    expect(retire).toHaveBeenCalledWith("t1");
  });
});
