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

const fill = (id: string, vehicleId: string | null, gallons: number, totalCost: number, day: string, location: string) => ({
  id, vehicleId, fueledAt: `${day}T15:00:00Z`, businessDate: day, gallons, pricePerGal: totalCost / gallons, totalCost, location,
});

beforeEach(() => {
  session.role = "admin";
  errored.value = false;
  // A desktop viewport, so DataTable renders its table rather than the phone cards.
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
  trucks.value = iftaJurisdictionTrucks(
    [raw("732", 3_000, 3_100, 3), raw("101", 1_000, 1_000, 1)],
    [
      fill("f1", "v-732", 120, 456, "2026-07-14", "Love's #512, Amarillo TX"),
      fill("f2", "v-732", 80, 300, "2026-08-02", "Pilot #301, El Paso TX"),
      fill("f3", null, 40, 150, "2026-08-20", "TA Dallas"),
    ],
  );
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
  it("lists every truck that drove in the jurisdiction with its miles there, under All trucks", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3&show=all")).text();
    expect(t).toContain("Texas");
    expect(t).toContain("732");
    expect(t).toContain("3,000");
    expect(t).toContain("3,100");
    expect(t).toContain("101");
    expect(t).toContain("75.0%");
    expect(t).toContain("1 of 3");
    expect(t).not.toContain("NaN");
  });

  // ── the owner's ruling of 2026-10-05: the resting view is the trucks that bought fuel here ──
  const listedUnits = (w: Awaited<ReturnType<typeof mountPage>>) =>
    w.findAll("tbody tr").map((tr) => tr.text()).filter((s) => !s.includes("Date"));

  it("lists only the trucks that bought fuel here by default, and says the list is narrower than the cards", async () => {
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    const rows = listedUnits(w);
    expect(rows.some((r) => r.includes("732"))).toBe(true);
    expect(rows.some((r) => r.includes("Not assigned to a truck"))).toBe(true);
    expect(rows.some((r) => r.includes("101"))).toBe(false);
    // The cards still describe the whole jurisdiction — 101's miles are in them.
    expect(w.text()).toContain("4,000");
    expect(w.find('[data-testid="narrower"]').text()).toContain("Listing 1 of 2 trucks");
  });

  it("shows the trucks that drove here and bought nothing, on request — they are what makes the state owed tax", async () => {
    const rows = listedUnits(await mountPage("/ifta/TX?q=2026-Q3&show=drove"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("101");
  });

  it("finds a truck by unit number, and the search lives in the link", async () => {
    const rows = listedUnits(await mountPage("/ifta/TX?q=2026-Q3&show=all&search=73"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("732");
  });

  it("says why the list is empty when the filter, not the jurisdiction, emptied it", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3&search=999")).text();
    expect(t).toContain('No truck matching "999"');
  });

  it("pages a long jurisdiction 25 trucks at a time", async () => {
    trucks.value = iftaJurisdictionTrucks(
      Array.from({ length: 30 }, (_, i) => raw(String(100 + i), 1_000 + i, 1_000 + i, 3)),
      Array.from({ length: 30 }, (_, i) => fill(`f${i}`, `v-${100 + i}`, 10, 38, "2026-07-14", "Pilot")),
    );
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    expect(listedUnits(w)).toHaveLength(25);
    expect(w.text()).toContain("30");
  });

  it("totals the jurisdiction, so the figure can be checked against the ledger row", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3")).text();
    expect(t).toContain("4,000");
    // 120 + 80 + the 40 bought with no truck attached: the ledger row's "Gallons bought" counts it too.
    expect(t).toContain("240");
    expect(t).toContain("in 3 fills");
  });

  it("shows each truck's fuel bought here, and keeps fills with no truck on a row of their own", async () => {
    const t = (await mountPage("/ifta/TX?q=2026-Q3")).text();
    expect(t).toContain("Gallons bought");
    expect(t).toContain("$756");
    expect(t).toContain("Not assigned to a truck");
  });

  it("opens a truck's fills in this jurisdiction — date, station, gallons, price — when its row is clicked", async () => {
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    expect(w.find('[data-testid="fills-v-732"]').exists()).toBe(false);
    const row = w.findAll("tbody tr").find((tr) => tr.text().includes("732"));
    await row!.trigger("click");
    const fills = w.find('[data-testid="fills-v-732"]');
    expect(fills.exists()).toBe(true);
    expect(fills.text()).toContain("Pilot #301, El Paso TX");
    expect(fills.text()).toContain("08/02/2026");
    expect(fills.text()).toContain("$3.800");
    // Newest first: August's fill before July's.
    expect(fills.text().indexOf("El Paso")).toBeLessThan(fills.text().indexOf("Amarillo"));
  });

  // ── McLeod's hand-keyed receipts (IP6) ─────────────────────────────────────────────────────────
  /** Unit 512's real shape: an owner-operator whose fuel reaches the IFTA only as paper receipts. */
  const withReceipts = () => {
    trucks.value = iftaJurisdictionTrucks(
      [raw("732", 3_000, 3_100, 3)],
      [fill("f1", "v-732", 120, 456, "2026-07-14", "Love's #512, Amarillo TX")],
      { "v-512": "512" },
      [{ externalId: "r1", source: "mcleod" as const, vehicleId: "v-512", unitAsFiled: "512", jurisdiction: "TX", receiptDate: "2026-08-15", gallons: 110 }],
    );
  };

  it("lists a truck whose only fuel here was a receipt keyed in McLeod under Bought fuel here", async () => {
    withReceipts();
    const w = await mountPage("/ifta/TX?q=2026-Q3");
    const row = w.findAll("tbody tr").find((tr) => tr.text().includes("512"));
    expect(row).toBeTruthy();
    await row!.trigger("click");
    const fills = w.find('[data-testid="fills-v-512"]');
    expect(fills.text()).toContain("Receipt keyed in McLeod · TX");
    expect(fills.text()).toContain("08/15/2026");
    expect(fills.text()).toContain("110");
  });

  it("counts receipts in the jurisdiction's gallons bought and says how many there were", async () => {
    withReceipts();
    const t = (await mountPage("/ifta/TX?q=2026-Q3")).text();
    expect(t).toContain("230");
    expect(t).toContain("in 1 fill + 1 driver-paid receipt (110 gal)");
  });

  it("offers nothing to open on a truck that bought no fuel here", async () => {
    const w = await mountPage("/ifta/TX?q=2026-Q3&show=all");
    const row = w.findAll("tbody tr").find((tr) => tr.text().includes("101"));
    await row!.trigger("click");
    expect(w.find('[data-testid="fills-v-101"]').exists()).toBe(false);
    expect(row!.find("button[aria-expanded]").exists()).toBe(false);
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
    expect((await mountPage("/ifta/NV?q=2026-Q3")).text()).toContain("No truck drove or bought fuel in Nevada");
  });

  it("renders the error rather than an empty table", async () => {
    errored.value = true;
    trucks.value = null;
    expect((await mountPage("/ifta/TX?q=2026-Q3")).text()).toContain("Couldn't load Texas");
  });
});
