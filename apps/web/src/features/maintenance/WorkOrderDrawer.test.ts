import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { WorkOrderDetailDto } from "@silvicom/shared";

/**
 * The Shop's work order drawer (FLEETPAL-INTEGRATION-PLAN.md F14, D-FP27). The hook runs for real over a
 * stubbed `apiFetch`, so these pin what the page asks for as well as what it prints:
 *
 *   1. It asks for OUR row's id, and nothing while closed.
 *   2. Each invoice is printed with its number, date, purchase order and amount; a credit reads negative.
 *   3. An order with no invoice says why, rather than showing an empty list.
 *   4. Labour reads in hours, a part with its number and unit.
 *   5. "As of" is FleetPal's sync time, or a warning when a resource never synced.
 */
const api = vi.hoisted(() => ({ calls: [] as string[], data: null as unknown }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    return { ok: true, data: { data: api.data } };
  }),
}));

const Drawer = (await import("./WorkOrderDrawer.vue")).default;

const DETAIL: WorkOrderDetailDto = {
  unitNumber: "654",
  asOf: "2026-11-17T15:00:00Z",
  record: {
    fleetpalId: "fp-wo-1", reference: "WO-5436", status: "CLOSED", openedAt: "2026-11-01T14:00:00Z", completedAt: "2026-11-03T20:00:00Z",
    description: "Brakes pulling left",
    jobs: [{
      name: "Adjust brakes", description: null, complaint: "Pulls left", total: 312.5,
      lines: [
        { type: "LABOR", description: "Adjust", partNumber: null, quantity: 1.5, unitOfMeasure: null, total: 180 },
        { type: "PART", description: "Slack adjuster", partNumber: "HAL-1", quantity: 1, unitOfMeasure: "EA", total: 132.5 },
      ],
    }],
    invoices: [
      { purchaseOrder: "PO-2201", invoiceNumber: "INV-88", invoiceDate: "2026-11-04T00:00:00Z", invoiceType: "STANDARD", amount: 1288.13 },
      { purchaseOrder: "PO-2201", invoiceNumber: "CR-9", invoiceDate: "2026-11-05T00:00:00Z", invoiceType: "CREDIT", amount: 40 },
    ],
  },
};

async function open(id: string | null, data: unknown = DETAIL) {
  api.data = data;
  const w = mount(Drawer, { props: { id }, attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  await flushPromises();
  return w;
}
const body = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

afterEach(() => {
  api.calls.length = 0;
  document.body.innerHTML = "";
});

describe("WorkOrderDrawer", () => {
  it("asks for our row's id, and nothing while closed", async () => {
    (await open(null)).unmount();
    expect(api.calls).toEqual([]);
    await open("row-1");
    expect(api.calls).toEqual(["/api/maintenance/work-orders/row-1"]);
  });

  it("prints each invoice with its number, date, purchase order and amount; a credit reads negative", async () => {
    await open("row-1");
    const t = body();
    expect(t).toContain("WO-5436");
    expect(t).toContain("Unit 654 · Closed");
    expect(t).toContain("Invoice INV-88");
    expect(t).toContain("11/04/2026 · Purchase order PO-2201");
    expect(t).toContain("$1,288");
    expect(t).toMatch(/Invoice CR-9\s*Credit/);
    expect(t).toContain("−$40");
  });

  it("says why an order has no invoice instead of an empty list", async () => {
    await open("row-1", { ...DETAIL, record: { ...DETAIL.record, invoices: [] } });
    expect(body()).toContain("No vendor invoice on this work order");
  });

  it("reads labour in hours and a part with its number and unit", async () => {
    await open("row-1");
    const t = body();
    expect(t).toContain("Labour Adjust · 1.5 h");
    expect(t).toMatch(/Part Slack adjuster HAL-1\s*· 1 EA/);
    expect(t).toContain("Complaint: Pulls left");
  });

  it("states FleetPal's sync time, and warns when a resource has never synced", async () => {
    await open("row-1");
    expect(body()).toMatch(/From FleetPal, as of 11\/17\/2026/);
    document.body.innerHTML = "";
    await open("row-1", { ...DETAIL, asOf: null });
    expect(body()).toContain("has not synced yet, so this may be incomplete");
  });
});
