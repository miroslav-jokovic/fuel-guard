import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import DriverDetailPage from "@/pages/DriverDetailPage.vue";

/**
 * The driver record page after R6b and R7.
 *
 * Two claims are pinned, and they pull in opposite directions — which is why both are here.
 *
 * R6b turned three tabs into ONE SCROLL, so every remaining section must be on the page at once: a
 * `v-if` left behind on any of them would make `?section=` a tab switch again with no visible sign.
 *
 * R7 moved recruiting off this page, but `?section=application|employment|screening` are a PUBLIC
 * SURFACE — in bookmarks and binder references — so they must still land the reader somewhere real.
 * The page redirects them; it does not render an empty section and it does not silently show the
 * profile instead.
 */
const scrollIntoView = vi.fn();
const driver = ref<Record<string, unknown> | null>({ id: "d-1", full_name: "Marcus Reyes", status: "active" });

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: driver.value, error: null }) }),
        in: () => ({ order: async () => ({ data: [], error: null }) }),
        order: async () => ({ data: [], error: null }),
      }),
    }),
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

// The heavy children are stubbed: this file is about the page's SHAPE, not their contents, and each
// owns its own suite.
const STUBS = {
  QualificationSection: { props: ["driverId"], template: '<div data-testid="qualification" />' },
  SevenDayStatementSection: { props: ["driverId"], template: '<div data-testid="seven-day" />' },
  BaseChart: { template: "<div />" },
  DataTable: { template: "<table />" },
};

const mountAt = async (query = "") => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/drivers/:id", name: "driver-detail", component: DriverDetailPage },
      { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
    ],
  });
  await router.push(`/drivers/d-1${query}`);
  await router.isReady();
  // Attached to the document, because the page finds its anchors with `getElementById` — a detached
  // mount would make the scroll assertion pass or fail for a reason that is not the behaviour.
  const w = mount(DriverDetailPage, {
    attachTo: document.body,
    global: { plugins: [router, VueQueryPlugin], stubs: STUBS },
  });
  await flushPromises();
  return { w, router };
};

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = "";
});

describe("DriverDetailPage — one scroll, not three tabs (R6b)", () => {
  it("renders every remaining section at once, whatever ?section= says", async () => {
    const { w } = await mountAt();
    // All three anchors present on a plain load: this is what "one scroll" means, and a stray `v-if`
    // is exactly how it would silently become tabs again.
    expect(w.find("#section-qualification").exists()).toBe(true);
    expect(w.find("#section-profile").exists()).toBe(true);
    expect(w.find("#section-fuel").exists()).toBe(true);
  });

  it("still renders them all when the URL names one", async () => {
    const { w } = await mountAt("?section=fuel");
    expect(w.find("#section-qualification").exists()).toBe(true);
    expect(w.find("#section-profile").exists()).toBe(true);
  });

  it("scrolls to the section the URL names rather than switching to it", async () => {
    await mountAt("?section=fuel");
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("DriverDetailPage — the relocated sections still land somewhere (R7)", () => {
  it.each(["application", "employment", "screening"])(
    "redirects ?section=%s to the applicant record",
    async (value) => {
      const { router } = await mountAt(`?section=${value}`);
      expect(router.currentRoute.value.path).toBe("/recruitment/d-1");
    },
  );

  it("leaves a section that still lives here alone", async () => {
    const { router } = await mountAt("?section=qualification");
    expect(router.currentRoute.value.path).toBe("/drivers/d-1");
  });
});
