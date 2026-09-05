import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref, computed } from "vue";

/**
 * FUEL-P1 / D-FUI16 — the truck menu, and where its options come from.
 *
 * ── WHY THIS SUITE EXISTS ───────────────────────────────────────────────────────────────────────
 * The Unit menu was built from `vehicles.unit_number`, so a unit EFS printed that the fleet has no row
 * for could not be selected while its lines sat in the list. Measured in production 2026-09-04: four
 * such units — **696 (43 lines), T005 (6), T001 (5), T004 (2)** — 56 visible, unselectable lines. The
 * fix is a union, and a union has two ways to go quietly wrong: dropping the feed's own units (the
 * original defect, restored) or dropping the fleet's (a truck with no EFS line yet — a new truck —
 * becoming unfilterable, which would be the same defect pointed the other way).
 *
 * The label is asserted too. A unit that is not in the fleet is offered because its ROWS exist, and on
 * the Fills tab it correctly matches nothing; saying so in the option is the difference between a
 * reader concluding the roster is incomplete and concluding the fills are missing.
 */

const facetRows = ref<{ facet: string; value: string; label: string | null }[] | null>(null);
const declineFacetRows = ref<{ facet: string; value: string; label: string | null }[] | null>(null);
const rpcCalls: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (fn: string) => {
      rpcCalls.push(fn);
      const data = fn === "efs_transaction_facets" ? facetRows.value : declineFacetRows.value;
      return Promise.resolve({ data, error: null });
    },
  },
}));

const fleet = ref<{ id: string; unit_number: string }[]>([]);
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: fleet }) }));

import { useUnitOptions, useVehicleIdsForUnits } from "./unitFilter";
import { useEfsFacets } from "./useEfsData";

/** Mount a host that just reads the composable, and hand back what it saw. */
async function read<T>(fn: () => T): Promise<T> {
  let out!: T;
  const Host = defineComponent({
    setup() {
      const v = fn();
      return () => {
        out = v;
        return null;
      };
    },
  });
  const host = mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  host.unmount();
  return out;
}

beforeEach(() => {
  rpcCalls.length = 0;
  fleet.value = [
    { id: "v-654", unit_number: "654" },
    { id: "v-101", unit_number: "101" },
  ];
  facetRows.value = [
    { facet: "unit", value: "654", label: null },
    { facet: "unit", value: "696", label: null },
    { facet: "item", value: "ULSD", label: null },
    { facet: "state", value: "TX", label: null },
    { facet: "driver", value: "A DRIVER", label: null },
  ];
  declineFacetRows.value = [
    { facet: "unit", value: "T005", label: null },
    { facet: "error_code", value: "51", label: "INVALID DRIVER ID" },
    { facet: "error_code", value: "9", label: null },
    { facet: "policy", value: "P1", label: null },
  ];
});

describe("a decline code's menu label is the reason, not the vendor's trace", () => {
  /**
   * Measured on production 2026-09-04: EFS sends a pipe-delimited trace with the reason in front of
   * it, so a 40-character truncation offered "18 — ITEM NOT ALLOWED|ADDITIVES IN48808|C" and spent the
   * space the reason needed on internal context.
   */
  it("keeps the first segment and drops the transaction id trailing it", async () => {
    declineFacetRows.value = [
      { facet: "error_code", value: "18", label: "ITEM NOT ALLOWED|ADDITIVES IN48808|CheckItems|" },
      { facet: "error_code", value: "119", label: "NO SECUREFUEL DATA IN0037110997|No Carrier SecureFuel Event|" },
      { facet: "error_code", value: "55", label: "MAX AMOUNT EXCEEDED|MCodeAuth|" },
    ];
    const q = await read(() => useEfsFacets());
    expect(q.data.value?.rejErrorCodes.map((c) => c.label)).toEqual([
      "18 — ITEM NOT ALLOWED",
      "55 — MAX AMOUNT EXCEEDED",
      "119 — NO SECUREFUEL DATA",
    ]);
  });

  // A description with no trace at all is already the reason — the rule must not eat it.
  it("leaves a plain description alone", async () => {
    declineFacetRows.value = [{ facet: "error_code", value: "51", label: "INVALID DRIVER ID" }];
    const q = await read(() => useEfsFacets());
    expect(q.data.value?.rejErrorCodes[0]!.label).toBe("51 — INVALID DRIVER ID");
  });

  // ⚠ `IN123` is stripped only when it TRAILS the reason. A code whose reason ends in something that
  // merely looks like one — and a bare id with nothing in front of it — must still say something.
  it("never shortens a reason to nothing", async () => {
    declineFacetRows.value = [{ facet: "error_code", value: "7", label: "IN0415408493|Card Swipe Violation|" }];
    const q = await read(() => useEfsFacets());
    expect(q.data.value?.rejErrorCodes[0]!.label).toBe("7 — IN0415408493|Card Swipe Violation|");
  });
});

describe("the truck menu is the union of the fleet and the units the feeds printed", () => {
  it("offers a unit the feeds carry that the fleet has no row for — the 56 lines nobody could filter", async () => {
    const options = await read(() => useUnitOptions());
    expect(options.value.map((o) => o.value)).toEqual(["101", "654", "696", "T005"]);
  });

  it("says which of them is not a truck, rather than offering it as one", async () => {
    const options = await read(() => useUnitOptions());
    expect(options.value.find((o) => o.value === "696")!.label).toBe("696 · not in the fleet");
    expect(options.value.find((o) => o.value === "654")!.label).toBe("654");
  });

  // The union's other end: a truck the fleet has and the feeds have not billed for yet — a new truck —
  // must stay selectable. Deriving the menu from the feeds ALONE would be the original defect with its
  // sign flipped.
  it("keeps a fleet truck that appears in neither feed", async () => {
    const options = await read(() => useUnitOptions());
    expect(options.value.map((o) => o.value)).toContain("101");
  });

  // Unit 9 before unit 10, which is why the sort is here and not in SQL: no collation those functions
  // can reach reproduces it, and a menu ordered 10, 101, 9 is a menu people scroll past their truck in.
  it("orders the units the way a human reads a truck number", async () => {
    fleet.value = [{ id: "a", unit_number: "9" }, { id: "b", unit_number: "10" }, { id: "c", unit_number: "101" }];
    facetRows.value = [];
    declineFacetRows.value = [];
    const options = await read(() => useUnitOptions());
    expect(options.value.map((o) => o.value)).toEqual(["9", "10", "101"]);
  });

  // ⚠ `FilterSelect` draws the "All units" row itself for a multi-select — it is the clear affordance,
  // ticked when nothing is chosen. A second one in the options would be a row that looks selectable and
  // means the absence of a selection.
  it("carries no 'All units' option of its own", async () => {
    const options = await read(() => useUnitOptions());
    expect(options.value.map((o) => o.value)).not.toContain("");
  });
});

describe("resolving unit numbers to the vehicle ids the fills query needs", () => {
  const resolve = (units: string[]) => read(() => useVehicleIdsForUnits(computed(() => units)));

  it("asks for no truck filter at all when nothing is chosen", async () => {
    expect((await resolve([])).vehicleIds.value).toBeUndefined();
  });

  it("resolves the trucks it knows", async () => {
    expect((await resolve(["654", "101"])).vehicleIds.value).toEqual(["v-654", "v-101"]);
  });

  /**
   * ⚠ The assertion the whole three-state design exists for. A filter naming only units this fleet has
   * no row for resolves to an EMPTY list, which matches nothing — not to `undefined`, which would show
   * the whole fleet's fills under a filter bar reading "696". That is the confidently-wrong answer
   * FUEL-T5 spent a step removing, and it is one `?? undefined` away at any time.
   */
  it("narrows to nothing — never widens to everything — for units the fleet does not have", async () => {
    expect((await resolve(["696"])).vehicleIds.value).toEqual([]);
  });

  it("keeps the trucks it can resolve when the selection mixes the two", async () => {
    expect((await resolve(["654", "696"])).vehicleIds.value).toEqual(["v-654"]);
  });
});

describe("the filter menus come from the two facet functions, not from a capped read", () => {
  it("asks the database for the distinct values rather than paging rows into the browser", async () => {
    await read(() => useEfsFacets());
    expect(rpcCalls.sort()).toEqual(["decline_facets", "efs_transaction_facets"]);
  });

  it("splits each function's rows into the menus that read them", async () => {
    const q = await read(() => useEfsFacets());
    expect(q.data.value).toMatchObject({
      txnItems: ["ULSD"],
      txnStates: ["TX"],
      txnDrivers: ["A DRIVER"],
      txnUnits: ["654", "696"],
      rejUnits: ["T005"],
      rejPolicies: ["P1"],
    });
  });

  // "51" means nothing in a dropdown and "51 — INVALID DRIVER ID" means something. A code the vendor
  // sent with no description still has to be selectable, so the label falls back to the code itself
  // rather than to an empty row.
  it("labels an error code with its description, and falls back to the bare code without one", async () => {
    const q = await read(() => useEfsFacets());
    expect(q.data.value?.rejErrorCodes).toEqual([
      { code: "9", label: "9" },
      { code: "51", label: "51 — INVALID DRIVER ID" },
    ]);
  });
});
