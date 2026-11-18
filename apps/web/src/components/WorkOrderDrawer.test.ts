import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { WorkOrderDetailDto, WorkOrderFilesDto } from "@silvicom/shared";

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
const api = vi.hoisted(() => ({ calls: [] as string[], data: null as unknown, files: null as unknown, opened: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.calls.push(path);
    return { ok: true, data: { data: path.endsWith("/files") ? api.files : api.data } };
  }),
}));
vi.mock("@/lib/documentDownload", () => ({ openPdf: vi.fn(async (path: string) => void api.opened.push(path)) }));

const Drawer = (await import("./WorkOrderDrawer.vue")).default;

const DETAIL: WorkOrderDetailDto = {
  id: "row-1",
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
      { invoiceId: "inv88", purchaseOrder: "PO-2201", invoiceNumber: "INV-88", invoiceDate: "2026-11-04T00:00:00Z", invoiceType: "STANDARD", amount: 1288.13 },
      { invoiceId: "cr9", purchaseOrder: "PO-2201", invoiceNumber: "CR-9", invoiceDate: "2026-11-05T00:00:00Z", invoiceType: "CREDIT", amount: 40 },
    ],
  },
};

const FILES: WorkOrderFilesDto = { state: "read", files: [{ invoiceId: "inv88", index: 0, filename: "WO_Priced_4011391635", contentType: "application/pdf" }] };

async function open(id: string | null, data: unknown = DETAIL, files: WorkOrderFilesDto = FILES, props: Record<string, unknown> = { id }) {
  api.data = data;
  api.files = files;
  const w = mount(Drawer, { props, attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  await flushPromises();
  return w;
}
const body = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

afterEach(() => {
  api.calls.length = 0;
  api.opened.length = 0;
  document.body.innerHTML = "";
});

describe("WorkOrderDrawer", () => {
  it("asks for our row's id, and nothing while closed", async () => {
    (await open(null)).unmount();
    expect(api.calls).toEqual([]);
    await open("row-1");
    expect(api.calls).toEqual(["/api/maintenance/work-orders/row-1", "/api/maintenance/work-orders/row-1/files"]);
  });

  it("opens by FleetPal's id for a roadside repair, and asks for files by the row id the record carries", async () => {
    await open(null, DETAIL, FILES, { fleetpalId: "fpwo1" });
    expect(api.calls).toEqual(["/api/maintenance/fleetpal-work-orders/fpwo1", "/api/maintenance/work-orders/row-1/files"]);
  });

  it("offers each invoice's scanned bill, opened through our API, and says plainly which invoice has none", async () => {
    await open("row-1");
    // The SlideOver teleports to <body>, so the page is read from the document, not the wrapper.
    const rows = [...document.body.querySelectorAll("[data-test='invoice-files']")].map((e) => (e.textContent ?? "").trim());
    expect(rows).toEqual(["Open bill (PDF)", "No bill attached in FleetPal"]);
    document.body.querySelector<HTMLButtonElement>("[data-test='invoice-file']")!.click();
    await flushPromises();
    expect(api.opened).toEqual(["/api/maintenance/work-orders/row-1/files/inv88/0"]);
  });

  it("⚠ never says 'no bill' when FleetPal was not asked or did not answer", async () => {
    await open("row-1", DETAIL, { state: "not_connected" });
    expect(body()).toContain("FleetPal is not connected for this fleet");
    expect(body()).not.toContain("No bill attached");
    document.body.innerHTML = "";
    await open("row-1", DETAIL, { state: "unreachable" });
    expect(body()).toContain("Could not reach FleetPal");
    expect(body()).not.toContain("No bill attached");
  });

  it("does not ask FleetPal about files for an order with no invoice", async () => {
    await open("row-1", { ...DETAIL, record: { ...DETAIL.record, invoices: [] } });
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
