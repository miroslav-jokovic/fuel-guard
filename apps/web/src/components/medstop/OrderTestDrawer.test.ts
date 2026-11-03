import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { MedstopOrderInput } from "@silvicom/shared";

/**
 * The order drawer (MEDSTOP-PLAN.md §7A.4, UX3). Pinned: it is two steps — nothing is placed until
 * the review has been shown — the review says Med-Stop will not text or e-mail the driver and names the
 * office contact the order carries (owner answer 5), and with ordering switched off it orders nothing.
 * UX4: seeded with an applicant it orders PRE-EMPLOYMENT on that Med-Stop id, with no selection and no
 * truck to search near. UX5d: from the header, a return-to-duty drug test is searched with its reason
 * and person (its sites are matched to the donor) and reviewed as observed — never naming a gender.
 */
const api = vi.hoisted(() => ({
  context: { enabled: true, contactSet: true, people: [{ medstopId: "EE-ANN", driverId: "d-ann", name: "Ann Pooled" }], today: "2026-11-06", timeZone: "America/Denver", goBy: { requestDate: "2026-11-10", requestTime: "16:00" } } as unknown,
  previewed: [] as MedstopOrderInput[],
  placed: [] as MedstopOrderInput[],
  searched: [] as Record<string, unknown>[],
  placedAnswer: { requestId: "REQ-1", appointment: null } as { requestId: string; appointment: string | null },
  toasts: [] as string[],
}));
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({ success: (t: string, d?: string) => api.toasts.push(`${t}: ${d ?? ""}`), error: (t: string, d?: string) => api.toasts.push(`ERROR ${t}: ${d ?? ""}`) }),
}));
// The context is a ref the test can swap, because the api's answer may land after the drawer opens.
const live = vi.hoisted(() => ({ context: null as { value: unknown } | null }));
vi.mock("@/composables/useMedstopOrder", () => ({
  useOrderContext: () => {
    live.context = shallowRef(api.context);
    return { data: computed(() => live.context!.value), isLoading: ref(false) };
  },
  searchSites: async (q: Record<string, unknown>) => (api.searched.push(q), { sites: [{ id: "LOC-1", name: "Med-Stop Loop", address: "1 Main St", city: "Chicago", state: "IL", zip: "60601", distance: "1.2 mi", booked: 0 }], near: null }),
  useOrderPreview: () => ({
    isPending: ref(false),
    mutateAsync: async (input: MedstopOrderInput) => {
      api.previewed.push(input);
      return {
        person: { medstopId: input.medstopId, driverId: "d-ann", name: "Ann Pooled" },
        payload: { eeid: input.medstopId, category: "TD", reason: input.reason, dotstatus: "Y", observed: input.reason === "RETURN TO DUTY" ? "Y" : "N", requestdate: input.requestDate,
          requesttime: input.requestTime, locationid: input.locationId, payment: "EMPLOYER", notifyby: input.notifyBy,
          sendsms: "N", sendemail: "N", tosms: "3125550100", toemail: "der@silvicom.test" },
      };
    },
  }),
  usePlaceOrder: () => ({ isPending: ref(false), mutateAsync: async (input: MedstopOrderInput) => (api.placed.push(input), api.placedAnswer) }),
}));

import OrderTestDrawer, { type OrderSeed } from "./OrderTestDrawer.vue";

const selection: OrderSeed = { kind: "selection", selectionId: "SEL-1", medstopId: "EE-ANN", name: "Ann Pooled", service: "drug" };
async function render(seed: OrderSeed = selection) {
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
  api.searched = [];
  api.toasts = [];
  api.context = { enabled: true, contactSet: true, people: [{ medstopId: "EE-ANN", driverId: "d-ann", name: "Ann Pooled" }], today: "2026-11-06", timeZone: "America/Denver", goBy: { requestDate: "2026-11-10", requestTime: "16:00" } };
  api.placedAnswer = { requestId: "REQ-1", appointment: null };
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

  it("orders a pre-employment test on the applicant's Med-Stop id, from the hiring step", async () => {
    await render({ kind: "applicant", medstopId: "EE-APP", name: "Al Applicant" });
    expect(document.body.textContent).toContain("Pre-employment · Al Applicant");
    // An applicant has no truck, and the reason is fixed — the header's reason list is not shown.
    expect(button("Near the truck")).toBeUndefined();
    expect(document.body.textContent).not.toContain("Reasonable suspicion");
    await pickSite();
    button("Review order")!.click();
    await flushPromises();
    expect(document.body.textContent).toContain("Med-Stop will not text or e-mail the applicant");
    button("Place order")!.click();
    await flushPromises();
    expect(api.placed).toHaveLength(1);
    expect(api.placed[0]).toMatchObject({ medstopId: "EE-APP", reason: "PRE-EMPLOYMENT", service: "drug" });
    expect(api.placed[0]).not.toHaveProperty("selectionId");
  });

  it("orders an observed return-to-duty test from the header: searched for this donor, reviewed as observed, no gender shown", async () => {
    await render(null as unknown as OrderSeed);
    const reason = document.body.querySelector("select") as HTMLSelectElement;
    expect([...reason.options].filter((o) => o.value).map((o) => o.textContent?.trim())).toEqual(["Post-accident", "Reasonable suspicion", "Return to duty", "Follow-up"]);
    reason.value = "RETURN TO DUTY";
    reason.dispatchEvent(new Event("change"));
    await flushPromises();
    const zip = field('input[placeholder="60601"]');
    zip.value = "60601";
    zip.dispatchEvent(new Event("input"));
    await flushPromises();
    // Its sites depend on who is tested, so there is no search before the driver is picked.
    expect(button("Search")!.disabled).toBe(true);
    const driver = field('input[placeholder="Search a name"]');
    driver.click();
    driver.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    button("Search")!.click();
    await flushPromises();
    expect(api.searched[0]).toMatchObject({ reason: "RETURN TO DUTY", medstopId: "EE-ANN", service: "drug", zip: "60601" });
    button("Review order")!.click();
    await flushPromises();
    expect(api.previewed[0]).toMatchObject({ reason: "RETURN TO DUTY", medstopId: "EE-ANN" });
    expect(document.body.textContent).toContain("Return to duty · DOT, observed (same-gender observer)");
    expect(document.body.textContent).not.toMatch(/\b(fe)?male\b/i);
  });

  it("drops the sites found when the reason changes — an observed test's sites are not an unobserved one's", async () => {
    await render(null as unknown as OrderSeed);
    const driver = field('input[placeholder="Search a name"]');
    driver.click();
    driver.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    await pickSite();
    expect(document.body.textContent).toContain("Med-Stop Loop");
    const reason = document.body.querySelector("select") as HTMLSelectElement;
    reason.value = "FOLLOW-UP";
    reason.dispatchEvent(new Event("change"));
    await flushPromises();
    expect(document.body.textContent).not.toContain("Med-Stop Loop");
  });

  it("orders nothing while ordering is switched off, and says where to switch it on", async () => {
    api.context = { enabled: false, contactSet: false, people: [] };
    await render();
    expect(document.body.textContent).toContain("Ordering is switched off");
    expect(button("Review order")!.disabled).toBe(true);
  });

  it("asks for a 'Go by' deadline, defaulting to the api's next business day at 4 pm on the carrier's clock (D-MSO2)", async () => {
    await render();
    expect(document.body.textContent).toContain("Go by");
    expect(document.body.textContent).toContain("may go any time before this");
    expect(field('input[type="time"]').value).toBe("16:00");
    await pickSite();
    button("Review order")!.click();
    await flushPromises();
    // The api's answer, not the laptop's own computation (which would say Monday 11/09).
    expect(api.previewed[0]).toMatchObject({ requestDate: "2026-11-10", requestTime: "16:00" });
    expect(document.body.textContent).toContain("11/10/2026 4:00 PM");
  });

  it("takes the api's 'Go by' when it lands after the drawer opened, unless the office already changed it", async () => {
    api.context = undefined;
    await render();
    live.context!.value = { enabled: true, contactSet: true, people: [], today: "2026-11-06", timeZone: "America/Denver", goBy: { requestDate: "2026-11-10", requestTime: "15:00" } };
    await flushPromises();
    expect(field('input[type="time"]').value).toBe("15:00");

    api.context = undefined;
    document.body.innerHTML = "";
    await render();
    const time = field('input[type="time"]');
    time.value = "11:00";
    time.dispatchEvent(new Event("input"));
    await flushPromises();
    live.context!.value = { enabled: true, contactSet: true, people: [], today: "2026-11-06", timeZone: "America/Denver", goBy: { requestDate: "2026-11-10", requestTime: "15:00" } };
    await flushPromises();
    expect(field('input[type="time"]').value).toBe("11:00");
  });

  it("starts the hiring step's site search at the applicant's Part 1 home ZIP (D-MSO2)", async () => {
    await render({ kind: "applicant", medstopId: "EE-APP", name: "Al Applicant", zip: "73301" });
    expect(field('input[placeholder="60601"]').value).toBe("73301");
    button("Search")!.click();
    await flushPromises();
    expect(api.searched[0]).toMatchObject({ zip: "73301", reason: "PRE-EMPLOYMENT" });
  });

  it("says the step's appointment was filled from the order — or that it must be written by hand (D-MSO1)", async () => {
    const order = async (appointment: string | null) => {
      api.placedAnswer = { requestId: "REQ-1", appointment };
      api.toasts = [];
      const w = await render({ kind: "applicant", medstopId: "EE-APP", name: "Al Applicant", zip: "60601" });
      button("Search")!.click();
      await flushPromises();
      button("Review order")!.click();
      await flushPromises();
      button("Place order")!.click();
      await flushPromises();
      return w;
    };
    const filled = await order("filled");
    expect(api.toasts.join()).toContain("appointment now holds the site, the deadline and the code");
    expect(filled.emitted("placed")).toHaveLength(1);
    await order("site_unread");
    expect(api.toasts.join()).toContain("could not be copied into the appointment");
  });
});
