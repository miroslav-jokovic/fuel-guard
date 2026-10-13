import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref, type Component } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — a filtered list keeps its filters and page in the URL.
 *
 * The two recruitment queues share a shape: a "Show" select that rests on `all`, a name search, and a
 * page. `all` is each list's fallback, so it never appears in a plain link, and a hand-edited `show`
 * outside the options reads as that resting value rather than as an empty list.
 */

const inquiry = (i: number, over: Record<string, unknown> = {}) => ({
  driverId: `d${i}`, name: `Driver ${String(i).padStart(2, "0")}`, status: "active", hireDate: null,
  employers: [], outstanding: [], fileDeadline: null, daysToDeadline: 10, complete: false,
  ...over,
});
const inquiryRows = [
  ...Array.from({ length: 22 }, (_, i) => inquiry(i + 1)),
  inquiry(90, { daysToDeadline: -3, name: "Overdue Olga" }),
];
const screening = (i: number, over: Record<string, unknown> = {}) => ({
  driverId: `d${i}`, name: `Driver ${String(i).padStart(2, "0")}`, status: "active", ready: true, gaps: [],
  ...over,
});
const screeningRows = [
  ...Array.from({ length: 22 }, (_, i) => screening(i + 1)),
  screening(90, { ready: false, name: "Blocked Bob", gaps: [{ field: "driverDOB" }] }),
];
const q = (rows: unknown[], summary: unknown) => ({
  data: ref({ rows, summary }), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
});

vi.mock("@/features/recruitment/useInquiryQueue", () => ({
  useInquiryQueueQuery: () => q(inquiryRows, { drivers: 23, outstanding: 23, overdue: 1, chaseable: 0 }),
}));
vi.mock("@/features/recruitment/useScreeningReadiness", () => ({
  screeningReadinessKey: ["recruitment", "screening-readiness"],
  useScreeningReadinessQuery: () =>
    q(screeningRows, { drivers: 23, ready: 22, blockedBy: [], carrierSource: "fmcsa" }),
}));
vi.mock("@tanstack/vue-query", async (orig) => ({
  ...((await orig()) as object),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/composables/useDrivers", () => ({
  useUpdateDriverProfile: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
// DataTable swaps to cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import InquiryQueuePage from "./InquiryQueuePage.vue";
import ScreeningReadinessPage from "./ScreeningReadinessPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";

async function mountAt(page: Component, url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/recruitment/inquiries", component: { template: "<div/>" } },
      { path: "/recruitment/screening", component: { template: "<div/>" } },
      { path: "/recruitment/:id", component: { template: "<div/>" } },
    ],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(page, {
    global: {
      plugins: [router, createPinia()],
      stubs: { RecruitmentTabs: true, DobImportCard: true, GatedLink: true, AppDateField: true },
    },
  });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const show = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Show")!;
const total = (w: Mounted) => w.findComponent(TablePagination).props("total");

describe.each([
  { name: "Inquiry queue", page: InquiryQueuePage, path: "/recruitment/inquiries", narrow: "overdue" },
  { name: "Screening readiness", page: ScreeningReadinessPage, path: "/recruitment/screening", narrow: "blocked" },
])("$name keeps its list in the URL", ({ page, path, narrow }) => {
  it("opens on everything with nothing in the URL", async () => {
    const { w, query } = await mountAt(page, path);
    expect(show(w).props("modelValue")).toBe("all");
    expect(total(w)).toBe(23);
    expect(query()).toEqual({});
  });

  it("reads the view, search and page back from a pasted link", async () => {
    const { w } = await mountAt(page, `${path}?show=${narrow}`);
    expect(show(w).props("modelValue")).toBe(narrow);
    expect(total(w)).toBe(1);

    const searched = await mountAt(page, `${path}?search=driver&page=2`);
    expect(total(searched.w)).toBe(22);
    expect(searched.w.findComponent(TablePagination).props("page")).toBe(2);
  });

  it("writes a choice to the URL, and leaves the resting value out of it", async () => {
    const { w, query } = await mountAt(page, `${path}?page=2`);
    show(w).vm.$emit("update:modelValue", narrow);
    await flushPromises();
    expect(query()).toEqual({ show: narrow });
    show(w).vm.$emit("update:modelValue", "all");
    await flushPromises();
    expect(query()).toEqual({});
  });

  it("Clear filters returns to everything", async () => {
    const { w, query } = await mountAt(page, `${path}?show=${narrow}&search=x&page=2`);
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({});
    expect(show(w).props("modelValue")).toBe("all");
  });

  it("reads a value from another list as the resting view", async () => {
    const { w } = await mountAt(page, `${path}?show=retired`);
    expect(show(w).props("modelValue")).toBe("all");
    expect(total(w)).toBe(23);
  });
});
