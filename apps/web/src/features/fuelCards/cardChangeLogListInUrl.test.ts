import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref, type Ref } from "vue";
import type { CardMutationLogFilters } from "./useCardControl";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the Card changes tab keeps its search, window and page in
 * the URL, under `cards.`, because it is a tab of the Audit log page and shares that page's route. The
 * card page's entry link (`?cardId=`) stays unscoped and is never cleared by Clear filters.
 */

const asked = vi.hoisted(() => ({ filters: null as unknown, page: null as unknown }));
vi.mock("./useCardControl", () => ({
  useCardMutationLog: (filters: Ref<CardMutationLogFilters>, page: Ref<number>) => {
    asked.filters = filters;
    asked.page = page;
    return {
      // A row, because DataTable renders its footer — the pagination — only under rows.
      data: ref({ total: 120, mutations: [{ id: "m1", cardId: "c1", maskedRef: "••••7552", unitPrompt: "773", driverName: null, intent: "lock", status: "succeeded", efsFaultMessage: null, createdAt: "2026-09-02T12:00:00Z" }] }), isLoading: ref(false), isError: ref(false), error: ref(null),
      isFetching: ref(false), refetch: vi.fn(),
    };
  },
}));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import CardChangeLog from "./CardChangeLog.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { TablePagination } from "@silvicom/ui";

const filters = () => (asked.filters as Ref<CardMutationLogFilters>).value;
const page = () => (asked.page as Ref<number>).value;

async function mountAt(url: string, cardId?: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/audit", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(CardChangeLog, { props: { cardId }, global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}

describe("Card changes keeps its list in the URL", () => {
  it("reads a pasted link's search, window and page under its own scope", async () => {
    const { w } = await mountAt("/audit?tab=cards&action=invite&cards.search=773&cards.from=2026-09-01&cards.to=2026-09-30&cards.page=3");
    expect(filters()).toEqual({ search: "773", from: "2026-09-01", to: "2026-09-30" });
    expect(page()).toBe(3);
    expect(w.findComponent(TablePagination).props("page")).toBe(3);
  });

  // CCF4 (plan W8): the chip printed the raw query value, `2026-09-01 → 2026-09-30`.
  it("shows the date chip in the app's one date format", async () => {
    const { w } = await mountAt("/audit?tab=cards&cards.from=2026-09-01&cards.to=2026-09-30");
    const chips = w.findComponent({ name: "FilterBar" }).props("chips") as { value: string }[];
    expect(chips.map((c) => c.value)).toEqual(["09/01/2026 → 09/30/2026"]);
  });

  it("reads a date that is not a real day as no bound", async () => {
    await mountAt("/audit?cards.from=2026-13-01");
    expect(filters()).toEqual({});
  });

  it("writes a page change, returns to page 1 when a filter changes, and keeps the page otherwise", async () => {
    const { w, query } = await mountAt("/audit?tab=cards");
    w.findComponent(TablePagination).vm.$emit("update:page", 2);
    await flushPromises();
    expect(query()).toEqual({ tab: "cards", "cards.page": "2" });

    w.findComponent(DateRangeFilter).vm.$emit("update:from", "2026-09-01");
    w.findComponent(DateRangeFilter).vm.$emit("update:to", "2026-09-07");
    await flushPromises();
    expect(query()).toEqual({ tab: "cards", "cards.from": "2026-09-01", "cards.to": "2026-09-07" });
  });

  it("Clear filters empties the scope and leaves the card and the tab alone", async () => {
    const { w, query } = await mountAt("/audit?tab=cards&cardId=c1&cards.search=773&cards.from=2026-09-01", "c1");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ tab: "cards", cardId: "c1" });
    expect(filters()).toEqual({ cardId: "c1" });
  });
});
