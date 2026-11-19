import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { TollStatementDto, TransponderDto } from "@silvicom/shared";
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
  removedAt: null, removedByName: null, removeReason: null, lastRead: null, ...o,
});
/** A statement the server read and tied (TL4b), as the API returns it. */
const aRead = (o: Partial<TollStatementDto> = {}): TollStatementDto =>
  aStatement({
    readAt: "2026-11-18T16:00:00Z", periodStart: "2026-06-27", periodEnd: "2026-07-26", printedTotal: 40144.28,
    lastRead: {
      outcome: "read", message: null, readAt: "2026-11-18T16:00:00Z", readByName: "Bea Books", accountEnding: "4126", lineCount: 2657,
      tollLineCount: 2651, tollCents: 4014328,
      ties: [
        { label: "Ending Balance", printedCents: 175460, readCents: 175460 },
        { label: "Tolls, Non-Tolls and Fees", printedCents: 4014428, readCents: 4014428 },
      ],
    },
    ...o,
  });
const aRefused = (o: Partial<TollStatementDto> = {}): TollStatementDto =>
  aStatement({
    lastRead: {
      outcome: "refused", message: "This E-ZPass statement does not add up as read, so nothing was taken from it. Ending Balance: printed $1.00, read $2.00.",
      readAt: "2026-11-18T16:00:00Z", readByName: "Bea Books", accountEnding: null, lineCount: null, tollLineCount: null, tollCents: null, ties: [],
    },
    ...o,
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
  readIds: [] as string[],
  readReturns: null as unknown,
  equipment: "manage" as "manage" | "view" | "none",
  tags: [] as unknown[],
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
    useReadTollStatement: () => ({ isPending: ref(false), mutateAsync: async (id: string) => (state.readIds.push(id), state.readReturns) }),
  };
});
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    can: (s: string) => (s === "accounting" ? state.manage : s === "equipment" ? state.equipment === "manage" : false),
    canView: (s: string) => (s === "equipment" ? state.equipment !== "none" : true),
  }),
}));
vi.mock("@/features/tolls/useTollTags", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const m = () => ({ isPending: ref(false), mutateAsync: vi.fn() });
  return {
    ...actual,
    useTollTagsQuery: () => ({ data: ref(state.tags), isLoading: ref(false), isFetching: ref(false), isError: ref(false), refetch: vi.fn() }),
    useTollTagWrites: () => ({ register: m(), move: m(), retire: m(), voidEntry: m() }),
  };
});
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/features/tolls/useTollTagImport", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useImportTollTags: () => ({ run: vi.fn(), sent: ref(0), running: ref(false) }) };
});
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
    expect(drawer.querySelector('[data-test="statement-unread"]')?.textContent).toContain("do not count until it is read and adds up to every total it prints");
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

  describe("reading a statement (TL4b)", () => {
    it("shows a read statement's tolls, total and account ending in the list, and every tie in the drawer", async () => {
      const w = (await mountPage("/tolls?statement=s1", [aRead({ id: "s1" })])).w;
      const row = w.findAll("tbody tr")[0]!;
      expect(row.text()).toContain("Read, adds up");
      expect(row.find('[data-test="read-summary"]').text()).toBe("2,651 tolls · $40,143.28 · account …4126");
      const ties = document.body.querySelector('[data-test="statement-ties"]')!.textContent!;
      expect(ties).toContain("Ending Balance");
      expect(ties).toContain("$40,144.28 printed · $40,144.28 read");
      // A read statement is never read again in place (0633): no Read button.
      expect(document.body.querySelector('[data-test="statement-read"]')).toBeNull();
      expect(w.find('[data-test="statements-unread"]').exists()).toBe(false);
      w.unmount();
    });

    it("names a refused statement apart from an unread one, with the reader's sentence and no tolls", async () => {
      const w = (await mountPage("/tolls?statement=s1", [aRefused({ id: "s1" }), aStatement({ id: "s2", fileName: "other.pdf" })])).w;
      expect(w.findAll("tbody tr")[0]!.text()).toContain("Could not be read");
      expect(w.find('[data-test="statements-refused"]').text()).toContain("1 statement could not be read");
      expect(w.find('[data-test="statements-unread"]').text()).toContain("1 statement is kept but not read yet");
      expect(document.body.querySelector('[data-test="statement-refused"]')!.textContent).toContain("Ending Balance: printed $1.00, read $2.00");
      expect(w.find('[data-test="read-summary"]').exists()).toBe(false);
      w.unmount();
    });

    it("lets accounting's managers read an unread statement, and nobody else", async () => {
      state.readIds = [];
      state.readReturns = aRead({ id: "s1" });
      let w = (await mountPage("/tolls?statement=s1", [aStatement({ id: "s1" })])).w;
      (document.body.querySelector('[data-test="statement-read"]') as HTMLButtonElement).click();
      await flushPromises();
      expect(state.readIds).toEqual(["s1"]);
      w.unmount();
      state.manage = false;
      w = (await mountPage("/tolls?statement=s1", [aStatement({ id: "s1" })])).w;
      expect(document.body.querySelector('[data-test="statement-read"]')).toBeNull();
      w.unmount();
      state.manage = true;
    });
  });

  describe("the Toll tags tab", () => {
    const entry = (id: string, vehicleId: string, unitNumber: string, validFrom: string, validTo: string | null = null) => ({
      id, vehicleId, unitNumber, validFrom, validTo, voidedAt: null, voidReason: null,
    });
    const aTag = (o: Partial<TransponderDto>): TransponderDto => ({
      id: "t1", provider: "ezpass", tagNumber: "00812345678", issuer: "NJ E-ZPass", note: null, retiredAt: null, retiredReason: null,
      currentVehicleId: "v654", history: [entry("a1", "v654", "654", "2026-05-14T05:00:00Z")], ...o,
    });
    const TAGS = [
      aTag({}),
      aTag({ id: "t2", provider: "ktag", tagNumber: "KT0000777", issuer: null, currentVehicleId: null, history: [entry("a2", "v702", "702", "2026-03-01T06:00:00Z", "2026-06-01T05:00:00Z")] }),
      aTag({ id: "t3", tagNumber: "00899990000", retiredAt: "2026-09-01T05:00:00Z", retiredReason: "lost", currentVehicleId: null, history: [] }),
    ];
    const tagCells = (w: Awaited<ReturnType<typeof mountPage>>["w"]) => w.findAll("tbody tr").map((tr) => tr.findAll("td")[0]!.find("span").text());

    it("lists every tag in use with its truck and since when, retired tags only when asked", async () => {
      state.tags = TAGS;
      const { w } = await mountPage("/tolls?view=tags");
      expect(tagCells(w)).toEqual(["E-ZPass 00812345678", "K-TAG KT0000777"]);
      const first = w.findAll("tbody tr")[0]!.text();
      expect(first).toContain("Unit 654");
      expect(first).toContain("05/14/2026");
      expect(first).toContain("On a truck");
      expect(w.findAll("tbody tr")[1]!.text()).toContain("Not on a truck");
      expect(tagCells((await mountPage("/tolls?view=tags&status=retired")).w)).toEqual(["E-ZPass 00899990000"]);
    });

    it("finds a tag by its number without the leading zeros a statement drops, typed with dashes and spaces, or by its truck", async () => {
      state.tags = TAGS;
      expect(tagCells((await mountPage("/tolls?view=tags&search=812345678")).w)).toEqual(["E-ZPass 00812345678"]);
      expect(tagCells((await mountPage("/tolls?view=tags&search=654")).w)).toEqual(["E-ZPass 00812345678"]);
      expect(tagCells((await mountPage(`/tolls?view=tags&search=${encodeURIComponent("008-1234 5678")}`)).w)).toEqual(["E-ZPass 00812345678"]);
    });

    it("offers import and add to equipment's managers, and the upload on the statements tab only", async () => {
      state.tags = TAGS;
      let w = (await mountPage("/tolls?view=tags")).w;
      expect(w.find('[data-test="tags-import"]').exists()).toBe(true);
      expect(w.find('[data-test="tags-add"]').exists()).toBe(true);
      expect(w.find('[data-test="statements-upload"]').exists()).toBe(false);
      state.equipment = "view";
      w = (await mountPage("/tolls?view=tags")).w;
      expect(w.find('[data-test="tags-import"]').exists()).toBe(false);
      expect(tagCells(w)).toHaveLength(2);
      state.equipment = "manage";
    });

    it("shows no tag tab to someone who may not view equipment, even from a link", async () => {
      state.equipment = "none";
      const w = (await mountPage("/tolls?view=tags")).w;
      expect(w.find('[role="tablist"]').exists()).toBe(false);
      expect(fileCells(w)).toEqual(["EZ June wk1.pdf", "ktag-june.xlsx"]);
      state.equipment = "manage";
    });

    it("clears the other tab's filters and open drawer when switching", async () => {
      state.tags = TAGS;
      const { w, router } = await mountPage("/tolls?search=ktag&statement=s-new");
      const tab = w.findAll('[role="tab"]').find((t) => t.text().startsWith("Toll tags"))!;
      await tab.trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ view: "tags" });
      w.unmount();
    });

    it("opens a tag's history from its row", async () => {
      state.tags = TAGS;
      const { w, router } = await mountPage("/tolls?view=tags");
      await w.findAll("tbody tr")[1]!.trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query.tag).toBe("t2");
      expect(document.body.querySelector('[data-test="toll-tag-history"]')?.textContent).toContain("Unit 702");
      expect(document.body.querySelector('[data-test="tag-move"]')).not.toBeNull();
      w.unmount();
    });
  });
});
