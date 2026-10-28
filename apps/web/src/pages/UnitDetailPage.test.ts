import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import type { AssetDto, UnitAttentionDto, UnitKitDto, UnitShopFileDto } from "@silvicom/shared";

/**
 * The truck's page — the shop's hub (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, M3, D-MX3).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **A different sentence from the list.** "Needs attention" words the server's reasons for THIS
 *      unit from the same read the Trucks & trailers list uses; a page that reasoned for itself would
 *      send a technician to a truck for one thing and show them another.
 *   2. **A PM verdict of its own.** The Due table prints the server's verdict (`pmStatus`); and a
 *      schedule nobody can judge says "Can't tell", never "OK" — F11's done-when, one level down.
 *   3. **Tabs.** Every section is on the page; the first section links DOWN it.
 *   4. **Taking something off a truck is a MOVE, not a delete** (D-INV3) — the equipment section's
 *      rule, kept here because this page is where the controls are.
 */

const TRUCK = "11111111-1111-4111-8111-111111111111";
const BAR = "55555555-5555-4555-8555-555555555555";

const file = (over: Partial<UnitShopFileDto> = {}): UnitShopFileDto => ({
  unit: {
    kind: "tractor", id: TRUCK, unitNumber: "654", year: 2022, make: "Volvo", model: "VNL", plate: "P 123", vin: "4V4NC9EH",
    status: "active", odometerMiles: 412_118, annualInspectionExpiresOn: "2026-11-05", registrationExpiresOn: null,
  },
  fleetpal: { unitIds: ["fp-1"], number: "654", lastMeter: { miles: 412_009, measuredAt: "2026-10-27T12:00:00Z" } },
  openWorkOrders: [{ id: "wo1", referenceNumber: "WO-1", unitNumber: "654", vehicleId: TRUCK, trailerId: null, description: "Brake job", priority: "High", openedAt: "2026-10-01T00:00:00Z" }],
  openDefects: [{ id: "d1", unitNumber: "654", vehicleId: TRUCK, trailerId: null, name: "Air leak", description: null, driverComment: "Hissing", detectedAt: "2026-10-10T00:00:00Z" }],
  history: [{ id: "wo0", referenceNumber: "WO-0", status: "CLOSED", description: null, jobs: ["Steer tires"], openedAt: "2026-06-01T00:00:00Z", completedAt: "2026-06-03T00:00:00Z", downtimeDays: 2 }],
  pm: {
    odometerMiles: 412_118,
    odometerSource: "roster",
    schedules: [
      { fleetpalId: "s1", name: "Oil Change", kind: "oil", lastDone: "2026-08-01T00:00:00Z", intervals: [{ intervalType: "odometer", verdict: "due", dueOn: null, dueAtMiles: 413_251, milesLeft: 1_133 }], verdict: "due" },
      { fleetpalId: "s2", name: "PM Reefer", kind: "other", lastDone: null, intervals: [], verdict: null },
    ],
  },
  ...over,
});
const shopFile = ref<UnitShopFileDto | null>(file());
const attention = ref<UnitAttentionDto[]>([
  { kind: "tractor", unitId: TRUCK, unitNumber: "654", reasons: [{ kind: "defect", count: 1, oldestDetectedAt: null }, { kind: "pm", name: "Oil Change", pmKind: "oil", verdict: "due", dueOn: null, milesLeft: 1_133 }] },
  { kind: "trailer", unitId: "t-other", unitNumber: "R-1", reasons: [{ kind: "short", shortBy: 9, lastCheckedAt: null }] },
]);

const unit: UnitKitDto = {
  kind: "tractor", unitId: TRUCK, unitNumber: "654", inferredDriverName: "Dana Reyes", state: "short", shortBy: 2, extraBy: 0, lastCheckedAt: null,
  lines: [
    { assetTypeId: BAR, assetTypeName: "Load bar", expected: 2, held: 0, delta: -2, source: "fleet" },
    { assetTypeId: "t2", assetTypeName: "Tablet", expected: 1, held: 1, delta: 0, source: "type" },
  ],
};
const openWalk = vi.fn(async () => ({ id: "99999999-9999-4999-8999-999999999999", resumed: false, openedAt: "2026-10-19T14:00:00.000Z", startedByName: "Shop Lead" }));
const asset: AssetDto = {
  id: "as-1", tagCode: null, displayNo: "A-0412", assetTypeId: "t2", assetTypeName: "Tablet", name: "Cab tablet", serialNumber: "SN-1", model: null, manufacturer: null,
  status: "in_service", condition: "good", holder: { kind: "vehicle", id: TRUCK, label: "654", inferredDriverName: "Dana Reyes", since: null },
  purchasedAt: null, purchaseCost: null, warrantyExpiresAt: null, imagePath: null, notes: null,
};

vi.mock("@/features/maintenance/useUnitShop", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitShopFileQuery: () => ({ data: shopFile, isPending: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    useUnitsAttentionQuery: () => ({ data: attention, isPending: r(false), isError: r(false), refetch: vi.fn() }),
    useUnitRepairBillsQuery: () => ({ data: r({ total: 1234.5, repairCount: 3, ratioLowerBound: 0.82, unavailable: null }), isPending: r(false), isError: r(false), isFetching: r(false), refetch: vi.fn() }),
  };
});
vi.mock("@/features/maintenance/useAnnualInspections", async () => {
  const { ref: r } = await import("vue");
  return {
    useInspectionsQuery: () => ({
      data: r({ inspections: [{ id: "insp-1", subject_type: "tractor", subject_id: TRUCK, unit_number: "654", inspector_name: "Lee Park", inspected_on: "2025-11-01", status: "final", outcome: "pass", next_due_on: null, decal_serial: null, inspector_id: "i1", document_id: null }], total: 2 }),
      isPending: r(false), isError: r(false), isFetching: r(false), refetch: vi.fn(),
    }),
  };
});
vi.mock("@/features/roadside/useRoadsideInspections", async () => {
  const { ref: r } = await import("vue");
  return { useRoadsideRepairsDueQuery: () => ({ data: r([]), isPending: r(false), isError: r(false), refetch: vi.fn() }), useRoadsideInspectionsQuery: () => ({ data: r([]), isPending: r(false), isError: r(false), isFetching: r(false), refetch: vi.fn() }) };
});
vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return { useUnitKitQuery: () => ({ data: r({ unit, assets: [asset] }), isPending: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }) };
});
vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useLocationsQuery: () => ({ data: r([]) }),
    useOpenCountSession: () => ({ mutateAsync: openWalk, isPending: r(false) }),
    useCountSessionsQuery: () => ({ data: r({ sessions: [], total: 0 }), isError: r(false), isFetching: r(false), refetch: vi.fn() }),
    useCloseCountSession: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return { useAssetTypesQuery: () => ({ data: r([]) }), useMoveAsset: () => ({ mutateAsync: vi.fn(), isPending: r(false) }) };
});
vi.mock("@/composables/useVehicles", async () => {
  const { ref: r } = await import("vue");
  return { useVehiclesQuery: () => ({ data: r([]) }) };
});
vi.mock("@/composables/useTrailers", async () => {
  const { ref: r } = await import("vue");
  return { useTrailersQuery: () => ({ data: r([]) }) };
});
vi.mock("@/composables/useOrgTimezone", async () => {
  const { computed: c } = await import("vue");
  return { useOrgTimezone: () => ({ zone: c(() => "America/Chicago"), isResolved: c(() => true) }) };
});
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(({ routerKey, createRouter, createMemoryHistory, RouterLink }) => ({ routerKey, createRouter, createMemoryHistory, RouterLink }))(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: { kind: "tractor", id: TRUCK }, query: {}, meta: { title: "Unit" }, matched: [] }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { useToastStore } = await import("@/stores/toast");
const UnitDetailPage = (await import("@/pages/UnitDetailPage.vue")).default;
const AssetMoveDrawer = (await import("@/features/inventory/AssetMoveDrawer.vue")).default;
const STUBS = { SlideOver: true, UnitFileSection: true, UnitInspectionsCard: true, NewInspectionDrawer: true, RouterLink: { template: "<a><slot /></a>", props: ["to"] } };
const page = () => mount(UnitDetailPage, { attachTo: document.body, global: { stubs: STUBS } });

async function rowActions(w: ReturnType<typeof page>): Promise<string[]> {
  const trigger = w.element.querySelector('button[aria-label="Actions"]') as HTMLButtonElement | null;
  trigger?.click();
  await nextTick();
  return Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");
}

beforeEach(() => {
  document.body.innerHTML = "";
  setActivePinia(createPinia());
  shopFile.value = file();
  unit.lastCheckedAt = null;
  openWalk.mockClear();
});

describe("the hub", () => {
  it("is one page of sections in the proposal's order, with no tab strip", () => {
    const w = page();
    const ids = ["section-attention", "section-repairs", "section-due", "section-annual", "section-equipment", "section-roadside", "section-papers"];
    const order = ids.map((id) => Array.from(w.element.querySelectorAll("[id]")).findIndex((el) => el.id === id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(w.find("[role=tablist]").exists()).toBe(false);
  });

  it("names the unit, the driver once (D-INV3), and FleetPal's number beside the roster's meter", () => {
    const text = page().text();
    expect(text).toContain("Truck 654");
    expect(text).toContain("2022 Volvo VNL");
    expect((text.match(/Dana Reyes/g) ?? []).length).toBe(1);
    expect(text).toContain("412,118 mi");
  });

  it("words THIS unit's reasons from the shared read — the list's sentences, not another unit's", () => {
    const card = page().find("[data-test=unit-attention]");
    expect(card.text()).toContain("A defect found on an inspection is not fixed");
    expect(card.text()).toContain("Oil Change due in 1,133 mi");
    expect(card.text()).not.toContain("Missing 9");
    // Each row links DOWN the page, to the section that answers it.
    expect(card.findAll("a[href='#section-repairs']").length).toBe(1);
    expect(card.findAll("a[href='#section-due']").length).toBe(1);
  });

  it("says so when nothing needs attention", () => {
    attention.value = [];
    expect(page().find("[data-test=unit-attention-none]").exists()).toBe(true);
  });

  it("prints the server's PM verdict, and Can't tell for a schedule nobody can judge — never OK", () => {
    const due = page().find("[data-test=unit-pm-due]");
    expect(due.text()).toContain("Oil Change");
    expect(due.text()).toContain("in 1,133 mi");
    expect(due.text()).toContain("Due soon");
    expect(due.text()).toContain("PM Reefer");
    expect(due.text()).toContain("Can't tell");
    expect(due.text()).not.toContain("OK");
    expect(due.text()).toContain("FleetPal read 412,009 mi on 10/27/2026");
  });

  it("shows the record — open orders, open defects, past work with days out — and the bill behind its bound", () => {
    const w = page();
    const repairs = w.find("[data-test=unit-repairs]");
    expect(repairs.text()).toContain("Brake job");
    expect(repairs.text()).toContain("Air leak");
    expect(repairs.text()).toContain("Steer tires");
    expect(w.find("[data-test=unit-repair-bills]").text()).toContain("at least 82% of the ledger's maintenance seen");
  });

  it("says when FleetPal has no unit linked, instead of 'nothing open'", () => {
    shopFile.value = file({ fleetpal: { unitIds: [], number: null, lastMeter: null }, openWorkOrders: [], history: [] });
    const w = page();
    expect(w.text()).toContain("FleetPal has no unit linked to this one");
    expect(w.text()).toContain("Not linked");
  });

  it("shows the annual's expiry by our record and the last report here, and Start inspection opens the drawer on THIS unit", async () => {
    const w = page();
    const annual = w.find("[data-test=unit-annual]");
    expect(annual.text()).toContain("11/01/2025");
    expect(annual.text()).toContain("Lee Park");
    expect(annual.text()).toContain("2 on file");
    await annual.find("[data-test=start-inspection]").trigger("click");
    await nextTick();
    const drawer = w.findComponent({ name: "NewInspectionDrawer" });
    expect(drawer.props()).toMatchObject({ open: true, presetType: "tractor", presetId: TRUCK });
  });
});

/** The equipment section keeps the rules it had as the whole page (INVENTORY-PLAN.md I9). */
describe("equipment it carries", () => {
  it("offers a MOVE for something on the unit, never a delete", async () => {
    const w = page();
    const actions = await rowActions(w);
    expect(actions.some((t) => /move/i.test(t))).toBe(true);
    expect(actions.some((t) => /remove|delete|take off/i.test(t))).toBe(false);
    Array.from(document.body.querySelectorAll("button")).find((b) => /move it somewhere/i.test(b.textContent ?? ""))!.click();
    await nextTick();
    expect(w.findComponent(AssetMoveDrawer).exists()).toBe(true);
  });

  it("renders the shortfall the API computed, and where each number came from", () => {
    const text = page().text();
    expect(text).toContain("Missing 2");
    expect(text).toContain("Fleet default");
    expect(text).toContain("The type's own default");
  });

  it("says a never-checked kit is what the records say, and a checked one when", () => {
    expect(page().text()).toContain("Never checked");
    unit.lastCheckedAt = "2026-10-20T12:00:00.000Z";
    expect(page().text()).toContain("Last checked 10/20/2026");
  });

  it("starts a check from the header verb, and says it is continuing when the server handed back the open one", async () => {
    openWalk.mockResolvedValueOnce({ id: "99999999-9999-4999-8999-999999999999", resumed: true, openedAt: "2026-10-19T14:00:00.000Z", startedByName: "Shop Lead" });
    const w = page();
    await w.findAll("button").find((b) => b.text() === "Check what is on board")!.trigger("click");
    await flushPromises();
    expect(openWalk).toHaveBeenCalledWith({ kind: "unit", vehicleId: TRUCK, blind: false });
    expect(useToastStore().toasts.map((t) => t.title)).toContain("Continuing the open check");
  });
});
