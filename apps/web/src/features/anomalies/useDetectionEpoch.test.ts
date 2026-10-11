import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, ref } from "vue";

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

function builder(table: string): unknown {
  const target = {
    then(resolve: (v: unknown) => void) {
      resolve({ data: table === "organizations" ? orgRow : [], error: null });
    },
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") return (t as { then: unknown }).then;
      if (prop === "maybeSingle") return async () => ({ data: table === "organizations" ? orgRow : null, error: null });
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
});

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
