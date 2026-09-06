import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

/**
 * FUEL-T5 — how much of a raw-feed list names a truck.
 *
 * The wording is `describeRowCoverage`, tested in `packages/shared`. What is testable here is the
 * part that can be silently wrong: WHICH ROWS the two counts cover. A caveat that describes a
 * different set than the list beneath it is worse than no caveat, and the two failure modes are
 * specific — the attributed count drifting off the list's filters, and the transactions count running
 * before the fleet's unit numbers have arrived, which would print "0% of the 28,620 transactions in
 * this list name a truck" from nothing but a slow query.
 */

interface Chain {
  table: string;
  ops: { m: string; args: unknown[] }[];
}
const chains: Chain[] = [];
const counts = { all: 1000, attributed: 900 };

/**
 * A chain is the ATTRIBUTED one if it narrowed to rows naming a truck.
 *
 * ⚠ "has an `in`" was the old test, and FUEL-P1 broke it without failing anything: the truck FILTER is
 * now `.in("unit", […])` too, so under a unit filter both chains carried an `in` and both were handed
 * the attributed count. The attributed chain is the one that applies the FLEET's units — the second
 * `in` on `unit` — or, on rejections, the `not(vehicle_id is null)`. Discriminating on the shape that
 * actually distinguishes them is what keeps this stub from agreeing with any implementation.
 */
const sameSet = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && b.every((u) => a.includes(u));
const isAttributed = (c: Chain) =>
  c.ops.some((o) => o.m === "not") ||
  c.ops.some((o) => o.m === "in" && o.args[0] === "unit" && sameSet(o.args[1], fleet.value.map((v) => v.unit_number)));

function recorder(chain: Chain): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: null, error: null, count: isAttributed(chain) ? counts.attributed : counts.all });
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") return (t as { then: unknown }).then;
      return (...args: unknown[]) => {
        chain.ops.push({ m: prop, args });
        return recorder(chain);
      };
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Chain = { table, ops: [] };
      chains.push(chain);
      return recorder(chain);
    },
  },
}));

const fleet = ref<{ unit_number: string }[]>([{ unit_number: "101" }, { unit_number: "102" }]);
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: fleet }) }));

import { useEfsRowCoverage, type EfsFilters } from "./useEfsData";

/**
 * Mount, settle, and return ONLY the queries this call made.
 *
 * The slice matters: a host left mounted keeps its vue-query subscription alive, and a refetch from an
 * earlier case lands in `chains` after the next `beforeEach` has cleared it. That produced a genuinely
 * confusing failure while writing this file — an assertion about a date window reading a chain built
 * by a previous test's unfiltered query — so the boundary is taken per call rather than per test.
 */
async function coverage(surface: "transactions" | "rejections", filters: EfsFilters = {}) {
  const before = chains.length;
  let out: unknown;
  const Host = defineComponent({
    setup() {
      const q = useEfsRowCoverage(surface, ref(filters));
      return () => {
        out = q.data.value;
        return null;
      };
    },
  });
  const host = mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
  await flushPromises();
  host.unmount();
  return {
    data: out as { rows: number; attributed: number; lead: string | null } | undefined,
    queries: chains.slice(before),
  };
}

const opsOf = (c: Chain, m: string) => c.ops.filter((o) => o.m === m).map((o) => o.args);

beforeEach(() => {
  chains.length = 0;
  counts.all = 1000;
  counts.attributed = 900;
  fleet.value = [{ unit_number: "101" }, { unit_number: "102" }];
});

describe("useEfsRowCoverage — the caveat counts the same rows as the list", () => {
  // The whole point. If the denominator and the numerator disagree about the window, the sentence is
  // arithmetic about two different lists and reads as a fact about one.
  it("puts every filter on BOTH counts, so the share describes the rows on screen", async () => {
    // The filter names ONE of the fleet's two units, so the filter's `in` and the fleet's `in` are
    // distinguishable — a fixture where they coincide cannot tell a correct implementation from one
    // that dropped the filter off the attributed count.
    const { queries } = await coverage("transactions", { from: "2026-08-01", to: "2026-08-31", units: ["101"], item: "ULSD", search: "pilot" });
    expect(queries.map((q) => q.table)).toEqual(["efs_transactions", "efs_transactions"]);
    for (const c of queries) {
      expect(opsOf(c, "eq")).toEqual(expect.arrayContaining([["item", "ULSD"]]));
      // FUEL-P1. The truck filter is a LIST on both counts, or the denominator covers trucks the
      // numerator does not and the sentence describes two different sets.
      expect(opsOf(c, "in")).toEqual(expect.arrayContaining([["unit", ["101"]]]));
      expect(opsOf(c, "gte")).toEqual([["tran_date", "2026-08-01"]]);
      expect(opsOf(c, "lte")).toEqual([["tran_date", "2026-08-31"]]);
      expect(opsOf(c, "or")).toHaveLength(1);
    }
  });

  it("asks for the counts and for no rows at all", async () => {
    const { queries } = await coverage("transactions");
    for (const c of queries) {
      expect(opsOf(c, "select")).toEqual([["id", { count: "exact", head: true }]]);
    }
  });

  it("narrows the attributed count to this fleet's unit numbers, and leaves the other count alone", async () => {
    const { data, queries } = await coverage("transactions");
    const [all, attributed] = queries;
    expect(opsOf(all!, "in")).toEqual([]);
    expect(opsOf(attributed!, "in")).toEqual([["unit", ["101", "102"]]]);
    expect(data).toMatchObject({ rows: 1000, attributed: 900 });
  });

  // ⚠ The failure this guard exists for: `.in("unit", [])` matches nothing, so a fleet query that has
  // not landed yet would print "0% of these name a truck" — from a slow query, not from the data.
  it("does not count at all until the fleet's unit numbers have arrived", async () => {
    fleet.value = [];
    const { data, queries } = await coverage("transactions");
    expect(queries).toHaveLength(0);
    expect(data).toBeUndefined();
  });

  // `declined_transactions.vehicle_id` already IS the attribution fact — 2,749 declines carry one and
  // they are exactly the 2,749 whose unit matches a vehicle (measured 2026-09-02). The plan's note
  // that both pages need a migration is true of `efs_transactions` and false of this one.
  it("reads the declines' own vehicle_id rather than matching unit text, and needs no fleet list", async () => {
    fleet.value = [];
    const { data, queries } = await coverage("rejections");
    expect(queries.map((q) => q.table)).toEqual(["declined_transactions", "declined_transactions"]);
    expect(opsOf(queries[1]!, "not")).toEqual([["vehicle_id", "is", null]]);
    expect(queries.flatMap((x) => opsOf(x, "in"))).toEqual([]);
    expect(data).toMatchObject({ rows: 1000, attributed: 900 });
  });

  it("carries the declines' own date window — the Central-instant one, not a bare date compare", async () => {
    const { queries } = await coverage("rejections", { from: "2026-08-01", to: "2026-08-31" });
    for (const c of queries) {
      expect(opsOf(c, "gte")[0]?.[0]).toBe("declined_at");
      expect(opsOf(c, "lt")[0]?.[0]).toBe("declined_at");
      expect(opsOf(c, "lte")).toEqual([]);
    }
  });

  it("hands the counts to the shared wording rather than building a sentence here", async () => {
    counts.all = 3445;
    counts.attributed = 2749;
    const { data } = await coverage("rejections");
    expect(data?.lead).toBe(
      "79% of the 3,445 declines in this list name a truck on the fleet. The other 696 declines are absent from any figure counted per truck.",
    );
  });
});
