import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AssetDto, AssetMovementDto } from "@silvicom/shared";

/**
 * One asset's page (INVENTORY-PLAN.md I8).
 *
 * ── WHAT THIS SCREEN CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ──────────────────────────────
 *
 *   1. **The history has to actually render at length.** The step's done-when is thirty movements,
 *      and the two renders — a rail on a phone, a table on a desk — read the SAME page of data. A
 *      screen that silently truncated one of them would look right in a screenshot of the other.
 *   2. **A report must not read as a move.** `reported_missing` leaves the holder exactly where it
 *      was (D-INV24), so the row must not say it went anywhere — the one thing a reader scanning a
 *      missing tablet's history is trying to establish.
 *   3. **The driver is shown and never stored** (D-INV3), and comes from the holder the API
 *      assembled rather than from any column on this page.
 *   4. **`in_service` gets no badge.** Nearly every asset is in service; a pill on every row means
 *      nothing, and the coloured ones are the exceptions worth walking over to.
 */

const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const CRIB = "11111111-1111-4111-8111-111111111111";
const VEHICLE = "44444444-4444-4444-8444-444444444444";

const asset = (over: Partial<AssetDto> = {}): AssetDto => ({
  id: ASSET_ID,
  tagCode: null,
  displayNo: "A-0412",
  assetTypeId: "33333333-3333-4333-8333-333333333333",
  assetTypeName: "Tablet",
  name: "Cab tablet",
  serialNumber: "SN-1",
  model: "Tab A8",
  manufacturer: "Samsung",
  status: "in_service",
  condition: "good",
  holder: {
    kind: "vehicle",
    id: VEHICLE,
    label: "654",
    inferredDriverName: "Dana Reyes",
    since: "2026-01-04T08:00:00.000Z",
  },
  purchasedAt: "2025-11-02",
  purchaseCost: 429,
  warrantyExpiresAt: null,
  imagePath: null,
  notes: null,
  ...over,
});

const movement = (i: number, over: Partial<AssetMovementDto> = {}): AssetMovementDto => ({
  id: `mm-${i}`,
  assetId: ASSET_ID,
  reason: "assigned",
  fromHolder: { kind: "location", id: CRIB, label: null, inferredDriverName: null, since: null },
  toHolder: { kind: "vehicle", id: VEHICLE, label: null, inferredDriverName: null, since: null },
  condition: null,
  note: null,
  actorUserId: "u-1",
  actorName: "Shop Lead",
  actorDriverId: null,
  countSessionId: null,
  // Spread across three days, so the rail's sticky headers have something to group.
  occurredAt: new Date(Date.UTC(2026, 8, 1 + (i % 3), 9, i % 60)).toISOString(),
  receivedAt: "2026-09-09T10:00:01.000Z",
  ...over,
});

const detail = ref<{ asset: AssetDto; photoUrl: string | null }>({ asset: asset(), photoUrl: null });
const history = ref<{ movements: AssetMovementDto[]; total: number }>({ movements: [], total: 0 });

vi.mock("@/features/inventory/useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    ASSETS_PAGE_SIZE: 50,
    useAssetQuery: () => ({ data: detail, isError: r(false), error: r(null), refetch: vi.fn() }),
    useAssetMovementsQuery: () => ({ data: history, isLoading: r(false), isError: r(false), refetch: vi.fn() }),
    useAttachAssetPhoto: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    // The drawers this page owns are mounted with it, so their hooks have to exist. They are not
    // what this file is about — `AssetMoveDrawer.test.ts` drives them directly.
    useCreateAsset: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useUpdateAsset: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useAssetTypesQuery: () => ({ data: r([]) }),
    useMoveAsset: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/features/inventory/useInventory", async () => {
  const { ref: r } = await import("vue");
  return {
    useLocationsQuery: () => ({ data: r([{ id: CRIB, name: "Tool crib", code: "CRIB", address: null, active: true }]) }),
  };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true }) }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: ASSET_ID } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const AssetDetailPage = (await import("@/pages/AssetDetailPage.vue")).default;
/**
 * ⚠ Both reads are in the DOM at once here, and that is jsdom rather than a defect: `lg:hidden` and
 * `hidden lg:block` are CSS, and jsdom applies no stylesheet. So every count below is scoped to the
 * component it is about — a bare `findAll("li")` returns the rail's rows AND `DataTableCards`', and
 * would have read 60 for a page rendering thirty.
 */
const TimelineRail = (await import("@/components/ui/TimelineRail.vue")).default;
const DataTable = (await import("@/components/ui/DataTable.vue")).default;
const page = () => mount(AssetDetailPage, { global: { stubs: { SlideOver: true, FileDropzone: true } } });

beforeEach(() => {
  setActivePinia(createPinia());
  detail.value = { asset: asset(), photoUrl: null };
  history.value = { movements: [], total: 0 };
});

describe("the history", () => {
  it("renders thirty movements in both reads, from one page of data", () => {
    const rows = Array.from({ length: 30 }, (_, i) => movement(i));
    history.value = { movements: rows, total: 30 };
    const w = page();

    // The rail: one <li> per movement.
    expect(w.findComponent(TimelineRail).findAll("li")).toHaveLength(30);
    // The table: asserted on the rows it was HANDED, not on `<tr>` elements. `DataTable` swaps to
    // `DataTableCards` below 768 px and jsdom has no width, so counting table rows would measure the
    // viewport rather than the page — and would read zero for a page rendering thirty.
    const table = w.findComponent(DataTable) as unknown as { props: (k: string) => unknown[] };
    expect(table.props("rows")).toHaveLength(30);
    expect(w.text()).toContain("Shop Lead");
  });

  it("groups the rail by day, because a walk through a history needs to know when", () => {
    history.value = { movements: Array.from({ length: 9 }, (_, i) => movement(i)), total: 9 };
    const w = page();
    // Three distinct days in the fixture — asserted as a COUNT of headers, so a component that
    // emitted one header per row would fail rather than look tidy.
    const headers = w.findComponent(TimelineRail).findAll("p.sticky");
    expect(headers).toHaveLength(3);
  });

  /**
   * The assertion the reason vocabulary exists for. A report leaves the holder alone (D-INV24), so
   * its row must not claim a destination — and the fixture pairs it with a real move so the test
   * can tell the two apart rather than passing against a page that says "nothing moved" for both.
   */
  it("says a report moved nothing, while a move says where it went", () => {
    history.value = {
      movements: [
        movement(0, { id: "mm-move", reason: "transferred" }),
        movement(1, { id: "mm-report", reason: "reported_missing", toHolder: null }),
      ],
      total: 2,
    };
    const w = page();
    expect(w.text()).toContain("Reported missing");
    expect(w.text()).toContain("— nothing moved");
    expect(w.text()).toContain("to a truck");
  });

  it("says nothing has happened yet rather than rendering an empty rail", () => {
    const w = page();
    expect(w.text()).toContain("Nothing has happened to it yet");
    // An empty rail is furniture that reports a finding, so `TimelineRail` renders nothing at all and
    // the page says the sentence itself.
    expect(w.findComponent(TimelineRail).exists()).toBe(false);
  });
});

describe("what the header says about the thing", () => {
  it("shows the holder, since when, and the driver the roster has right now", () => {
    const w = page();
    expect(w.text()).toContain("654");
    expect(w.text()).toContain("with Dana Reyes");
    // D-INV3: inferred at read time and stored nowhere — the page never sees a driver column.
    expect(w.text()).not.toContain("assigned_driver_id");
  });

  it("gives an in-service asset no status badge, and a lost one a badge", () => {
    expect(page().text()).not.toContain("In service");
    detail.value = { asset: asset({ status: "lost" }), photoUrl: null };
    expect(page().text()).toContain("Lost");
  });

  it("says out loud what retiring did, because nothing can be recorded against it afterwards", () => {
    detail.value = { asset: asset({ status: "retired" }), photoUrl: null };
    expect(page().text()).toContain("Off the fleet");
  });
});
