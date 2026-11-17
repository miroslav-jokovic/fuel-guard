import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import type { LumperCaseRow } from "@silvicom/shared";
import LumperOnLoadCard from "./LumperOnLoadCard.vue";

/**
 * The lumper case on the load page (LUMPER-REVISED-RC-PLAN LRC3): shown for a McLeod load that has one,
 * to somebody who can open Lumper fees, and linking to the case there; nothing at all otherwise.
 */
const state = vi.hoisted(() => ({ opens: true, found: null as unknown, asked: [] as { order: string | null; enabled: boolean }[] }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => (to: string) => state.opens && to === "/lumper-fees" }));
vi.mock("./useLumperCases", () => ({
  useLumperCaseForOrder: (orderId: Ref<string | null>, enabled: Ref<boolean>) => {
    state.asked.push({ order: orderId.value, enabled: enabled.value });
    return { lumperCase: ref(enabled.value ? state.found : null) };
  },
}));

const aCase = (o: Partial<LumperCaseRow> = {}) => ({ id: "c-1", orderId: "0291013", state: "billed_no_rc", paidAmount: 310, chargeAmount: 310, rcOnFile: false, ...o }) as LumperCaseRow;

async function mountCard(props: { orderId: string; fromMcleod: boolean }) {
  state.asked.length = 0;
  return mount(LumperOnLoadCard, { props, global: { stubs: { RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } } } });
}

describe("LumperOnLoadCard", () => {
  it("shows what was paid, whether the RC is in and the status, and links to the case", async () => {
    state.opens = true;
    state.found = aCase();
    const w = await mountCard({ orderId: "0291013", fromMcleod: true });
    expect(state.asked).toEqual([{ order: "0291013", enabled: true }]);
    const card = w.find('[data-testid="lumper-on-load"]');
    expect(card.text()).toContain("$310.00 paid");
    expect(card.text()).toContain("revised RC missing");
    expect(card.text()).toContain("Billed, no revised RC");
    expect(card.find("a").attributes("href")).toBe("/lumper-fees?show=all&case=c-1");
  });

  it("does not even ask for a load that is not from McLeod, or for somebody who cannot open Lumper fees", async () => {
    state.found = aCase();
    expect((await mountCard({ orderId: "MAN-1", fromMcleod: false })).find('[data-testid="lumper-on-load"]').exists()).toBe(false);
    expect(state.asked[0]!.enabled).toBe(false);
    state.opens = false;
    expect((await mountCard({ orderId: "0291013", fromMcleod: true })).find('[data-testid="lumper-on-load"]').exists()).toBe(false);
    expect(state.asked[0]!.enabled).toBe(false);
    state.opens = true;
  });

  it("draws nothing for a McLeod load with no lumper", async () => {
    state.found = null;
    expect((await mountCard({ orderId: "0291014", fromMcleod: true })).html()).not.toContain("Lumper");
  });
});
