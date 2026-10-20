import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { answerConfirm } from "@silvicom/ui/testing";

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
  // Sold, awaiting pickup: `active` until McLeod deactivates it (D-FC0), wound down meanwhile (D-DB11).
  { id: "t4", unit_number: "T-404", status: "active", winding_down: true, assigned_driver_id: null, dot_annual_inspection_expires_at: "2027-03-01", registration_expires_at: "2027-03-01" },
]);
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: vehicles, isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
  useCreateVehicle: idle, useUpdateVehicle: idle, useRetireVehicle: () => ({ isPending: ref(false), mutateAsync: retire }), useBulkUpdateVehicles: idle,
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
/**
 * Each truck's file (UNIT-FILES-PLAN UF4). Mostly McLeod's dates as `dateOnly`, as a fleet with no
 * papers filed has; T-404's inspection is a filed paper, and T-101 has papers on file for the cell.
 */
const dated = (key: string, day: string | null, state: string) => ({
  key, group: "registration", state: "missing", goodUntil: null, fleetWide: false, documentId: null, dateOnly: day ? { goodUntil: day, state } : null,
});
const paper = (key: string, day: string, state: string, documentId: string) => ({ key, group: "inspections", state, goodUntil: day, fleetWide: false, documentId, dateOnly: null });
const unitFile = (id: string, state: string, counts: Record<string, number>, items: unknown[], papers: unknown[] = [], paperCount = 0) => ({
  subject_type: "tractor", subject_id: id, unit_number: id, status: "active", ownership: "owned", state, counts, ownership_unknown: [], attention: [], items, papers, paper_count: paperCount,
});
const thumb = (documentId: string) => ({ documentId, kind: "registration", contentType: "application/pdf", thumbUrl: `https://signed.test/${documentId}.webp`, filedAt: "2026-10-01T00:00:00Z" });
const unitFiles = ref({
  units: [
    unitFile("t1", "incomplete", { current: 0, expiring: 0, expired: 0, missing: 2 },
      [dated("annual_inspection", "2026-10-01", "expired"), dated("registration", "2027-01-01", "current")],
      [thumb("p1"), thumb("p2"), thumb("p3")], 5),
    unitFile("t2", "incomplete", { current: 0, expiring: 0, expired: 0, missing: 2 },
      [dated("annual_inspection", "2027-03-01", "current"), dated("registration", "2026-09-30", "expired")]),
    unitFile("t3", "not_started", { current: 0, expiring: 0, expired: 0, missing: 2 }, [dated("annual_inspection", null, ""), dated("registration", null, "")]),
    unitFile("t4", "complete", { current: 1, expiring: 1, expired: 0, missing: 0 },
      [paper("annual_inspection", "2027-03-01", "current", "p9"), paper("registration", "2026-10-20", "expiring", "p8")]),
  ],
});
vi.mock("@/composables/useCompliance", () => ({ useUnitFilesQuery: () => ({ data: unitFiles }), useDocumentsQuery: () => ({ data: ref([]) }) }));
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
const TruckPapersWidget = (await import("@/features/roster/TruckPapersWidget.vue")).default;

async function mountAt(at: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
  await router.push(at);
  await router.isReady();
  const w = mount(VehiclesPage, { global: { plugins: [VueQueryPlugin, router], stubs: { RouterLink: RouterLinkStub } } });
  return { w, router };
}
const units = (w: Awaited<ReturnType<typeof mountAt>>["w"]) =>
  ["T-101", "T-202", "T-303", "T-404"].filter((u) => w.text().includes(u));

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
    expect(units((await mountAt("/vehicles")).w)).toEqual(["T-101", "T-202", "T-404"]);
  });

  it("narrows to the trucks a check names", async () => {
    expect(units((await mountAt("/vehicles?check=no_driver")).w)).toEqual(["T-202"]);
    expect(units((await mountAt("/vehicles?check=inspection_overdue")).w)).toEqual(["T-101"]);
    expect(units((await mountAt("/vehicles?check=registration_overdue")).w)).toEqual(["T-202"]);
  });

  it("keeps a truck being wound down out of 'no driver' and lists it behind its own door", async () => {
    expect(units((await mountAt("/vehicles?check=no_driver")).w)).not.toContain("T-404");
    expect(units((await mountAt("/vehicles?check=winding_down")).w)).toEqual(["T-404"]);
  });

  it("opens on a status the link names, and reads `any` as every status", async () => {
    expect(units((await mountAt("/vehicles?status=ordered")).w)).toEqual(["T-303"]);
    expect(units((await mountAt("/vehicles?status=any")).w)).toEqual(["T-101", "T-202", "T-303", "T-404"]);
  });

  it("ignores a check it does not know, rather than emptying the fleet", async () => {
    expect(units((await mountAt("/vehicles?check=banana")).w)).toEqual(["T-101", "T-202", "T-404"]);
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

describe("the File column (UNIT-FILES-PLAN UF4)", () => {
  it("draws each truck's chip, worst state first, its thumbnails and the +N past them", async () => {
    const { w } = await mountAt("/vehicles");
    const chips = w.findAll("[data-test='file-chip']").map((c) => c.text());
    // T-101: two items with McLeod's dates only; T-202 the same; T-404 one paper inside the window.
    expect(chips).toEqual(["2 date only", "2 date only", "1 expiring"]);
    expect(w.findAll("[data-test='file-thumb']")).toHaveLength(3);
    expect(w.get("[data-test='file-more']").text()).toBe("+2");
  });

  it("sets ?file= when a chip is clicked, and lists exactly the trucks whose chip says so", async () => {
    const { w, router } = await mountAt("/vehicles");
    await w.findAll("[data-test='file-chip']")[2]!.trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ file: "expiring" }));
    await flushPromises();
    expect(units(w)).toEqual(["T-404"]);
    expect(units((await mountAt("/vehicles?file=date_only")).w)).toEqual(["T-101", "T-202"]);
  });

  it("shows each paper's standing in the paper columns — the paper's date, else McLeod's marked date only", async () => {
    const { w } = await mountAt("/vehicles");
    const text = w.text();
    expect(text).toContain("Overdue by 11 days"); // T-101's inspection, McLeod's 10/01
    expect(text).toContain("Due in 8 days"); // T-404's filed registration, 10/20
    expect(w.findAll("span").filter((s) => s.text() === "date only")).toHaveLength(4);
  });

  // One function, two readers (D-FM7): the card counts with `matchesVehicleCheck` over each truck's
  // file, and the page lists with it behind the card's door.
  it("counts on the Truck paperwork card exactly the trucks its door lists", async () => {
    const card = mount(TruckPapersWidget, { global: { plugins: [VueQueryPlugin], stubs: { RouterLink: RouterLinkStub } } });
    await flushPromises();
    const checks = ["inspection_overdue", "inspection_due", "inspection_date_only", "inspection_missing", "registration_overdue", "registration_due", "registration_date_only", "registration_missing"];
    for (const check of checks) {
      const listed = units((await mountAt(`/vehicles?check=${check}`)).w);
      expect(card.get(`[data-test='count-${check}']`).text(), check).toBe(String(listed.length));
    }
  });
});
