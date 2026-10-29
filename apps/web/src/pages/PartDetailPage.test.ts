import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { PartDto } from "@silvicom/shared";

/**
 * One part's summary card (D-US6): the facts are a `FactList`, so each label sits beside its value and
 * a blank is the list's em dash. The shelves and the ledger have their own drawers' suites.
 */
const part = (over: Partial<PartDto> = {}): PartDto => ({
  id: "22222222-2222-4222-8222-222222222222",
  partNumber: "P-100",
  description: "Oil filter",
  manufacturer: "Fleetguard",
  category: null,
  unitOfMeasure: "each",
  upc: "0123456789",
  imagePath: null,
  lastCost: null,
  active: true,
  notes: null,
  ...over,
} as PartDto);

const detail = ref<{ part: PartDto; stock: unknown[]; photoUrl: string | null }>({ part: part(), stock: [], photoUrl: null });

vi.mock("@/features/inventory/useInventory", async (importOriginal) => {
  const { ref: r } = await import("vue");
  return {
    ...(await importOriginal<object>()),
    usePartQuery: () => ({ data: detail, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    useLocationsQuery: () => ({ data: r([]) }),
    useMovementsQuery: () => ({ data: r({ movements: [], total: 0 }), isLoading: r(false), isError: r(false), refetch: vi.fn() }),
    useAttachPartPhoto: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  // `meta: {}`: PageHeader asks the route whether a page backdrop is behind it (D-DT18).
  useRoute: () => ({ params: { id: "22222222-2222-4222-8222-222222222222" }, meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

const PartDetailPage = (await import("@/pages/PartDetailPage.vue")).default;
const page = () =>
  mount(PartDetailPage, {
    global: { stubs: { PartDrawer: true, StockLineDrawer: true, MovementDrawer: true, FileDropzone: true, DataTable: true, RouterLink: true } },
  });
const pairs = (w: ReturnType<typeof page>) =>
  Object.fromEntries(w.get("dl").findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()]));

beforeEach(() => {
  setActivePinia(createPinia());
  detail.value = { part: part(), stock: [], photoUrl: null };
});

describe("PartDetailPage — the summary's facts", () => {
  it("pairs each fact with its label, and draws a dash for a category nobody set", () => {
    expect(pairs(page())).toEqual({
      Manufacturer: "Fleetguard",
      Category: "—",
      "Counted in": "Each",
      Barcode: "0123456789",
    });
  });

  it("adds the notes as one more fact only when there are any", () => {
    detail.value = { part: part({ notes: "Fits the 2019 Cascadias" }), stock: [], photoUrl: null };
    expect(pairs(page()).Notes).toBe("Fits the 2019 Cascadias");
  });
});

/** M8 (§7a.5): FleetPal owns a synced part's fields, and shelf counting is hidden (Q-MX8). */
describe("a FleetPal part", () => {
  it("offers no Edit part for a FleetPal part, and keeps it for a hand-typed one", () => {
    detail.value = { part: part({ fleetpalId: "fp-1" }), stock: [], photoUrl: null };
    const synced = page();
    expect(synced.text()).not.toContain("Edit part");
    expect(pairs(synced)["Comes from"]).toBe("FleetPal");
    detail.value = { part: part(), stock: [], photoUrl: null };
    expect(page().text()).toContain("Edit part");
  });

  it("shows no Shelves or History while shelf counting is hidden", () => {
    const text = page().text();
    expect(text).not.toContain("Shelves");
    expect(text).not.toContain("History");
  });
});
