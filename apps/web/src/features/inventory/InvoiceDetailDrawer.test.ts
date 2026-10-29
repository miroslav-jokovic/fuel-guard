import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { DocumentRow, EquipmentPurchaseDetail } from "@silvicom/shared";

/**
 * One invoice (M10b). What it can get wrong: offering *Correct* on a bill that was already corrected
 * (0530 refuses it, IV028) or to somebody without the shop's manage level; hiding that a bill was
 * corrected; and pointing the paper's download at any route but this bill's own, which is the one that
 * checks the document is THIS bill's (`purchaseDocuments.ts`).
 */

const BILL = "c0000000-0000-4000-8000-000000000001";
const NEWER = "c0000000-0000-4000-8000-000000000002";
const bill = (over: Partial<EquipmentPurchaseDetail> = {}): EquipmentPurchaseDetail => ({
  id: BILL, vendor: "AT&T Business", invoiceNumber: "INV-1001", invoiceDate: "2026-10-02", total: 4120.5, notes: null,
  fleetpalOrder: { id: "a0000000-0000-4000-8000-000000000001", referenceNumber: "RS-1042", description: "Ratchet straps", total: 212.4, createdAt: null },
  itemCount: 1, paperCount: 1, createdAt: "2026-10-03T12:00:00Z", createdByName: "Shop Lead", supersededBy: null,
  items: [{ id: "b0000000-0000-4000-8000-000000000001", displayNo: "A-0412", name: "Cab tablet", assetTypeName: "Tablet", purchaseCost: 412.05 }],
  ...over,
});
const data = ref<EquipmentPurchaseDetail | undefined>(bill());
const papers = ref<DocumentRow[]>([]);
vi.mock("./usePurchases", async () => {
  const { ref: r } = await import("vue");
  return {
    usePurchaseQuery: () => ({ data, isLoading: r(false), isError: r(false), error: r(null), isFetching: r(false), refetch: vi.fn() }),
    usePurchaseDocumentsQuery: () => ({ data: papers }),
    useFileInvoicePaper: () => ({ isPending: r(false), mutateAsync: vi.fn() }),
  };
});
let manager = true;
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => manager }) }));
vi.mock("./InvoiceDrawer.vue", () => ({ default: { name: "InvoiceDrawer", props: ["open", "correcting"], template: "<div data-test='correct-form' />" } }));

const InvoiceDetailDrawer = (await import("./InvoiceDetailDrawer.vue")).default;
const DocumentPreview = (await import("@/components/DocumentPreview.vue")).default;

const open = () =>
  mount(InvoiceDetailDrawer, {
    props: { open: true, purchaseId: BILL },
    global: {
      stubs: { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" }, FileDropzone: true, DocumentPreview: true, RouterLink: RouterLinkStub },
    },
  });

beforeEach(() => {
  setActivePinia(createPinia());
  data.value = bill();
  papers.value = [];
  manager = true;
});

describe("one invoice", () => {
  it("says what the bill says, its FleetPal order, and links each item to its page", () => {
    const w = open();
    const text = w.text();
    for (const s of ["AT&T Business", "INV-1001", "10/02/2026", "$4,120.50", "RS-1042 · Ratchet straps", "Shop Lead", "No paper filed yet."]) {
      expect(text).toContain(s);
    }
    expect(w.findComponent(RouterLinkStub).props("to")).toBe("/shop/assets/b0000000-0000-4000-8000-000000000001");
  });

  it("offers Correct to the shop's managers, and opens the form inside this drawer", async () => {
    const w = open();
    await w.get('[data-test="invoice-correct"]').trigger("click");
    await flushPromises();
    expect(w.findComponent({ name: "InvoiceDrawer" }).props("correcting")).toMatchObject({ id: BILL });

    manager = false;
    expect(open().find('[data-test="invoice-correct"]').exists()).toBe(false);
  });

  it("says a corrected bill was corrected, opens the newer one, and offers no second correction", async () => {
    data.value = bill({ supersededBy: NEWER });
    const w = open();
    expect(w.get('[data-test="invoice-superseded"]').text()).toContain("This invoice was corrected.");
    expect(w.find('[data-test="invoice-correct"]').exists()).toBe(false);
    await w.findAll("button").find((b) => b.text() === "Open the corrected one")!.trigger("click");
    expect(w.emitted("open-invoice")).toEqual([[NEWER]]);
  });

  it("downloads the paper through this bill's own route", async () => {
    papers.value = [{ id: "d0000000-0000-4000-8000-000000000001", createdAt: "2026-10-03T12:00:00Z" } as DocumentRow];
    const w = open();
    await w.findAll("button").find((b) => b.text() === "View")!.trigger("click");
    expect(w.findComponent(DocumentPreview).props("downloadPath")).toBe(
      `/api/maintenance/inventory/purchases/${BILL}/documents/d0000000-0000-4000-8000-000000000001/download`,
    );
  });
});
