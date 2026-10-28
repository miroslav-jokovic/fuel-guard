import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { UnitKitDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * The units list and one unit's page (INVENTORY-PLAN.md I9).
 *
 * ── WHAT THESE SCREENS CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ────────────────────────────
 *
 *   1. **Recomputing the kit.** I9's done-when is that kit status comes from ONE shared function on
 *      api and web. The API runs `deriveKitStatus` and sends its answer; a page that derived its own
 *      "short by" from the lines would look right on every fixture and disagree with the API the day
 *      the rule changes. So the assertions below feed a DTO whose totals do not match its lines, and
 *      require the screen to render the DTO's.
 *   2. **Counting lines instead of things.** A trailer missing two straps and a chain is short by
 *      three, not two. That is the number somebody loads into a truck before driving to the yard.
 *   3. **`complete` must not wear a badge.** A pill on every row means nothing, and the coloured
 *      rows are the walk to make.
 *   4. **The URL carries the ROSTER's kind.** A reefer is a `trailer` as far as the fleet tables are
 *      concerned, and a link that sent `reefer_trailer` would 400 at the API.
 */

const TRUCK = "11111111-1111-4111-8111-111111111111";
const REEFER = "33333333-3333-4333-8333-333333333333";
const BAR = "55555555-5555-4555-8555-555555555555";

const unit = (over: Partial<UnitKitDto> = {}): UnitKitDto => ({
  kind: "tractor",
  unitId: TRUCK,
  unitNumber: "654",
  inferredDriverName: "Dana Reyes",
  state: "complete",
  shortBy: 0,
  extraBy: 0,
  lastCheckedAt: null,
  lines: [],
  ...over,
});

const units = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
/** The filter the page last handed `useUnitsQuery` — what it asked the server. */
let unitsFilter: { value: Record<string, unknown> } | null = null;

vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitsQuery: (f: { value: Record<string, unknown> }) => {
      unitsFilter = f;
      return { data: units, isLoading: r(false), isError: r(false), refetch: vi.fn() };
    },
    useKitExpectationsQuery: () => ({ data: r([]) }),
    useSetKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useDeleteKitExpectation: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return { useAssetTypesQuery: () => ({ data: r([]) }) };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));

const UnitsPage = (await import("@/pages/UnitsPage.vue")).default;
const DataTable = (await import("@silvicom/ui")).DataTable;
const FilterSelect = (await import("@/components/ui/FilterSelect.vue")).default;

/**
 * A REAL router over the app's own route table (D-US2): the list keeps its filters, sort and page in
 * the URL through `useQueryState`, which awaits `router.replace`, and the row link resolves the
 * app's `unit` route by name. `push` is spied on so opening a row does not load the unit's page.
 */
let router: Router;
let push: ReturnType<typeof vi.fn>;
async function page(url = "/shop/units") {
  router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push(url);
  await router.isReady();
  push = vi.fn().mockResolvedValue(undefined);
  router.push = push as unknown as Router["push"];
  const w = mount(UnitsPage, { global: { plugins: [router], stubs: { SlideOver: true } } });
  await flushPromises();
  return w;
}
const urlQuery = () => router.currentRoute.value.query;
type Mounted = Awaited<ReturnType<typeof page>>;

/**
 * ⚠ The row is opened through `DataTable`'s own event, not by clicking a `<tr>`. jsdom applies no
 * stylesheet and has no width, so `DataTable` renders `DataTableCards` and there are no table rows
 * at all — a `find("tbody tr")` here measures the viewport rather than the page. Recorded at I8
 * against the asset history, where the same shape read zero for a page rendering thirty.
 */
const openRow = async (w: Mounted, row: UnitKitDto) => {
  const table = w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } };
  table.vm.$emit("row-click", row);
  await w.vm.$nextTick();
};

beforeEach(() => {
  setActivePinia(createPinia());
  units.value = { units: [], total: 0 };
});

describe("the fleet's kit", () => {
  /**
   * ⚠ The fixture's totals DISAGREE with its lines on purpose: two lines short by one each would be
   * "2" if the page did its own arithmetic, and the DTO says 3. The screen must render the DTO.
   */
  it("renders the shortfall the API computed, not one of its own", async () => {
    units.value = {
      units: [
        unit({
          state: "short",
          shortBy: 3,
          lines: [
            { assetTypeId: BAR, assetTypeName: "Load bar", expected: 2, held: 1, delta: -1, source: "fleet" },
            { assetTypeId: "t2", assetTypeName: "Tablet", expected: 1, held: 0, delta: -1, source: "type" },
          ],
        }),
      ],
      total: 1,
    };
    const w = await page();
    expect(w.text()).toContain("3");
    expect(w.text()).toContain("Missing equipment");
  });

  it("gives a complete unit no badge at all", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    expect(w.text()).not.toContain("Complete");
  });

  it("says how many kinds are carried, which is the sentence a yard walk starts from", async () => {
    units.value = {
      units: [
        unit({
          state: "short",
          shortBy: 1,
          lines: [
            { assetTypeId: BAR, assetTypeName: "Load bar", expected: 2, held: 2, delta: 0, source: "fleet" },
            { assetTypeId: "t2", assetTypeName: "Tablet", expected: 1, held: 0, delta: -1, source: "type" },
          ],
        }),
      ],
      total: 1,
    };
    expect((await page()).text()).toContain("1 of 2 carried");
  });

  it("says so plainly when nothing is expected of a unit yet (A4 ships empty)", async () => {
    units.value = { units: [unit()], total: 1 };
    expect((await page()).text()).toContain("Nothing set up yet");
  });

  /**
   * `FilterSelect` reads any non-empty value as a filter in force and draws a ✕ for it. The page
   * shipped resting on `"all"`, so both chips opened blue with a ✕ that cleared them to a value
   * neither option list had (2026-09-10, measured in a render). The resting value is `""`.
   */
  it("opens with no filter applied", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    const clears = w.findAll("button").filter((b) => (b.attributes("aria-label") ?? "").startsWith("Clear "));
    expect(clears).toHaveLength(0);
  });

  it("offers Clear filters once a filter is set, and clearing puts the kind back to everything", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    const kind = () => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Kind")!;
    const clearButton = () => w.findAll("button").find((b) => b.text() === "Clear filters");
    expect(clearButton()).toBeUndefined();
    kind().vm.$emit("update:modelValue", "tractor");
    await w.vm.$nextTick();
    await clearButton()!.trigger("click");
    await flushPromises();
    expect(kind().props("modelValue")).toBe("");
    expect(clearButton()).toBeUndefined();
  });

  /** The fleet arrives whole, so the page may filter it — a client search over a complete list is honest. */
  it("finds a unit by number, and says so when none matches", async () => {
    units.value = { units: [unit(), unit({ unitId: REEFER, unitNumber: "R-8800", kind: "reefer_trailer" })], total: 2 };
    const w = await page();
    vi.useFakeTimers();
    try {
      // The search field debounces its model by 250 ms, so the clock is driven by hand.
      const type = async (value: string) => {
        await w.find("input[type='search'], input[type='text']").setValue(value);
        vi.advanceTimersByTime(300);
        await w.vm.$nextTick();
      };
      await type("R-88");
      expect(w.text()).toContain("R-8800");
      expect(w.text()).not.toContain("654");
      expect(w.text()).toContain("1 truck or trailer");
      await type("zzz");
      expect(w.text()).toContain("No truck or trailer number matches that.");
    } finally {
      vi.useRealTimers();
    }
  });

  /** The fleet arrives whole, so the page pages it itself — twenty at a time, like the roster lists. */
  it("pages the fleet twenty at a time and counts the whole of it in the toolbar", async () => {
    units.value = {
      units: Array.from({ length: 25 }, (_, i) => unit({ unitId: `u${i}`, unitNumber: `T-${String(i).padStart(3, "0")}` })),
      total: 25,
    };
    const w = await page();
    expect(w.text()).toContain("25 trucks and trailers");
    expect(w.text()).toContain("T-019");
    expect(w.text()).not.toContain("T-020");
    expect(w.text()).toContain("Showing 1–20 of 25");
  });

  it("names its one header action, and gives every row a menu", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    expect(w.text()).toContain("What each truck should carry");
    // The menu's items render only once it is open; the trigger is what proves the path exists.
    expect(w.find('button[aria-label="Actions"]').exists()).toBe(true);
  });

  /**
   * A reefer's KIT kind is `reefer_trailer`; the table it lives in is `trailers`. The link carries
   * the roster's word, and a link that sent the kit kind would 400 at the API.
   */
  it("links a reefer by the roster's kind, not by its kit kind", async () => {
    units.value = {
      units: [unit({ kind: "reefer_trailer", unitId: REEFER, unitNumber: "R-8800", inferredDriverName: null })],
      total: 1,
    };
    const w = await page();
    await openRow(w, units.value.units[0]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "trailer", id: REEFER } });
  });

  it("links a truck as a tractor", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    await openRow(w, units.value.units[0]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "tractor", id: TRUCK } });
  });
});

/** D-US2: the list's filters, sort and page are the URL, so reload, a pasted link and Back keep them. */
describe("the list in the URL (D-US2)", () => {
  const fleet = () =>
    Array.from({ length: 25 }, (_, i) =>
      unit({ unitId: `u${i}`, unitNumber: `T-${String(i).padStart(3, "0")}`, shortBy: i % 3 }),
    );

  it("lands the shop home's ?kit=short link on the shortfall filter, which stays in the URL", async () => {
    units.value = { units: [unit({ state: "short", shortBy: 1 })], total: 1 };
    const w = await page("/shop/units?kit=short");
    const kit = w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Equipment")!;
    expect(kit.props("modelValue")).toBe("short");
    expect(urlQuery()).toEqual({ kit: "short" });
  });

  /** R10: the shop home's tile counts only checked units, and lands on that same list. */
  it("lands the home tile's ?kit=short-checked link on short units somebody has checked", async () => {
    units.value = { units: [unit({ state: "short", shortBy: 1, lastCheckedAt: "2026-10-20T12:00:00.000Z" })], total: 1 };
    const w = await page("/shop/units?kit=short-checked");
    expect(unitsFilter!.value).toMatchObject({ shortOnly: true, checkedOnly: true });
    expect(w.text()).toContain("10/20/2026");
  });

  it("says Never for a unit nobody has checked", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = await page();
    expect(unitsFilter!.value).toMatchObject({ shortOnly: false, checkedOnly: false });
    expect(w.text()).toContain("Never");
  });

  it("reads the sort and the page back from a pasted link", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?sort=unitNumber&dir=desc&page=2");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: "unitNumber", dir: "desc" });
    expect(w.text()).toContain("Showing 21–25 of 25");
    expect(w.text()).toContain("T-000");
    expect(w.text()).not.toContain("T-024");
  });

  it("writes a filter and a header click to the URL, and a re-sort returns to page 1", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?page=2");
    w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Kind")!.vm.$emit("update:modelValue", "tractor");
    await flushPromises();
    w.findComponent({ name: "DataTable" }).vm.$emit("sort", "shortBy");
    await flushPromises();
    expect(urlQuery()).toEqual({ kind: "tractor", sort: "shortBy", dir: "asc" });
  });

  it("Clear filters keeps the sort", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?kit=short&kind=trailer&search=T-&sort=shortBy&dir=desc");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(urlQuery()).toEqual({ sort: "shortBy", dir: "desc" });
  });

  it("reads a kind or a sort column it does not have as none", async () => {
    units.value = { units: fleet(), total: 25 };
    const w = await page("/shop/units?kind=reefer_trailer&sort=partNumber");
    expect(w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Kind")!.props("modelValue")).toBe("");
    expect(w.findComponent({ name: "DataTable" }).props("sort")).toEqual({ key: null, dir: "asc" });
  });
});
