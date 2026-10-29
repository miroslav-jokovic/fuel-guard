import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { EquipmentPurchaseDetail, EquipmentPurchaseInput } from "@silvicom/shared";

/**
 * Add invoice / Correct the invoice (M10b, 0530).
 *
 * What this drawer can get wrong that the API's tests cannot see:
 *   1. **Minting the id per attempt.** A retry after a failure must send the SAME id (D-INV27), or a
 *      save pressed twice records the bill twice.
 *   2. **A correction that sends only the changes.** It must name the bill it replaces and carry the
 *      whole item list — the database clears any item the list leaves out.
 *   3. **A FleetPal-bought invoice saved with no order**, or an outside one that still carries one.
 *   4. **Losing a saved bill when only its paper failed** — the bill landed; the drawer must say so and
 *      hand it on, not read as though nothing was saved.
 */

const sent: Array<{ bill: EquipmentPurchaseInput; paper: File | null }> = [];
let answer: (input: { bill: EquipmentPurchaseInput }) => Promise<unknown> = async ({ bill }) => ({ ...bill, items: [], itemCount: 0 });
vi.mock("./usePurchases", async () => {
  const { ref: r } = await import("vue");
  return {
    useRecordPurchase: () => ({
      isPending: r(false),
      mutateAsync: async (input: { bill: EquipmentPurchaseInput; paper: File | null }) => {
        sent.push(input);
        return answer(input);
      },
    }),
    useFleetpalOrdersQuery: () => ({
      data: r([{ id: "a0000000-0000-4000-8000-000000000001", referenceNumber: "RS-1042", description: "Ratchet straps", total: 212.4, createdAt: null }]),
      isFetching: r(false),
    }),
  };
});
const A1 = "b0000000-0000-4000-8000-000000000001";
const A2 = "b0000000-0000-4000-8000-000000000002";
vi.mock("./useAssets", async () => {
  const { ref: r } = await import("vue");
  return {
    useAssetsQuery: () => ({
      data: r({
        assets: [
          { id: A1, displayNo: "A-0412", name: "Cab tablet", purchaseId: null },
          { id: A2, displayNo: "A-0413", name: "Cab tablet", purchaseId: "c0000000-0000-4000-8000-000000000009" },
        ],
        total: 2,
      }),
      isFetching: r(false),
    }),
  };
});
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toasts }));

const InvoiceDrawer = (await import("./InvoiceDrawer.vue")).default;
const { AppCombobox, AppSegmentedControl } = await import("@silvicom/ui");

const mountDrawer = (props: Record<string, unknown> = {}) =>
  mount(InvoiceDrawer, {
    props: { open: true, ...props },
    global: { stubs: { SlideOver: { template: "<div><slot /><slot name='footer' /></div>" }, FileDropzone: true, AppDateField: { props: ["modelValue"], emits: ["update:modelValue"], template: "<input data-test='invoice-date' :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />" } } },
  });

async function fill(w: ReturnType<typeof mountDrawer>) {
  await w.find('[data-test="invoice-vendor"]').setValue("AT&T Business");
  await w.find('[data-test="invoice-number"]').setValue("INV-1001");
  await w.find('[data-test="invoice-date"]').setValue("2026-10-02");
  await w.find('[data-test="invoice-total"]').setValue("$4,120.50");
}
const pick = async (w: ReturnType<typeof mountDrawer>, id: string) => {
  // The item search is the form's last combobox (FleetPal's order, when shown, is the first).
  w.findAllComponents(AppCombobox).at(-1)!.vm.$emit("update:modelValue", id);
  await flushPromises();
};
const save = async (w: ReturnType<typeof mountDrawer>) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};

const CORRECTING: EquipmentPurchaseDetail = {
  id: "c0000000-0000-4000-8000-000000000001", vendor: "AT&T Business", invoiceNumber: "INV-1001", invoiceDate: "2026-10-02",
  total: 4120.5, notes: null, fleetpalOrder: null, itemCount: 2, paperCount: 1, createdAt: "2026-10-03T12:00:00Z",
  createdByName: "Shop Lead", supersededBy: null,
  items: [
    { id: A1, displayNo: "A-0412", name: "Cab tablet", assetTypeName: "Tablet", purchaseCost: null },
    { id: A2, displayNo: "A-0413", name: "Cab tablet", assetTypeName: "Tablet", purchaseCost: null },
  ],
};

beforeEach(() => {
  setActivePinia(createPinia());
  sent.length = 0;
  toasts.success.mockClear();
  toasts.error.mockClear();
  answer = async ({ bill }) => ({ ...bill, items: [], itemCount: 0 });
});

describe("Add invoice", () => {
  it("sends the bill with the items picked, the total read as dollars and cents", async () => {
    const w = mountDrawer();
    await fill(w);
    await pick(w, A1);
    expect(w.find('[data-test="invoice-items"]').text()).toContain("A-0412");
    await save(w);
    expect(sent[0]!.bill).toMatchObject({
      vendor: "AT&T Business", invoiceNumber: "INV-1001", invoiceDate: "2026-10-02", total: 4120.5,
      assetIds: [A1], supersedes: null, fleetpalPurchaseOrderId: null,
    });
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("says an item is already on another invoice before the database refuses it", async () => {
    const w = mountDrawer();
    const options = w.findAllComponents(AppCombobox).at(-1)!.props("options") as Array<{ label: string }>;
    expect(options.map((o) => o.label)).toEqual(["A-0412 · Cab tablet", "A-0413 · Cab tablet — on another invoice"]);
  });

  it("refuses to save without what the invoice prints, and sends nothing", async () => {
    const w = mountDrawer();
    await save(w);
    expect(sent).toHaveLength(0);
    const text = w.text();
    expect(text).toContain("Who sent the bill?");
    expect(text).toContain("The date on the invoice.");
    expect(text).toContain("The total as printed, in dollars and cents.");
  });

  it("sends the same id on a retry after a failure, so the bill is recorded once", async () => {
    answer = async () => {
      throw new Error("Network is down");
    };
    const w = mountDrawer();
    await fill(w);
    await save(w);
    answer = async ({ bill }) => ({ ...bill, items: [] });
    await save(w);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.bill.id).toBe(sent[0]!.bill.id);
    expect(toasts.error).toHaveBeenCalledWith("Could not add the invoice", "Network is down");
  });

  it("mints a new id for the next invoice once the drawer opens again", async () => {
    const w = mountDrawer();
    await fill(w);
    await save(w);
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await fill(w);
    await save(w);
    expect(sent[1]!.bill.id).not.toBe(sent[0]!.bill.id);
  });

  it("asks for FleetPal's order when it was bought through FleetPal, and sends it", async () => {
    const w = mountDrawer();
    await fill(w);
    w.findComponent(AppSegmentedControl).vm.$emit("update:modelValue", "fleetpal");
    await flushPromises();
    await save(w);
    expect(sent).toHaveLength(0);
    expect(w.text()).toContain("Choose FleetPal's purchase order.");
    w.findAllComponents(AppCombobox)[0]!.vm.$emit("update:modelValue", "a0000000-0000-4000-8000-000000000001");
    await flushPromises();
    await save(w);
    expect(sent[0]!.bill.fleetpalPurchaseOrderId).toBe("a0000000-0000-4000-8000-000000000001");
  });

  it("keeps a saved bill whose paper failed, and says so", async () => {
    answer = async ({ bill }) => {
      throw Object.assign(new Error("The invoice was saved, but its paper was not: offline. File it from the invoice."), {
        code: "paper_failed",
        saved: { ...bill, items: [] },
      });
    };
    const w = mountDrawer();
    await fill(w);
    await save(w);
    expect(w.emitted("saved")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
    expect(toasts.error).toHaveBeenCalledWith("The paper was not filed", expect.stringContaining("was saved"));
  });
});

describe("Correct the invoice", () => {
  it("does not call an item on the invoice being corrected 'on another invoice'", () => {
    // A2 belongs to bill …0009 (the assets mock); correcting that bill, it is offered plainly.
    const w = mountDrawer({ correcting: { ...CORRECTING, id: "c0000000-0000-4000-8000-000000000009", items: [CORRECTING.items[0]!] } });
    const options = w.findAllComponents(AppCombobox).at(-1)!.props("options") as Array<{ label: string }>;
    expect(options.map((o) => o.label)).toEqual(["A-0413 · Cab tablet"]);
  });

  it("opens filled from the bill, names the one it replaces and sends the whole item list", async () => {
    const w = mountDrawer({ correcting: CORRECTING });
    expect((w.find('[data-test="invoice-total"]').element as HTMLInputElement).value).toBe("4120.5");
    // A2 is on the bill being corrected, so it is not "on another invoice" here.
    const options = w.findAllComponents(AppCombobox).at(-1)!.props("options") as Array<{ label: string }>;
    expect(options).toHaveLength(0);
    await w.find('[data-test="invoice-total"]').setValue("4210.50");
    await w.findAll("button").find((b) => b.attributes("aria-label") === "Take A-0413 off the invoice")!.trigger("click");
    await save(w);
    expect(sent[0]!.bill).toMatchObject({ supersedes: CORRECTING.id, total: 4210.5, assetIds: [A1] });
    expect(sent[0]!.bill.id).not.toBe(CORRECTING.id);
  });
});
