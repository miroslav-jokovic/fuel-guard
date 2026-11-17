import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { TollStatementDto } from "@silvicom/shared";
import TollsPage from "./TollsPage.vue";

/**
 * The Tolls page (TOLLS-PER-TRUCK-PLAN.md TL4a): the statements uploaded, newest first, each saying in
 * words whether its tolls have been read; removed files hidden until asked for and then crossed off;
 * a statement opens in a drawer addressed by the URL, where a wrong file is removed only with a reason;
 * and only accounting's managers see the upload. `useMediaQuery` is stubbed so DataTable renders a
 * table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const aStatement = (o: Partial<TollStatementDto>): TollStatementDto => ({
  id: "s1", provider: "ezpass", fileName: "EZ June wk1.pdf", format: "pdf", byteSize: 2048, uploadedAt: "2026-11-17T15:00:00Z",
  uploadedByName: "Bea Books", periodStart: null, periodEnd: null, printedTotal: null, readAt: null,
  removedAt: null, removedByName: null, removeReason: null, ...o,
});
const LIST: TollStatementDto[] = [
  aStatement({ id: "s-new" }),
  aStatement({ id: "s-ktag", provider: "ktag", fileName: "ktag-june.xlsx", format: "xlsx", byteSize: 3 * 1024 * 1024, uploadedAt: "2026-11-16T15:00:00Z", uploadedByName: null }),
  aStatement({ id: "s-gone", fileName: "wrong company.pdf", uploadedAt: "2026-11-15T15:00:00Z", removedAt: "2026-11-16T10:00:00Z", removedByName: "Bea Books", removeReason: "another company's statement" }),
];

const state = vi.hoisted(() => ({
  error: false,
  list: [] as unknown[],
  manage: true,
  removed: [] as unknown[],
}));
vi.mock("@/features/tolls/useTollStatements", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useTollStatementsQuery: () => ({
      data: ref(state.error ? undefined : state.list),
      isLoading: ref(false),
      isFetching: ref(false),
      isError: ref(state.error),
      refetch: vi.fn(),
    }),
    useUploadTollStatement: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
    useRemoveTollStatement: () => ({ isPending: ref(false), mutateAsync: async (args: unknown) => void state.removed.push(args) }),
  };
});
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: (s: string) => s === "accounting" && state.manage, canView: () => true }),
}));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));

async function mountPage(url = "/tolls", list: TollStatementDto[] = LIST) {
  state.list = list;
  state.removed.length = 0;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/tolls", component: TollsPage }] });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(TollsPage, { global: { plugins: [router, pinia] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}
const fileCells = (w: Awaited<ReturnType<typeof mountPage>>["w"]) => w.findAll("tbody tr").map((tr) => tr.findAll("td")[2]!.find("span").text());

describe("TollsPage", () => {
  it("lists the kept statements newest first, with provider, the format the bytes showed, who uploaded and 'Not read yet'", async () => {
    const { w } = await mountPage();
    expect(fileCells(w)).toEqual(["EZ June wk1.pdf", "ktag-june.xlsx"]);
    const first = w.findAll("tbody tr")[0]!.text();
    expect(first).toContain("11/17/2026");
    expect(first).toContain("E-ZPass");
    expect(first).toContain("PDF · 2 KB");
    expect(first).toContain("Bea Books");
    expect(first).toContain("Not read yet");
    expect(w.findAll("tbody tr")[1]!.text()).toContain("Excel · 3.0 MB");
  });

  it("says how many statements are kept but not read, and says nothing once all are read", async () => {
    expect((await mountPage()).w.find('[data-test="statements-unread"]').text()).toContain("2 statements are kept but not read yet");
    const read = LIST.map((s) => ({ ...s, readAt: "2026-11-20T00:00:00Z", periodStart: "2026-06-01", periodEnd: "2026-06-07" }));
    const w = (await mountPage("/tolls", read)).w;
    expect(w.find('[data-test="statements-unread"]').exists()).toBe(false);
    expect(w.findAll("tbody tr")[0]!.text()).toContain("06/01/2026 – 06/07/2026");
  });

  it("hides removed files until asked, then shows them crossed off", async () => {
    expect(fileCells((await mountPage()).w)).not.toContain("wrong company.pdf");
    const w = (await mountPage("/tolls?show=removed")).w;
    const gone = w.findAll("tbody tr")[2]!;
    expect(gone.text()).toContain("Removed");
    expect(gone.findAll("td")[2]!.find("span").classes()).toContain("line-through");
  });

  it("narrows by the search and the provider in the URL", async () => {
    expect(fileCells((await mountPage("/tolls?search=ktag")).w)).toEqual(["ktag-june.xlsx"]);
    expect(fileCells((await mountPage("/tolls?provider=ezpass")).w)).toEqual(["EZ June wk1.pdf"]);
    expect((await mountPage("/tolls?search=zzz")).w.text()).toContain("No statement matches these filters.");
  });

  it("offers the upload to accounting's managers only", async () => {
    state.manage = true;
    expect((await mountPage()).w.find('[data-test="statements-upload"]').exists()).toBe(true);
    state.manage = false;
    const w = (await mountPage("/tolls", [])).w;
    expect(w.find('[data-test="statements-upload"]').exists()).toBe(false);
    expect(w.find('[data-test="statements-empty"]').text()).toBe("No toll statements uploaded yet.");
    state.manage = true;
  });

  it("shows a failed read as a failure, never as an empty list", async () => {
    state.error = true;
    const w = (await mountPage()).w;
    expect(w.text()).toContain("Could not load the toll statements.");
    expect(w.text()).not.toContain("No toll statements uploaded yet.");
    state.error = false;
  });

  it("opens a statement from its row, and removes a wrong file only with a reason", async () => {
    const { w, router } = await mountPage();
    await w.findAll("tbody tr")[0]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.statement).toBe("s-new");
    const drawer = document.body;
    expect(drawer.querySelector('[data-test="statement-unread"]')?.textContent).toContain("once the E-ZPass reader is built");
    (drawer.querySelector('[data-test="statement-remove"]') as HTMLButtonElement).click();
    await flushPromises();
    const confirm = () => drawer.querySelector('[data-test="statement-remove-confirm"]') as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    const reason = drawer.querySelector('[data-test="statement-remove-reason"]') as HTMLTextAreaElement;
    reason.value = "  wrong provider picked ";
    reason.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(confirm().disabled).toBe(false);
    confirm().click();
    await flushPromises();
    expect(state.removed).toEqual([{ id: "s-new", reason: "wrong provider picked" }]);
    w.unmount();
  });

  it("offers no removal to a reader, nor on a file already removed", async () => {
    state.manage = false;
    let w = (await mountPage("/tolls?statement=s-new")).w;
    expect(document.body.querySelector('[data-test="statement-open"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="statement-remove"]')).toBeNull();
    w.unmount();
    state.manage = true;
    w = (await mountPage("/tolls?show=removed&statement=s-gone")).w;
    expect(document.body.querySelector('[data-test="statement-removed"]')?.textContent).toContain("another company's statement");
    expect(document.body.querySelector('[data-test="statement-remove"]')).toBeNull();
    w.unmount();
  });
});
