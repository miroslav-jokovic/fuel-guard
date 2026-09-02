import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

/**
 * The spend page says when its figures were derived (FUEL-T5, A6, D-FUI18).
 *
 * `fuel_spend_days` rebuilds only the trailing 14 days. Measured in production: 29,114 rows whose
 * `updated_at` all fall inside one week in August — so a reader asking for March was shown figures
 * built months earlier, from whatever the data looked like then, with nothing on screen saying so.
 *
 * The assertions are on the QUERY, because the query is the claim: which rows it looks at, and which
 * end of them it takes. The SENTENCE it produces is `describeRollupFreshness`, tested in
 * `packages/shared` — one derivation, so the page and the PDF cannot print different words.
 */

interface Call { method: string; args: unknown[] }
const calls: Call[] = [];
let rows: unknown[] = [];

function recorder(): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: rows, error: null });
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") return (t as { then: unknown }).then;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return recorder();
      };
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => { calls.push({ method: "from", args: [table] }); return recorder(); } },
}));

import { useSpendFreshnessQuery } from "./useSpendFreshness";
import type { SpendQueryFilters } from "./useSpendDays";

async function run(filters: SpendQueryFilters) {
  let out: unknown;
  const Host = defineComponent({
    setup() {
      const q = useSpendFreshnessQuery(ref(filters));
      return () => { out = q.data.value; return null; };
    },
  });
  mount(Host, { global: { plugins: [VueQueryPlugin] } });
  await flushPromises();
  await flushPromises();
  return out as { lead: string | null; stale: boolean; ageDays: number | null } | undefined;
}

const op = (m: string, col?: string) =>
  calls.filter((c) => c.method === m && (col === undefined || c.args[0] === col));

beforeEach(() => { calls.length = 0; rows = []; });

describe("useSpendFreshnessQuery — when were these figures built", () => {
  it("asks the rollup, for one column, and only that column", async () => {
    await run({ from: "2026-08-01", to: "2026-08-31", vehicleIds: [] });
    expect(op("from")[0]!.args[0]).toBe("fuel_spend_days");
    expect(op("select")[0]!.args[0]).toBe("updated_at");
  });

  // Ascending + limit 1 IS "the oldest". A window straddling the 14-day rebuild boundary holds rows
  // built last night AND rows built in August; the newest would flatter the stale part of the answer.
  it("takes the OLDEST build in the window, not the newest", async () => {
    await run({ from: "2026-08-01", to: "2026-08-31", vehicleIds: [] });
    expect(op("order")[0]!.args).toEqual(["updated_at", { ascending: true }]);
    expect(op("limit")[0]!.args).toEqual([1]);
  });

  it("windows on the same days the figures it qualifies are windowed on", async () => {
    await run({ from: "2026-08-01", to: "2026-08-31", vehicleIds: [] });
    expect(op("gte", "day")[0]!.args[1]).toBe("2026-08-01");
    expect(op("lte", "day")[0]!.args[1]).toBe("2026-08-31");
  });

  it("narrows with the truck filter — a build stamp from a truck the reader excluded is not their answer", async () => {
    await run({ from: "2026-08-01", to: "2026-08-31", vehicleIds: ["v1", "v2"] });
    expect(op("in", "vehicle_id")[0]!.args[1]).toEqual(["v1", "v2"]);
  });

  it("asks about the whole fleet when no truck is chosen, rather than about none of it", async () => {
    await run({ from: "2026-08-01", to: "2026-08-31", vehicleIds: [] });
    expect(op("in", "vehicle_id")).toEqual([]);
  });

  it("reports a stale window as stale, using the row it was given", async () => {
    rows = [{ updated_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }];
    const r = await run({ from: "2026-01-01", to: "2026-08-31", vehicleIds: [] });
    expect(r?.stale).toBe(true);
    expect(r?.lead).toContain("have not been applied");
  });

  it("says nothing at all when the window holds no rows", async () => {
    rows = [];
    const r = await run({ from: "2030-01-01", to: "2030-01-31", vehicleIds: [] });
    expect(r?.lead).toBeNull();
    expect(r?.stale).toBe(false);
  });
});
