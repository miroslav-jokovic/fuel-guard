import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { computed, ref, type Ref } from "vue";
import { iftaJurisdictionTrucks, metersFromMiles, type IftaJurisdictionTrucks } from "@silvicom/shared";
import type { IftaQuarter } from "@/features/ifta/useIftaPeriod";

const session = vi.hoisted(() => ({ role: "admin" as string }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  return { useSessionStore: () => fakeSession(session.role as never) };
});

/**
 * One IFTA ledger row, opened. The arithmetic is `iftaJurisdictionTrucks`'s and is tested in shared;
 * these pin what the page does with it: the trucks, their miles, the quarter from the link, and a
 * truck link only for a reader the vehicle page would let in.
 */
const trucks = ref<IftaJurisdictionTrucks | null>(null);
const errored = ref(false);
const asked = ref<{ quarter: IftaQuarter; code: string } | null>(null);

vi.mock("@/features/ifta/useIftaPeriod", async (orig) => {
  const actual = await orig<typeof import("@/features/ifta/useIftaPeriod")>();
  return {
    ...actual,
    useIftaJurisdictionQuery: (quarter: Ref<IftaQuarter>, code: Ref<string>) => {
      asked.value = { quarter: quarter.value, code: code.value };
      return {
        data: computed(() => trucks.value),
        isLoading: ref(false),
        isFetching: ref(false),
        isError: errored,
        error: ref(new Error("boom")),
        refetch: () => undefined,
      };
    },
  };
});

import IftaJurisdictionPage from "./IftaJurisdictionPage.vue";

const raw = (unitNumber: string | null, taxableMiles: number, totalMiles: number, months: number) => ({
  vehicleId: `v-${unitNumber}`, unitNumber,
  taxableMeters: metersFromMiles(taxableMiles), totalMeters: metersFromMiles(totalMiles), months,
});

beforeEach(() => {
  session.role = "admin";
  errored.value = false;
  trucks.value = iftaJurisdictionTrucks([raw("732", 3_000, 3_100, 3), raw("101", 1_000, 1_000, 1)]);
});

async function mountPage(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ifta", component: { template: "<div/>" }, meta: { title: "IFTA" } },
      { path: "/ifta/:jurisdiction", component: { template: "<div/>" }, meta: { title: "IFTA jurisdiction", parent: "/ifta" } },
      { path: "/vehicles/:id", component: { template: "<div/>" }, meta: { requiresAuth: true, title: "Vehicle" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(IftaJurisdictionPage, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("IftaJurisdictionPage", () => {
  it("lists every truck that drove in the jurisdiction with its miles there", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3")).text();
    expect(t).toContain("Texas");
    expect(t).toContain("732");
    expect(t).toContain("3,000");
    expect(t).toContain("3,100");
    expect(t).toContain("101");
    expect(t).toContain("75.0%");
    expect(t).toContain("1 of 3");
    expect(t).not.toContain("NaN");
  });

  it("totals the jurisdiction, so the figure can be checked against the ledger row", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3")).text();
    expect(t).toContain("4,000");
  });

  it("asks for the jurisdiction and quarter the link names, upper-casing a hand-typed code", async () => {
    await mountPage("/ifta/tx?q=2026-Q2");
    expect(asked.value).toEqual({ quarter: { year: 2026, quarter: 2 }, code: "TX" });
  });

  it("links a truck to its vehicle page for a reader who can open it", async () => {
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    expect(w.findAll("a").map((a) => a.attributes("href"))).toContain("/vehicles/v-732");
  });

  it("shows the truck as text, not a dead link, to a reader the vehicle page would refuse", async () => {
    session.role = "accountant";
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    expect(w.text()).toContain("732");
    expect(w.findAll("a").map((a) => a.attributes("href"))).not.toContain("/vehicles/v-732");
  });

  it("says so when no truck drove there that quarter", async () => {
    trucks.value = iftaJurisdictionTrucks([]);
    expect((await mountPage("/ifta/NV?q=2026-Q3")).text()).toContain("No truck reported miles in Nevada");
  });

  it("renders the error rather than an empty table", async () => {
    errored.value = true;
    trucks.value = null;
    expect((await mountPage("/ifta/TX?q=2026-Q3")).text()).toContain("Couldn't load Texas");
  });
});
