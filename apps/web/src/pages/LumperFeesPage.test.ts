import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { LumperCaseRow, LumperCasesResponse } from "@silvicom/shared";
import LumperFeesPage from "./LumperFeesPage.vue";

/**
 * The Lumper fees page (LUMPER-REVISED-RC-PLAN D-LRC5, D-LRC10): the list says where and what we paid and
 * whether the revised RC is on file, the oldest open case comes first, a stale or missing McLeod read is
 * said out loud, and a case opens in a drawer addressed by the URL. `useMediaQuery` is stubbed so
 * DataTable renders a table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const aCase = (o: Partial<LumperCaseRow>): LumperCaseRow => ({
  id: "c1", companyId: "TMS", orderId: "0291013", chargeCode: "LUM", state: "waiting_for_rc", open: true, openedAt: "2020-01-02T12:00:00Z",
  customerName: "A Broker", dispatcherUserId: "kane", dispatcherName: "Kane", consigneeName: "A Warehouse", consigneeCity: "Joliet", consigneeState: "IL",
  deliveredAt: "2020-01-01T00:00:00Z", driverCode: "DRV1", paidAmount: 310, paidAt: "2020-01-02T00:00:00Z", references: ["EFS-77"], chargeAmount: 310,
  chargeDescriptions: ["Unloading"], billedAmount: 0, shortAmount: 0, invoiced: false, lastInvoiceNo: null, lastInvoiceAt: null, rcOnFile: false, files: [],
  closedAt: null, closedByName: null, closeReason: null, closeNote: null, ...o,
});
const CASES: LumperCaseRow[] = [
  aCase({ id: "c-new", orderId: "0300002", paidAt: "2020-03-01T00:00:00Z", customerName: "Newer Broker", dispatcherName: null }),
  aCase({ id: "c-old", orderId: "0300001" }),
  aCase({ id: "c-short", orderId: "0300003", paidAt: "2020-02-01T00:00:00Z", state: "billed_short", invoiced: true, billedAmount: 150, shortAmount: 160, lastInvoiceNo: "5512", lastInvoiceAt: "2020-02-05T00:00:00Z", rcOnFile: true,
    files: [{ id: "f1", fileName: "revised-rc.pdf", mime: "application/pdf", byteSize: 1200, uploadedBy: "u1", uploadedByName: "Dana Dispatch", uploadedAt: "2020-02-03T15:00:00Z" }] }),
  aCase({ id: "c-keyed", orderId: "0300004", paidAmount: 0, paidAt: null, chargeAmount: 95, references: [] }),
];

const state = vi.hoisted(() => ({
  error: false,
  scope: null as null | { value: string },
  response: null as unknown,
  acts: [] as Array<{ what: string; args: unknown }>,
}));
vi.mock("@/features/lumper/useLumperCases", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const act = (what: string) => () => ({ isPending: ref(false), mutateAsync: async (args: unknown) => void state.acts.push({ what, args }) });
  return {
    ...actual,
    useLumperCasesQuery: (scope: { value: string }) => (state.scope = scope, {
      data: ref(state.error ? undefined : state.response),
      isLoading: ref(false),
      isFetching: ref(false),
      isError: ref(state.error),
      refetch: vi.fn(),
    }),
    useFileRevisedRc: act("file"),
    useRemoveRevisedRc: act("remove"),
    useCloseLumperCase: act("close"),
    useReopenLumperCase: act("reopen"),
  };
});

const response = (o: Partial<LumperCasesResponse> = {}): LumperCasesResponse => ({ cases: CASES, unmatchedPayments: [], sweptAt: new Date().toISOString(), ...o });

async function mountPage(url = "/lumper-fees", r: LumperCasesResponse = response()) {
  state.response = r;
  state.acts.length = 0;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lumper-fees", component: LumperFeesPage }] });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(LumperFeesPage, { global: { plugins: [router, pinia] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}
const orderCells = (w: Awaited<ReturnType<typeof mountPage>>["w"]) => w.findAll("tbody tr").map((tr) => tr.find("td").text());

describe("LumperFeesPage", () => {
  it("lists the cases oldest first, with the broker, the place, what was paid and whether the RC is in", async () => {
    const { w } = await mountPage();
    expect(orderCells(w).slice(0, 4)).toEqual(["0300001", "0300004", "0300003", "0300002"]);
    const first = w.findAll("tbody tr")[0]!.text();
    expect(first).toContain("A Broker");
    expect(first).toContain("A Warehouse · Joliet, IL");
    expect(first).toContain("$310.00");
    expect(first).toContain("Missing");
    expect(first).toContain("Waiting for revised RC");
    const short = w.findAll("tbody tr")[2]!.text();
    expect(short).toContain("On file");
    expect(short).toContain("Billed short");
    expect(w.text()).toContain("Unassigned");
    expect(w.find('[data-test="waiting-money"]').text()).toContain("$1,025.00");
  });

  it("marks an amount the dispatcher keyed that payroll has not paid yet", async () => {
    const { w } = await mountPage();
    const keyed = w.findAll("tbody tr")[1]!.text();
    expect(keyed).toContain("$95.00");
    expect(keyed).toContain("keyed");
  });

  it("asks for the open cases, and for every case when the URL says to show closed ones", async () => {
    await mountPage();
    expect(state.scope!.value).toBe("open");
    await mountPage("/lumper-fees?show=all");
    expect(state.scope!.value).toBe("all");
  });

  it("narrows by the search and the status in the URL", async () => {
    expect(orderCells((await mountPage("/lumper-fees?search=newer")).w)).toEqual(["0300002"]);
    expect(orderCells((await mountPage("/lumper-fees?state=billed_short")).w)).toEqual(["0300003"]);
    const none = (await mountPage("/lumper-fees?search=zzz")).w;
    expect(none.text()).toContain("No lumper case matches these filters.");
  });

  it("says so when McLeod has never been read or was last read over a day ago, and stays quiet when fresh", async () => {
    const unread = (await mountPage("/lumper-fees", response({ cases: [], sweptAt: null }))).w;
    expect(unread.find('[data-test="feed"]').text()).toContain("No lumper fees have been read from McLeod yet");
    // An empty list before the first read is not "every lumper is invoiced".
    expect(unread.find('[data-test="empty-unread"]').exists()).toBe(true);
    expect(unread.text()).not.toContain("Every lumper we know of");
    expect((await mountPage("/lumper-fees", response({ cases: [] }))).w.text()).toContain("Every lumper we know of");
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect((await mountPage("/lumper-fees", response({ sweptAt: old }))).w.find('[data-test="feed"]').text()).toContain("3 days ago");
    expect((await mountPage()).w.find('[data-test="feed"]').text()).toContain("within the last hour");
  });

  it("shows a failed read as a failure, never as an empty list", async () => {
    state.error = true;
    try {
      const { w } = await mountPage();
      expect(w.text()).toContain("Could not load the lumper fees.");
      expect(w.text()).not.toContain("No open lumper cases");
    } finally {
      state.error = false;
    }
  });

  it("lists lumpers payroll paid with no order number, and hides the section when there are none", async () => {
    expect((await mountPage()).w.find('[data-test="unmatched"]').exists()).toBe(false);
    const { w } = await mountPage("/lumper-fees", response({
      unmatchedPayments: [{ id: "paid:D9", deductCode: "LUM", amount: 90, transactedAt: "2020-03-05T00:00:00Z", referenceNo: null, driverCode: "DRV2", tractorUnit: "702", pending: false }],
    }));
    const section = w.find('[data-test="unmatched"]').text();
    expect(section).toContain("Lumper paid, order unknown");
    expect(section).toContain("$90.00");
    expect(section).toContain("03/05/2020");
    expect(section).toContain("DRV2");
  });

  it("opens the case named in the URL, with where and what we paid and what to do next", async () => {
    await mountPage("/lumper-fees?case=c-short");
    const drawer = document.body.textContent ?? "";
    expect(drawer).toContain("Lumper on order 0300003");
    expect(drawer).toContain("Billed short");
    expect(drawer).toContain("The invoice carries less than we paid.");
    expect(drawer).toContain("EFS-77");
    expect(drawer).toContain("5512 on 02/05/2020");
    expect(drawer).toContain("$160.00");
    expect(drawer).toContain("revised-rc.pdf");
    expect(drawer).toContain("by Dana Dispatch");
  });

  it("puts the clicked case in the URL", async () => {
    const { w, router } = await mountPage();
    await w.findAll("tbody tr")[0]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.case).toBe("c-old");
  });

  it("closes a case only with a reason from the list", async () => {
    await mountPage("/lumper-fees?case=c-old");
    const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel);
    q<HTMLButtonElement>('[data-test="close-start"]')!.click();
    await flushPromises();
    expect(q<HTMLButtonElement>('[data-test="close-confirm"]')!.disabled).toBe(true);
    expect(state.acts).toEqual([]);
  });
});
