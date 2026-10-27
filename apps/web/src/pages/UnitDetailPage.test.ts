import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import type { AssetDto, UnitKitDto } from "@silvicom/shared";

/**
 * One unit's page (INVENTORY-PLAN.md I9).
 *
 * ── ⚠ THE ASSERTION THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
 * **Taking something off a truck is a MOVE, not a delete.** An asset is always somewhere, and a row
 * that stopped naming a holder without a movement would leave the ledger unable to say where the
 * thing went — which is the one question the whole feature exists to answer. The affordance opens
 * `AssetMoveDrawer`, the same door the asset page opens, so both paths write the same row (D-INV3).
 * A "Remove" that called a delete would look tidier and would break no other test in this repo.
 *
 * The rest is what the page must not do: recompute the kit, or hide where a number came from.
 */

const TRUCK = "11111111-1111-4111-8111-111111111111";
const BAR = "55555555-5555-4555-8555-555555555555";

const unit: UnitKitDto = {
  kind: "tractor",
  unitId: TRUCK,
  unitNumber: "654",
  inferredDriverName: "Dana Reyes",
  state: "short",
  shortBy: 2,
  extraBy: 0,
  lastCheckedAt: null,
  lines: [
    { assetTypeId: BAR, assetTypeName: "Load bar", expected: 2, held: 0, delta: -2, source: "fleet" },
    { assetTypeId: "t2", assetTypeName: "Tablet", expected: 1, held: 1, delta: 0, source: "type" },
  ],
};

/** What "Check this unit" gets back from the server — a new walk, or the open one handed back (R9). */
const openWalk = vi.fn(async () => ({
  id: "99999999-9999-4999-8999-999999999999",
  resumed: false,
  openedAt: "2026-10-19T14:00:00.000Z",
  startedByName: "Shop Lead",
}));

const asset: AssetDto = {
  id: "as-1",
  tagCode: null,
  displayNo: "A-0412",
  assetTypeId: "t2",
  assetTypeName: "Tablet",
  name: "Cab tablet",
  serialNumber: "SN-1",
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  holder: { kind: "vehicle", id: TRUCK, label: "654", inferredDriverName: "Dana Reyes", since: null },
  purchasedAt: null,
  purchaseCost: null,
  warrantyExpiresAt: null,
  imagePath: null,
  notes: null,
};

vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitKitQuery: () => ({ data: r({ unit, assets: [asset] }), isLoading: r(false), isError: r(false), error: r(null), refetch: vi.fn() }),
    useKitExpectationsQuery: () => ({ data: r([]) }),
    useSetKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useDeleteKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useLocationsQuery: () => ({ data: r([]) }),
    // The page can start a walk of this unit (D-INV19); `UnitCheck.test.ts` drives the walk itself.
    useOpenCountSession: () => ({ mutateAsync: openWalk, isPending: r(false) }),
    // R9: the unit's open check; `OpenCountsList.test.ts` drives the list itself.
    useCountSessionsQuery: () => ({ data: r({ sessions: [], total: 0 }), isError: r(false), isFetching: r(false), refetch: vi.fn() }),
    useCloseCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    useAssetTypesQuery: () => ({ data: r([]) }),
    useMoveAsset: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/composables/useVehicles", async () => {
  const { ref: r } = await import("vue");
  return { useVehiclesQuery: () => ({ data: r([]) }) };
});
vi.mock("@/composables/useTrailers", async () => {
  const { ref: r } = await import("vue");
  return { useTrailersQuery: () => ({ data: r([]) }) };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("vue-router", async (importOriginal) => ({
  // SP5: `useOpens()` resolves links against the route table with the REAL router factory, so the
  // three names it takes from vue-router stay real under this mock.
  ...(({ routerKey, createRouter, createMemoryHistory }) => ({ routerKey, createRouter, createMemoryHistory }))(
    await importOriginal<typeof import("vue-router")>(),
  ),
  useRoute: () => ({ params: { kind: "tractor", id: TRUCK }, query: {}, meta: { title: "Unit" }, matched: [] }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { useToastStore } = await import("@/stores/toast");
const UnitDetailPage = (await import("@/pages/UnitDetailPage.vue")).default;
const AssetMoveDrawer = (await import("@/features/inventory/AssetMoveDrawer.vue")).default;
const page = () => mount(UnitDetailPage, { attachTo: document.body, global: { stubs: { SlideOver: true } } });

/**
 * Row actions live behind the ⋮ (contract §5.6), so every one of them is two clicks — and the panel
 * is TELEPORTED to `<body>`, which is how `KebabMenu` escapes the table's overflow. It is therefore
 * not inside the wrapper and `w.findAll` cannot see it; stubbing the teleport to bring it back in
 * makes `useFloating`'s `autoUpdate` recurse until Vue aborts. `InspectorRegisterPage.test.ts`
 * records the same finding, and the query is on the real document, which is where a click lands.
 */
async function rowActions(w: ReturnType<typeof page>): Promise<string[]> {
  const trigger = w.element.querySelector('button[aria-label="Actions"]') as HTMLButtonElement | null;
  trigger?.click();
  await nextTick();
  return Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");
}

beforeEach(() => {
  document.body.innerHTML = "";
  setActivePinia(createPinia());
  unit.lastCheckedAt = null;
  openWalk.mockClear();
});

describe("one unit", () => {
  it("offers a MOVE for something on the unit, never a delete", async () => {
    const w = page();
    const actions = await rowActions(w);
    expect(actions.some((t) => /move/i.test(t))).toBe(true);
    expect(actions.some((t) => /remove|delete|take off/i.test(t))).toBe(false);

    const move = Array.from(document.body.querySelectorAll("button")).find((b) =>
      /move it somewhere/i.test(b.textContent ?? ""),
    );
    move!.click();
    await nextTick();
    expect(w.findComponent(AssetMoveDrawer).exists()).toBe(true);
  });

  it("renders the shortfall the API computed", () => {
    // Two lines, one of them short by two: a page doing its own arithmetic over LINES would say 1.
    expect(page().text()).toContain("Missing 2");
  });

  it("says where each expected number came from, so a fleet rule is not mistaken for this truck's", () => {
    const text = page().text();
    expect(text).toContain("Fleet default");
    expect(text).toContain("The type's own default");
  });

  it("names the driver once — inferred, and never stored (D-INV3)", () => {
    const matches = page().text().match(/Dana Reyes/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

/** R9 and R10 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5). */
describe("checking this unit", () => {
  const OpenCountsList = async () => (await import("@/features/inventory/OpenCountsList.vue")).default;

  it("says a never-checked kit is what the records say, and a checked one when", () => {
    expect(page().text()).toContain("Never checked");
    unit.lastCheckedAt = "2026-10-20T12:00:00.000Z";
    expect(page().text()).toContain("Last checked 10/20/2026");
  });

  it("lists this truck's open check, and no other unit's", async () => {
    const list = page().findComponent(await OpenCountsList());
    expect(list.props()).toMatchObject({ vehicleId: TRUCK, trailerId: undefined });
  });

  it("says it is continuing when the server handed back the open check", async () => {
    openWalk.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      resumed: true,
      openedAt: "2026-10-19T14:00:00.000Z",
      startedByName: "Shop Lead",
    });
    const w = page();
    await w.findAll("button").find((b) => b.text() === "Check this unit")!.trigger("click");
    await flushPromises();
    const toasts = useToastStore().toasts.map((t) => t.title);
    expect(toasts).toContain("Continuing the open check");
  });

  it("says nothing extra when the walk is new", async () => {
    const w = page();
    await w.findAll("button").find((b) => b.text() === "Check this unit")!.trigger("click");
    await flushPromises();
    expect(useToastStore().toasts.map((t) => t.title)).not.toContain("Continuing the open check");
  });
});
