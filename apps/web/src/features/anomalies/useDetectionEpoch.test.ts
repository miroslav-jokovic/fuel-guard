import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";
import { QUERY_DEFAULTS } from "@silvicom/ui";

/**
 * The Alerts page lists no case before the org's detection start date (0439, D-CF9, F02-F04 chunk 7b).
 *
 * The reset closes the old queue, but the page's default view ("All (active)") shows closed cases too,
 * so without this filter every case the reset closed would still be listed. The rule is shared
 * (`detectionEpoch.ts`); what this pins is that the page reads the org's date, waits for it, and
 * applies it, and that an org never reset sees its cases as before.
 */

interface Call { table: string; method: string; args: unknown[] }
const calls: Call[] = [];
let orgRow: Record<string, unknown> | null = null;
/** The org row's read fails (the list's own read still answers). */
let orgFails = false;

function builder(table: string): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: table === "organizations" ? orgRow : [], error: null });
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") return (t as { then: unknown }).then;
      if (prop === "maybeSingle") {
        return async () => {
          calls.push({ table, method: "maybeSingle", args: [] });
          return table === "organizations" && orgFails
            ? { data: null, error: { message: "The read failed." } }
            : { data: table === "organizations" ? orgRow : null, error: null };
        };
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: prop, args });
        return builder(table);
      };
    },
  });
}

vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => builder(table) } }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));

import { useAnomaliesQuery } from "./useAnomalies";

async function listQuery() {
  const Host = defineComponent({
    setup() {
      useAnomaliesQuery(ref({}));
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [VueQueryPlugin] } });
  for (let i = 0; i < 4; i++) await flushPromises();
  return calls.filter((c) => c.table === "anomalies");
}

beforeEach(() => {
  calls.length = 0;
  orgRow = null;
  orgFails = false;
});
afterEach(() => vi.useRealTimers());

describe("the Alerts list reads the detection start date (D-CF9)", () => {
  it("after the reset, lists only cases on or after the start date, or being investigated", async () => {
    orgRow = { id: "org-1", detection_epoch: "2026-10-08T07:00:00-05:00" };
    const q = await listQuery();
    expect(q.filter((c) => c.method === "or").map((c) => c.args[0])).toEqual([
      "fueled_at.gte.2026-10-08T12:00:00.000Z,status.eq.investigating",
    ]);
    // It waited for the org row: one list query, never a first unfiltered one showing the closed cases.
    expect(q.filter((c) => c.method === "select")).toHaveLength(1);
  });

  it("an org never reset lists its cases as before: no filter", async () => {
    orgRow = { id: "org-1", detection_epoch: null };
    const q = await listQuery();
    expect(q.some((c) => c.method === "select")).toBe(true);
    expect(q.some((c) => c.method === "or")).toBe(false);
  });
});

/**
 * Small-screens audit, 2026-11-15: with every read failing, Fuel alerts was still on its skeleton after
 * nine seconds. A failed date read used to OPEN the gate, so the list was asked for only then and its
 * three retries ran after the date's three: fourteen seconds, twice every other page's seven.
 */
describe("the Alerts list when the detection start date cannot be read", () => {
  function mountList() {
    let list!: ReturnType<typeof useAnomaliesQuery>;
    const Host = defineComponent({
      setup() {
        list = useAnomaliesQuery(ref({}));
        return () => null;
      },
    });
    // The app's own retry rule (`main.ts`), so the seconds counted here are the seconds an office waits.
    mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClientConfig: { defaultOptions: QUERY_DEFAULTS } }]] } });
    return list;
  }
  const asked = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method).length;

  it("says it failed once the date's own retries are spent, and never lists cases without the date", async () => {
    vi.useFakeTimers();
    orgFails = true;
    const list = mountList();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(list.isPending.value).toBe(true);
    expect(list.isError.value).toBe(false);
    // 1 s + 2 s + 4 s of backoff: the date's three retries, and nothing queued behind them.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(list.isError.value).toBe(true);
    expect(list.isPending.value).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(asked("anomalies", "select")).toBe(0);
  });

  it("Retry asks for the date again, and the list then answers with the date applied", async () => {
    vi.useFakeTimers();
    orgFails = true;
    const list = mountList();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(list.isError.value).toBe(true);
    const before = asked("organizations", "maybeSingle");

    orgFails = false;
    orgRow = { id: "org-1", detection_epoch: "2026-10-08T07:00:00-05:00" };
    list.refetch();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(asked("organizations", "maybeSingle")).toBe(before + 1);
    expect(list.isError.value).toBe(false);
    expect(list.isPending.value).toBe(false);
    expect(calls.filter((c) => c.table === "anomalies" && c.method === "or").map((c) => c.args[0])).toEqual([
      "fueled_at.gte.2026-10-08T12:00:00.000Z,status.eq.investigating",
    ]);
  });
});
