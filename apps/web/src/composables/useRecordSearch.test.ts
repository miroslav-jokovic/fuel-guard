import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import { buildNavGroups } from "@/lib/nav";
import { paletteEntries } from "@/lib/commandPalette";
import { searchableKinds } from "@/lib/recordSearch";

/**
 * The palette's record reads (D-SB8): each kind asks its own table the way its list page does, and
 * one kind failing names itself while the others still answer.
 */
const reads: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const failing = new Set<string>();
const tableRows: Record<string, unknown[]> = {
  vehicles: [{ id: "v1", unit_number: "1042", year: 2021, make: "Freightliner", model: "Cascadia", status: "retired" }],
  trailers: [{ id: "t1", unit_number: "T1042", make: "Utility", trailer_type: "reefer" }],
  drivers: [{ id: "d1", full_name: "Ana Petrovic", employee_id: "1042", status: "on_leave" }],
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, ops: [] as Array<[string, unknown[]]> };
      reads.push(read);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "or", "in", "order", "limit"]) {
        chain[m] = (...args: unknown[]) => {
          read.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(failing.has(table) ? { data: null, error: { message: "boom" } } : { data: tableRows[table] ?? [], error: null });
      return chain;
    },
  },
}));

const apiCalls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    apiCalls.push(url);
    return failing.has("loads")
      ? { ok: false, status: 500, error: { code: "error", message: "boom" } }
      : { ok: true, status: 200, data: { loads: [{ id: "l1", ref: "L1042", customer_name: "ACME FOODS", driver_name: null }] } };
  }),
}));

const { runRecordSearch } = await import("./useRecordSearch");

const allModules = new Set(MODULE_KEYS) as unknown as ModuleSet;
const kinds = searchableKinds(paletteEntries(buildNavGroups("admin", allModules), []), () => true);

beforeEach(() => {
  reads.length = 0;
  apiCalls.length = 0;
  failing.clear();
});

describe("runRecordSearch", () => {
  it("asks each kind's own table, and loads through the API", async () => {
    const { entries, failed } = await runRecordSearch("1042", kinds);
    expect(failed).toEqual([]);
    expect(entries.map((e) => e.to)).toEqual(["/vehicles/v1", "/trailers/t1", "/drivers/d1", "/loads/l1"]);
    expect(apiCalls).toEqual(["/api/dispatch/loads/search?q=1042"]);
    expect(reads.map((r) => r.table)).toEqual(["vehicles", "trailers", "drivers"]);
    for (const r of reads) expect(r.ops.find(([m]) => m === "limit")?.[1]).toEqual([5]);
  });

  it("searches the employed roster only, as the Drivers page lists it", async () => {
    await runRecordSearch("1042", kinds);
    const drivers = reads.find((r) => r.table === "drivers")!;
    expect(drivers.ops.find(([m]) => m === "in")?.[1]).toEqual(["status", ["active", "inactive", "on_leave", "terminated"]]);
  });

  it("says when a truck is not in service and when a driver is not active", async () => {
    const { entries } = await runRecordSearch("1042", kinds);
    expect(entries.find((e) => e.to === "/vehicles/v1")?.detail).toBe("2021 · Freightliner · Cascadia · Not in service");
    expect(entries.find((e) => e.to === "/drivers/d1")?.detail).toBe("1042 · On leave");
    expect(entries.find((e) => e.to === "/loads/l1")?.detail).toBe("ACME FOODS");
  });

  it("names a kind that failed and keeps the others' answers", async () => {
    failing.add("loads").add("trailers");
    const { entries, failed } = await runRecordSearch("1042", kinds);
    expect(failed).toEqual(["trailers", "loads"]);
    expect(entries.map((e) => e.to)).toEqual(["/vehicles/v1", "/drivers/d1"]);
  });
});
