import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { MedstopCloseInput } from "@silvicom/shared";

/**
 * Closing an open order (MEDSTOP-PLAN.md §7A.21, MSO2, D-MSO3). Pinned: on opening it asks the api what will be
 * sent and shows it — the comment word for word — and nothing is closed until **Close the order**; a reason
 * typed after the review clears it; Med-Stop's refusal is shown and no close is offered; once closed,
 * **Order again** hands back the closed order's person, ZIP and site.
 */
const api = vi.hoisted(() => ({
  previewed: [] as MedstopCloseInput[],
  closed: [] as MedstopCloseInput[],
  previewFails: false,
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: () => {}, error: () => {} }) }));
vi.mock("@/composables/useMedstopOrder", () => ({
  useClosePreview: () => ({
    isPending: ref(false),
    mutateAsync: async (v: { requestId: string; input: MedstopCloseInput }) => {
      api.previewed.push(v.input);
      if (api.previewFails) throw new Error("Med-Stop already has this order as completed, so there is nothing to close.");
      return { requestId: v.requestId, status: v.input.status, comment: `No show: fixed words.${v.input.note ? ` ${v.input.note}` : ""}`, person: "Al Applicant", site: "Concentra Joliet", goBy: "2026-11-04T16:00" };
    },
  }),
  useCloseOrder: () => ({
    isPending: ref(false),
    mutateAsync: async (v: { requestId: string; input: MedstopCloseInput }) => (api.closed.push(v.input), { requestId: v.requestId, status: v.input.status, reorder: { medstopId: "EE-APP", zip: "60435", locationId: "LOC-1" } }),
  }),
}));

import CloseOrderDrawer from "./CloseOrderDrawer.vue";

const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function render() {
  setActivePinia(createPinia());
  const w = mount(CloseOrderDrawer, { props: { open: true, request: { requestId: "REQ-77", status: "NO SHOW" } }, attachTo: document.body });
  await flushPromises();
  return w;
}

beforeEach(() => {
  api.previewed = [];
  api.closed = [];
  api.previewFails = false;
  document.body.innerHTML = "";
});

describe("CloseOrderDrawer", () => {
  it("shows what Med-Stop will receive before anything is closed, then closes once", async () => {
    await render();
    expect(api.previewed).toEqual([{ status: "NO SHOW" }]);
    expect(document.body.textContent).toContain("No show: fixed words.");
    expect(document.body.textContent).toContain("Concentra Joliet · go by 11/04/2026 4:00 PM");
    expect(api.closed).toEqual([]);
    button("Close the order")!.click();
    await flushPromises();
    expect(api.closed).toEqual([{ status: "NO SHOW" }]);
  });

  it("forgets the review when a reason is typed — the comment it showed is no longer the one sent", async () => {
    await render();
    const note = document.body.querySelector('input[placeholder="Optional"]') as HTMLInputElement;
    note.value = "Phoned twice.";
    note.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(button("Close the order")).toBeUndefined();
    button("Check again")!.click();
    await flushPromises();
    expect(document.body.textContent).toContain("No show: fixed words. Phoned twice.");
    button("Close the order")!.click();
    await flushPromises();
    expect(api.closed).toEqual([{ status: "NO SHOW", note: "Phoned twice." }]);
  });

  it("shows Med-Stop's refusal and offers no close", async () => {
    api.previewFails = true;
    await render();
    expect(document.body.textContent).toContain("nothing to close");
    expect(button("Close the order")).toBeUndefined();
  });

  it("offers 'Order again' once closed, with the closed order's person, ZIP and site", async () => {
    const w = await render();
    button("Close the order")!.click();
    await flushPromises();
    button("Order again")!.click();
    expect(w.emitted("orderAgain")).toEqual([[{ medstopId: "EE-APP", zip: "60435", locationId: "LOC-1" }]]);
    expect(w.emitted("closed")).toHaveLength(1);
  });
});
