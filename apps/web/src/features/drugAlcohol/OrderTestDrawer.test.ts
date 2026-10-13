import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { MedstopOrderInput } from "@silvicom/shared";

/**
 * The order drawer (MEDSTOP-PLAN.md §7A.4, UX3). Pinned: it is two steps — nothing is placed until
 * the review has been shown — the review says Med-Stop will not text or e-mail the driver and names the
 * office contact the order carries (owner answer 5), and with ordering switched off it orders nothing.
 */
const api = vi.hoisted(() => ({
  context: { enabled: true, contactSet: true, people: [{ medstopId: "EE-ANN", driverId: "d-ann", name: "Ann Pooled" }] } as unknown,
  previewed: [] as MedstopOrderInput[],
  placed: [] as MedstopOrderInput[],
}));
vi.mock("./useMedstopOrder", () => ({
  useOrderContext: () => ({ data: computed(() => api.context), isLoading: ref(false) }),
  searchSites: async () => ({ sites: [{ id: "LOC-1", name: "Med-Stop Loop", address: "1 Main St", city: "Chicago", state: "IL", zip: "60601", distance: "1.2 mi", booked: 0 }], near: null }),
  useOrderPreview: () => ({
    isPending: ref(false),
    mutateAsync: async (input: MedstopOrderInput) => {
      api.previewed.push(input);
      return {
        person: { medstopId: input.medstopId, driverId: "d-ann", name: "Ann Pooled" },
        payload: { eeid: input.medstopId, category: "TD", reason: input.reason, dotstatus: "Y", observed: "N", requestdate: input.requestDate,
          requesttime: input.requestTime, locationid: input.locationId, payment: "EMPLOYER", notifyby: input.notifyBy,
          sendsms: "N", sendemail: "N", tosms: "3125550100", toemail: "der@silvicom.test" },
      };
    },
  }),
  usePlaceOrder: () => ({ isPending: ref(false), mutateAsync: async (input: MedstopOrderInput) => (api.placed.push(input), { requestId: "REQ-1" }) }),
}));

import OrderTestDrawer from "./OrderTestDrawer.vue";

const seed = { selectionId: "SEL-1", medstopId: "EE-ANN", name: "Ann Pooled", service: "drug" as const };
async function render() {
  setActivePinia(createPinia());
  const w = mount(OrderTestDrawer, { props: { open: true, seed }, attachTo: document.body });
  await flushPromises();
  return w;
}
const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const field = (selector: string) => document.body.querySelector(selector) as HTMLInputElement;

beforeEach(() => {
  api.previewed = [];
  api.placed = [];
  api.context = { enabled: true, contactSet: true, people: [{ medstopId: "EE-ANN", driverId: "d-ann", name: "Ann Pooled" }] };
  document.body.innerHTML = "";
});

async function pickSite() {
  const zip = field('input[placeholder="60601"]');
  zip.value = "60601";
  zip.dispatchEvent(new Event("input"));
  await flushPromises();
  button("Search")!.click();
  await flushPromises();
}

describe("OrderTestDrawer", () => {
  it("reviews before it orders, and the review says the driver is not texted or e-mailed", async () => {
    await render();
    expect(button("Place order")).toBeUndefined();
    await pickSite();
    button("Review order")!.click();
    await flushPromises();
    expect(api.placed).toEqual([]);
    expect(document.body.textContent).toContain("Med-Stop will not text or e-mail the driver");
    expect(document.body.textContent).toContain("der@silvicom.test");
    expect(document.body.textContent).toContain("Billed to the company's Med-Stop credit");
    button("Place order")!.click();
    await flushPromises();
    expect(api.placed).toHaveLength(1);
    // A selection's order is a random test, seeded by that selection.
    expect(api.placed[0]).toMatchObject({ medstopId: "EE-ANN", reason: "RANDOM", selectionId: "SEL-1", locationId: "LOC-1", service: "drug" });
    expect(api.placed[0]).toEqual(api.previewed[0]);
  });

  it("forgets the review when anything changes — a review describes one exact order", async () => {
    await render();
    await pickSite();
    button("Review order")!.click();
    await flushPromises();
    const time = field('input[type="time"]');
    time.value = "14:00";
    time.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(button("Place order")).toBeUndefined();
    expect(button("Review order")).toBeDefined();
  });

  it("orders nothing while ordering is switched off, and says where to switch it on", async () => {
    api.context = { enabled: false, contactSet: false, people: [] };
    await render();
    expect(document.body.textContent).toContain("Ordering is switched off");
    expect(button("Review order")!.disabled).toBe(true);
  });
});
