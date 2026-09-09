import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { UnitKitDto } from "@silvicom/shared";

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
  lines: [],
  ...over,
});

const units = ref<{ units: UnitKitDto[]; total: number }>({ units: [], total: 0 });
const push = vi.fn();

vi.mock("@/features/inventory/useUnits", async () => {
  const { ref: r } = await import("vue");
  return {
    useUnitsQuery: () => ({ data: units, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
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
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {}, params: {}, meta: { title: "Units" }, matched: [] }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const UnitsPage = (await import("@/pages/UnitsPage.vue")).default;
const DataTable = (await import("@/components/ui/DataTable.vue")).default;
const page = () => mount(UnitsPage, { global: { stubs: { SlideOver: true } } });

/**
 * ⚠ The row is opened through `DataTable`'s own event, not by clicking a `<tr>`. jsdom applies no
 * stylesheet and has no width, so `DataTable` renders `DataTableCards` and there are no table rows
 * at all — a `find("tbody tr")` here measures the viewport rather than the page. Recorded at I8
 * against the asset history, where the same shape read zero for a page rendering thirty.
 */
const openRow = async (w: ReturnType<typeof page>, row: UnitKitDto) => {
  const table = w.findComponent(DataTable) as unknown as { vm: { $emit: (e: string, p: unknown) => void } };
  table.vm.$emit("row-click", row);
  await w.vm.$nextTick();
};

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockClear();
  units.value = { units: [], total: 0 };
});

describe("the fleet's kit", () => {
  /**
   * ⚠ The fixture's totals DISAGREE with its lines on purpose: two lines short by one each would be
   * "2" if the page did its own arithmetic, and the DTO says 3. The screen must render the DTO.
   */
  it("renders the shortfall the API computed, not one of its own", () => {
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
    const w = page();
    expect(w.text()).toContain("3");
    expect(w.text()).toContain("Short");
  });

  it("gives a complete unit no badge at all", () => {
    units.value = { units: [unit()], total: 1 };
    const w = page();
    expect(w.text()).not.toContain("Complete");
  });

  it("says how many kinds are carried, which is the sentence a yard walk starts from", () => {
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
    expect(page().text()).toContain("1 of 2 carried");
  });

  it("says so plainly when nothing is expected of a unit yet (A4 ships empty)", () => {
    units.value = { units: [unit()], total: 1 };
    expect(page().text()).toContain("Nothing expected yet");
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
    const w = page();
    await openRow(w, units.value.units[0]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "trailer", id: REEFER } });
  });

  it("links a truck as a tractor", async () => {
    units.value = { units: [unit()], total: 1 };
    const w = page();
    await openRow(w, units.value.units[0]!);
    expect(push).toHaveBeenCalledWith({ name: "unit", params: { kind: "tractor", id: TRUCK } });
  });
});
