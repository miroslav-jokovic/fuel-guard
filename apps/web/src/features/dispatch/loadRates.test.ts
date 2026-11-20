import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { DispatchBoardRow, LoadCharges } from "@silvicom/shared";
import { LOAD_SORT_KEYS, loadColumns, loadSortValue } from "./loadListColumns";
import { BOARD_COLUMNS, BOARD_SORT_KEYS, boardSortValue, withRateColumn } from "./dispatchBoardView";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * Load rates on the screens (LOAD-RATES-PLAN D-RATE8): the columns exist only for a reader holding
 * `dispatch.load_rates` — so the column picker cannot list them for anyone else — and every cell words
 * the price one way: exact cents, "—" per mile without billed miles, a split order's leg saying so.
 */
const who = vi.hoisted(() => ({ role: "dispatcher" as string, grants: {} as Record<string, boolean> }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  return {
    useSessionStore: () => {
      const s = fakeSession(who.role as never);
      const base = s.hasPermission;
      s.hasPermission = (k) => who.grants[k] ?? base(k);
      return s;
    },
  };
});
const { default: LoadRateCell } = await import("./LoadRateCell.vue");
const { default: LoadRateFacts } = await import("./LoadRateFacts.vue");

const SPLIT: LoadCharges = { total_charge: 3620, linehaul: 3400, other_charges: 220, currency: "USD", billed_miles: 836, order_loaded_movements: 2 };
const NO_MILES: LoadCharges = { total_charge: 4580, linehaul: 4580, other_charges: 0, currency: "USD", billed_miles: null, order_loaded_movements: 1 };
const keys = (cols: { key: string }[]) => cols.map((c) => c.key);

describe("the Loads list's rate columns", () => {
  it("exist only for a holder, before Dispatch, on every tab", () => {
    expect(keys(loadColumns(false, false))).not.toContain("rate");
    expect(keys(loadColumns(true, false))).not.toContain("per_mile");
    expect(keys(loadColumns(false, true))).toEqual(["ref", "status", "driver_name", "pickup", "delivery", "type", "rate", "per_mile", "dispatch"]);
    expect(keys(loadColumns(true, true))).toEqual(["ref", "status", "driver_name", "pickup", "delivery", "delivered", "type", "rate", "per_mile", "dispatch"]);
    expect(LOAD_SORT_KEYS).toEqual(expect.arrayContaining(["rate", "per_mile"]));
  });

  it("sort by the total and by the rate per mile, a load with no price last", () => {
    const load = (charges: LoadCharges | null | undefined) => ({ stops: [], charges }) as unknown as DispatchLoad;
    expect(loadSortValue(load(SPLIT), "rate", 0)).toBe(3620);
    expect(loadSortValue(load(SPLIT), "per_mile", 0)).toBeCloseTo(4.33, 2);
    expect(loadSortValue(load(NO_MILES), "per_mile", 0)).toBeNull();
    expect(loadSortValue(load(null), "rate", 0)).toBeNull();
    expect(loadSortValue(load(undefined), "rate", 0)).toBeNull();
  });
});

describe("the Dispatch board's Rate column", () => {
  it("exists only for a holder, right after Miles left, and sorts by the current load's total", () => {
    expect(keys(withRateColumn(BOARD_COLUMNS, false))).not.toContain("rate");
    const cols = keys(withRateColumn(BOARD_COLUMNS, true));
    expect(cols[cols.indexOf("milesLeft") + 1]).toBe("rate");
    expect(withRateColumn(BOARD_COLUMNS, true).find((c) => c.key === "rate")).toMatchObject({ label: "Rate", width: "sm" });
    expect(BOARD_SORT_KEYS).toContain("rate");
    const row = (charges: LoadCharges | null | undefined) => ({ current: { charges } }) as unknown as DispatchBoardRow;
    expect(boardSortValue(row(SPLIT), "rate")).toBe(3620);
    expect(boardSortValue(row(null), "rate")).toBeNull();
    expect(boardSortValue({ current: null } as unknown as DispatchBoardRow, "rate")).toBeNull();
  });
});

describe("a rate cell", () => {
  it("prints exact cents, and says a split order's total is the order's", () => {
    const w = mount(LoadRateCell, { props: { charges: SPLIT, figure: "rate" } });
    expect(w.text()).toContain("$3,620.00");
    expect(w.text()).toContain("Order total · split over 2 trips");
  });

  it("prints the rate per mile, and a dash when McLeod billed no miles", () => {
    expect(mount(LoadRateCell, { props: { charges: SPLIT, figure: "per_mile" } }).text()).toBe("$4.33");
    expect(mount(LoadRateCell, { props: { charges: NO_MILES, figure: "per_mile" } }).text()).toBe("—");
    // The split note is the Rate's, not repeated under Per mile.
    expect(mount(LoadRateCell, { props: { charges: SPLIT, figure: "per_mile" } }).text()).not.toContain("split");
  });

  it("prints nothing for a load McLeod states no price for", () => {
    expect(mount(LoadRateCell, { props: { charges: null, figure: "rate" } }).text()).toBe("");
  });
});

describe("the Rate block on a load's page and the truck drawer", () => {
  const block = (charges: LoadCharges | null | undefined) => mount(LoadRateFacts, { props: { charges } });

  it("shows a holder total, linehaul, other charges, per mile and the split note", () => {
    who.grants = { "dispatch.load_rates": true };
    const w = block(SPLIT);
    expect(w.find('[data-testid="load-rate"]').exists()).toBe(true);
    for (const t of ["Rate", "Total", "$3,620.00", "Linehaul", "$3,400.00", "Other charges", "$220.00", "Per mile", "$4.33"]) expect(w.text()).toContain(t);
    expect(w.find('[data-testid="load-rate-split"]').text()).toBe("Order total · split over 2 trips");
  });

  it("dashes per mile without billed miles, and says when McLeod states no rate", () => {
    who.grants = { "dispatch.load_rates": true };
    expect(block(NO_MILES).text()).not.toContain("split");
    expect(block(NO_MILES).text()).toMatch(/Per mile\s*—/);
    expect(block(null).text()).toContain("McLeod states no rate for this load.");
  });

  it("draws nothing for a reader without the switch, nor for a holder whose response carried no price key", () => {
    who.grants = {};
    expect(block(SPLIT).find('[data-testid="load-rate"]').exists()).toBe(false);
    who.grants = { "dispatch.load_rates": true };
    expect(block(undefined).find('[data-testid="load-rate"]').exists()).toBe(false);
  });

  it("is the admin's without a grant", () => {
    who.role = "admin";
    who.grants = {};
    expect(block(SPLIT).find('[data-testid="load-rate"]').exists()).toBe(true);
    who.role = "dispatcher";
  });
});
