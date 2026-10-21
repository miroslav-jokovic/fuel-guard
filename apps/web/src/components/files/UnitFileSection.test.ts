import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import UnitFileSection from "@/components/files/UnitFileSection.vue";
import RequirementTable from "@/components/files/RequirementTable.vue";

/**
 * One truck's file as a section of its page (UNIT-FILES-PLAN UF5, D-UF1). What is pinned: the rows
 * are the ROLLUP's items with the catalogue's words, a date-only item and a fleet-covered item say
 * so (D-UF3, D-UF6), unknown ownership is asked here and answered here (D-UF11), the relations are
 * read from where they live with the lists' own chips (D-UF2), and a reader without `equipment:
 * manage` sees the file and none of the controls (D-UF5).
 */
const T1 = "00000000-0000-4000-8000-0000000000a1";
const unitRow = {
  subject_type: "tractor", subject_id: T1, unit_number: "654", status: "active", ownership: null,
  state: "incomplete", counts: { current: 2, expiring: 0, expired: 0, missing: 1 },
  ownership_unknown: ["title", "lease"], attention: [],
  items: [
    { key: "registration", group: "registration", state: "current", goodUntil: "2027-03-31", evidenceDate: "2026-03-01", expiryUnknown: false, dateOnly: null, paperOnFile: null, fleetWide: false, documentId: "reg1" },
    { key: "annual_inspection", group: "inspections", state: "missing", goodUntil: null, evidenceDate: null, expiryUnknown: false, dateOnly: { goodUntil: "2026-11-01", state: "expiring" }, paperOnFile: null as { documentId: string; datedAt: string } | null, fleetWide: false, documentId: null },
    { key: "insurance", group: "insurance", state: "current", goodUntil: "2027-01-01", evidenceDate: null, expiryUnknown: false, dateOnly: null, paperOnFile: null, fleetWide: true, documentId: "pol" },
  ],
  papers: [], paper_count: 1,
};
const trailerRow = { ...unitRow, subject_type: "trailer", subject_id: "t1", unit_number: "5302", items: [], ownership_unknown: [], state: "incomplete", counts: { current: 1, expiring: 0, expired: 1, missing: 0 } };
const q = <T,>(data: T) => ({ data: ref(data), isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() });

const setVehicleOwnership = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => undefined), isPending: { value: false } }));
vi.mock("@/composables/useCompliance", () => ({
  useUnitFilesQuery: (type: string) => q({ units: [type === "tractor" ? unitRow : trailerRow] }),
  useDocumentsQuery: () => q([{ id: "reg1", kind: "registration", contentType: "application/pdf", url: "https://signed.test/reg1.pdf", thumbUrl: null }]),
  useComplianceOverviewQuery: () => q({ drivers: [{ driver_id: "d1", state: "incomplete", counts: { current: 3, expiring: 1, expired: 0, missing: 0 }, attention: [], requirements: [] }] }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => q([{ id: T1, unit_number: "654", assigned_driver_id: "d1", ownership_type: null }]),
  useSetVehicleOwnership: () => setVehicleOwnership,
}));
vi.mock("@/composables/useTrailers", () => ({
  useTrailersQuery: () => q([{ id: "t1", unit_number: "5302", assigned_vehicle_id: null, ownership_type: null }]),
  useSetTrailerOwnership: () => ({ mutateAsync: vi.fn(), isPending: { value: false } }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => q([{ id: "d1", full_name: "Marcus Reyes" }]) }));
vi.mock("@/composables/useTrailerLink", () => ({
  useTrailersOnLoadsQuery: () => {
    const data = ref([{ trailerId: "t1", vehicleId: T1, loadId: "l1", ref: "123" }]);
    return { data, byTrailerId: computed(() => new Map(data.value.map((t) => [t.trailerId, t]))) };
  },
}));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const STUBS = { DocumentDropCard: true, CertificationHistory: true, RequirementDrawer: true, DocumentPreview: true };
async function mountSection() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["/vehicles/:id", "/trailers/:id", "/drivers/:id"].map((path) => ({ path, component: { template: "<div/>" } })),
  });
  await router.push(`/vehicles/${T1}`);
  await router.isReady();
  const w = mount(UnitFileSection, {
    props: { subject: { type: "tractor", id: T1 }, unitNumber: "654", plate: "P 123" },
    global: { plugins: [router, VueQueryPlugin], stubs: STUBS },
  });
  await flushPromises();
  return w;
}
const session = async () => (await import("@/stores/session")) as unknown as { __session: import("@/testing/fakeSession").FakeSession };

describe("UnitFileSection", () => {
  beforeEach(async () => {
    (await session()).__session.role = "admin";
    setVehicleOwnership.mutateAsync.mockClear();
  });

  it("draws the rollup's items with the catalogue's words, and says what a date-only or fleet-covered item is", async () => {
    const w = await mountSection();
    // Attention first: the missing inspection, with McLeod's date beside it (D-UF3) — not the fine registration.
    expect(w.text()).toContain("Annual inspection");
    expect(w.text()).toContain("Date only, no paper — McLeod says 11/01/2026");
    expect(w.text()).not.toContain("Registration / IRP cab card");

    await w.findAll("button").find((b) => b.text().startsWith("Show all"))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Registration / IRP cab card");
    expect(w.text()).toContain("Covered by the fleet's paper");
    // A unit's file has no stamped release — D-BD10 stamps a driver.
    expect(w.findComponent(RequirementTable).props("releasable")).toBe(false);
  });

  // Q-UF13: the McLeod import filed the scan and no certification. The row says so, and recording the
  // item opens the drawer CITING that scan — the office types the date and uploads nothing.
  it("says a scanned paper is on file but not dated, and records the date against that paper", async () => {
    const annual = unitRow.items[1]!;
    annual.paperOnFile = { documentId: "ann1", datedAt: "2026-07-27" };
    try {
      const w = await mountSection();
      expect(w.text()).toContain("Paper on file, not dated — McLeod says 11/01/2026");
      expect(w.text()).not.toContain("Date only, no paper");
      w.findComponent(RequirementTable).vm.$emit("open", "annual_inspection");
      await flushPromises();
      const drawer = w.findComponent({ name: "RequirementDrawer" });
      expect(drawer.props("itemKey")).toBe("annual_inspection");
      expect(drawer.props("presetDocument")).toEqual({ id: "ann1", name: "The paper dated 07/27/2026" });
    } finally {
      annual.paperOnFile = null;
    }
  });

  it("asks for ownership where it is unknown, and sets it from the section (D-UF11)", async () => {
    const w = await mountSection();
    const callout = w.find("[data-test=ownership-unknown]");
    expect(callout.text()).toContain("Title, Lease agreement");
    callout.findComponent({ name: "AppSelect" }).vm.$emit("update:modelValue", "owned");
    await flushPromises();
    await callout.findAll("button").find((b) => b.text() === "Set ownership")!.trigger("click");
    await flushPromises();
    expect(setVehicleOwnership.mutateAsync).toHaveBeenCalledWith({ id: T1, ownership: "owned" });
  });

  it("shows the seated driver and the trailer on the load with their files' chips, each linking to the other file (D-UF2)", async () => {
    const w = await mountSection();
    const strip = w.find("[data-test=unit-relations]");
    expect(strip.text()).toContain("Marcus Reyes");
    expect(strip.text()).toContain("1 expiring");
    expect(strip.text()).toContain("Trailer 5302");
    expect(strip.text()).toContain("1 expired");
    expect(strip.find('a[href="/drivers/d1?section=qualification"]').exists()).toBe(true);
    expect(strip.find('a[href="/trailers/t1?section=file"]').exists()).toBe(true);
  });

  it("offers no drop zone and no ownership control to a reader who cannot manage equipment (D-UF5)", async () => {
    (await session()).__session.role = "dispatcher";
    const w = await mountSection();
    expect(w.findComponent({ name: "DocumentDropCard" }).exists()).toBe(false);
    expect(w.find("[data-test=ownership-unknown]").exists()).toBe(true);
    expect(w.findAll("button").some((b) => b.text() === "Set ownership")).toBe(false);
    expect(w.findComponent(RequirementTable).props("canManage")).toBe(false);
  });
});
