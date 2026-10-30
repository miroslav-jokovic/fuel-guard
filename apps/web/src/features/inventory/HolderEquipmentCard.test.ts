import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * The equipment card on a truck's, trailer's and driver's page (EA1). It took over DE2b's driver card,
 * so its assertions came with it — this driver's list and nobody else's, since when, *Not returned* —
 * and adds what EA1 is for: a truck shows its driver's tablet without a Return on it, Return is one
 * tap when the shop has one bay, and nobody without the shop's manage right is offered a verb.
 */
const asked = vi.hoisted(() => [] as Array<{ filter: Record<string, unknown>; enabled: boolean }>);
const byFilter = vi.hoisted(() => ({ rows: new Map<string, unknown[]>() }));
const record = vi.hoisted(() => ({ mutateAsync: vi.fn(async (_i: Record<string, unknown>) => ({ id: "m" })) }));
const perms = vi.hoisted(() => ({ view: true, manage: true }));
const bays = vi.hoisted(() => ({ value: [{ id: "bay-1", name: "Shop", code: "SHOP" }] as unknown[] }));

vi.mock("./useAssets", async () => {
  const { computed } = await import("vue");
  return {
    useAssetsQuery: (f: { value: Record<string, unknown> }, enabled: { value: boolean }) => {
      asked.push({ filter: f.value, enabled: enabled.value });
      const key = JSON.stringify(f.value);
      const rows = byFilter.rows.get(key) ?? [];
      return { data: computed(() => ({ assets: rows, total: rows.length })), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() };
    },
    useMoveAsset: () => record,
    useAssetTypesQuery: () => ({ data: ref([]) }),
  };
});
vi.mock("./useInventory", () => ({ useLocationsQuery: () => ({ data: ref(bays.value) }) }));
const started = vi.hoisted(() => vi.fn());
vi.mock("./useStartUnitCheck", () => ({ useStartUnitCheck: () => ({ startCheck: started, openWalk: { isPending: { value: false } } }) }));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v-654", unit_number: "654", assigned_driver_id: "d-1" }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: "d-1", full_name: "Dana Reyes" }]) }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canView: () => perms.view, can: () => perms.manage }) }));

const HolderEquipmentCard = (await import("./HolderEquipmentCard.vue")).default;

const item = (id: string, typeName: string, holder: Record<string, unknown>, imei: string | null = null) => ({
  id,
  displayNo: `A-${id}`,
  name: `${typeName} ${id}`,
  assetTypeName: typeName,
  imei,
  holder: { inferredDriverName: null, since: null, ...holder },
});
const truck = { kind: "vehicle", id: "v-654", label: "Truck 654" } as const;
const dana = { kind: "driver", id: "d-1", label: "Dana Reyes" } as const;
/** The Assign list's open state is `?assign=1` (DE4), so the card reads the route. */
const makeRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)*", component: { template: "<div />" } }] });
const render = (target: typeof truck | typeof dana, router: Router = makeRouter()) =>
  mount(HolderEquipmentCard, {
    props: { target },
    global: { plugins: [router], stubs: { RouterLink: { template: "<a><slot /></a>" }, AssignEquipmentDrawer: true, AssetMoveDrawer: true, KebabMenu: { template: "<div><slot /></div>" } } },
  });

beforeEach(() => {
  setActivePinia(createPinia());
  asked.length = 0;
  byFilter.rows.clear();
  record.mutateAsync.mockClear();
  perms.view = true;
  perms.manage = true;
  bays.value = [{ id: "bay-1", name: "Shop", code: "SHOP" }];
});

describe("on a driver's page", () => {
  it("asks for this driver's equipment and nobody else's", () => {
    render(dana);
    expect(asked[0]!.filter).toEqual({ page: 1, driverId: "d-1" });
  });

  it("shows the number, the IMEI's last five, since when, and flags a driver who has left", () => {
    byFilter.rows.set(JSON.stringify({ page: 1, driverId: "d-1" }), [
      item("0412", "Tablet", { kind: "driver", id: "d-1", label: "Dana Reyes", since: "2026-10-29T15:00:00.000Z", notReturned: true }, "490154203237518"),
    ]);
    const text = render(dana).text();
    expect(text).toContain("A-0412");
    expect(text).toContain("IMEI …37518");
    expect(text).toContain("since 10/29/2026");
    expect(text).toContain("Not returned");
    expect(text).toContain("Give a tablet");
  });

  it("says so when the driver holds nothing", () => {
    expect(render(dana).text()).toContain("No tablet is with this driver.");
  });
});

describe("on a truck's page", () => {
  it("lists the truck's equipment and its driver's tablet — the tablet without a Return", () => {
    byFilter.rows.set(JSON.stringify({ page: 1, vehicleId: "v-654" }), [item("0001", "Ratchet strap", { kind: "vehicle", id: "v-654", label: "Truck 654" })]);
    byFilter.rows.set(JSON.stringify({ page: 1, driverId: "d-1" }), [item("0003", "Tablet", { kind: "driver", id: "d-1", label: "Dana Reyes" })]);
    const w = render(truck);
    expect(w.findAll("[data-test=holder-row]")).toHaveLength(1);
    expect(w.findAll("[data-test=holder-return]")).toHaveLength(1);
    expect(w.find("[data-test=holder-driver-row]").text()).toContain("with driver Dana Reyes");
    expect(w.text()).toContain("Assign equipment");
  });

  it("returns an item in one tap when the shop has one bay — a `removed` move into it", async () => {
    byFilter.rows.set(JSON.stringify({ page: 1, vehicleId: "v-654" }), [item("0001", "Ratchet strap", { kind: "vehicle", id: "v-654", label: "Truck 654" })]);
    const w = render(truck);
    await w.find("[data-test=holder-return]").trigger("click");
    await flushPromises();
    expect(record.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ assetId: "0001", reason: "removed", toLocationId: "bay-1" }));
  });

  it("asks where when the shop has two bays, instead of guessing", async () => {
    bays.value = [{ id: "bay-1" }, { id: "bay-2" }];
    byFilter.rows.set(JSON.stringify({ page: 1, vehicleId: "v-654" }), [item("0001", "Ratchet strap", { kind: "vehicle", id: "v-654", label: "Truck 654" })]);
    const w = render(truck);
    await w.find("[data-test=holder-return]").trigger("click");
    await flushPromises();
    expect(record.mutateAsync).not.toHaveBeenCalled();
    expect(w.findComponent({ name: "AssetMoveDrawer" }).exists()).toBe(true);
  });
});

describe("Check equipment (EA3)", () => {
  it("starts the truck's check from its card, by the roster's word for it", async () => {
    const w = render(truck);
    await w.find("[data-test=check-open]").trigger("click");
    expect(started).toHaveBeenCalledWith("tractor", "v-654");
  });

  it("is not offered on a driver's card — a check walks a unit", () => {
    expect(render(dana).find("[data-test=check-open]").exists()).toBe(false);
  });
});

describe("who sees what", () => {
  it("offers no verb to somebody who can only view the shop", () => {
    perms.manage = false;
    byFilter.rows.set(JSON.stringify({ page: 1, vehicleId: "v-654" }), [item("0001", "Ratchet strap", { kind: "vehicle", id: "v-654", label: "Truck 654" })]);
    const w = render(truck);
    expect(w.find("[data-test=assign-open]").exists()).toBe(false);
    expect(w.find("[data-test=holder-return]").exists()).toBe(false);
  });

  it("renders nothing, and asks nothing, without the shop's view", () => {
    perms.view = false;
    const w = render(truck);
    expect(w.find("[data-test=holder-equipment]").exists()).toBe(false);
    expect(asked.every((a) => !a.enabled)).toBe(true);
  });
});

describe("a scanned truck label opens the Assign list (DE4)", () => {
  async function at(url: string) {
    const router = makeRouter();
    await router.push(url);
    const w = render(truck, router);
    await flushPromises();
    return { w, router };
  }

  it("opens with the list already up when the address carries ?assign=1, and closing it drops only the flag", async () => {
    const { w, router } = await at("/vehicles/v-654?assign=1&section=maintenance");
    const drawer = w.findComponent({ name: "AssignEquipmentDrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("target")).toEqual(truck);
    drawer.vm.$emit("close");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ section: "maintenance" });
    expect(w.findComponent({ name: "AssignEquipmentDrawer" }).exists()).toBe(false);
  });

  it("keeps it shut for somebody who may only look, whatever the address says", async () => {
    perms.manage = false;
    const { w } = await at("/vehicles/v-654?assign=1");
    expect(w.findComponent({ name: "AssignEquipmentDrawer" }).exists()).toBe(false);
  });

  it("opens from the button too, by writing the same flag", async () => {
    const { w, router } = await at("/vehicles/v-654");
    await w.get('[data-test="assign-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ assign: "1" });
    expect(w.findComponent({ name: "AssignEquipmentDrawer" }).exists()).toBe(true);
  });
});

