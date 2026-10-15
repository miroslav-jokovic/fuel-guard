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
const driver = ref<Record<string, unknown> | null>({
  id: "d-1",
  full_name: "Marcus Reyes",
  status: "active",
});
const requestBinder = vi.hoisted(() => vi.fn());
/** The api's per-reader view of the dispatch hold (`dispatchHoldForReader`), as the page receives it. */
const hold = vi.hoisted(() => ({ value: { held: false, cause: null, violationOn: null } as { held: boolean; cause: string | null; violationOn: string | null } }));

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
vi.mock("@/lib/api", () => ({
  apiDownload: vi.fn(async () => undefined),
  apiFetch: vi.fn(async (path: string) =>
    path.endsWith("/dispatch-hold") ? { ok: true, data: hold.value } : { ok: true, data: { driver: driver.value } }),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => true, canView: () => true }),
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/composables/useDqExports", async () => {
  const { ref } = await import("vue");
  return {
    useRequestBinder: () => ({ mutateAsync: requestBinder, isPending: ref(false) }),
  };
});

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
  hold.value = { held: false, cause: null, violationOn: null };
  requestBinder.mockReset();
  requestBinder.mockResolvedValue(undefined);
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = "";
});

describe("DriverDetailPage — one scroll, not three tabs (R6b)", () => {
  it("uses the standard export action and requests this driver's binder", async () => {
    const { w } = await mountAt();
    const exportButton = w
      .findAll("button")
      .find((button) => button.text().includes("Export this file"));
    expect(exportButton).toBeTruthy();
    expect(w.text()).toContain("Marcus Reyes · Complete qualification file");

    await exportButton!.trigger("click");
    await flushPromises();

    expect(requestBinder).toHaveBeenCalledOnce();
    expect(requestBinder).toHaveBeenCalledWith({ driverIds: ["d-1"], asAt: null });
  });

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

describe("DriverDetailPage — the summary's fuel facts (D-US6)", () => {
  it("pairs each fuel figure with its label, and a dash for an MPG no fill can give", async () => {
    const FactList = (await import("@silvicom/ui")).FactList;
    const { w } = await mountAt();
    const facts = w.findAllComponents(FactList).find((c) => c.text().includes("Fills"))!;
    expect(facts.findAll("dt").map((d) => d.text())).toEqual([
      "Fills",
      "Gallons",
      "MPG on this driver's fills",
      "Open anomalies",
    ]);
    // The fixture's fills read never answers, so the count is not known — a blank, never a "0" or an
    // empty cell — and an MPG over no spans is a blank too. Since F10 the gallons and the open
    // anomalies are blanks for the same reason: they were "0", sums over a list nobody had read.
    const [fills, gallons, mpg, open] = facts.findAll("dd").map((d) => d.text());
    expect([fills, gallons, open]).toEqual(["—", "—", "—"]);
    expect(mpg!.startsWith("—")).toBe(true);
  });
});

/**
 * F10 (US6b): the fuel panels wait for their reads. This fixture's fills read throws (its query chain
 * stops short), so with retries off it is a failed read — which drew "Not enough valid data to chart
 * MPG yet" and "No anomalies" before.
 */
describe("DriverDetailPage — a failed fills read is not a driver with no fills", () => {
  it("says the fills and the anomalies could not be loaded, each with a Retry", async () => {
    const { QueryClient } = await import("@tanstack/vue-query");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/drivers/:id", name: "driver-detail", component: DriverDetailPage }],
    });
    await router.push("/drivers/d-1");
    await router.isReady();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = mount(DriverDetailPage, {
      attachTo: document.body,
      global: { plugins: [router, [VueQueryPlugin, { queryClient }]], stubs: STUBS },
    });
    await flushPromises();
    expect(w.text()).toContain("Could not load the fills.");
    expect(w.text()).toContain("Could not load the anomalies.");
    expect(w.text()).not.toContain("Not enough valid data to chart MPG yet");
    expect(w.text()).not.toContain("No anomalies.");
    expect(w.findAll("button").filter((b) => b.text() === "Retry").length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * MS2's open item (MEDSTOP-PLAN §7A.15): a Med-Stop hold stopped dispatch while this page said nothing.
 * The notice now reads the dispatch door's own answer — and names the result only to the reader the
 * api told (a testing-record reader); everyone else is told there is a safety review to close.
 */
describe("DriverDetailPage — the dispatch hold notice", () => {
  it("says nothing for a driver who is not held", async () => {
    const { w } = await mountAt();
    expect(w.text()).not.toContain("cannot be");
  });

  it("names the Med-Stop result and its day to a testing-record reader", async () => {
    hold.value = { held: true, cause: "violation", violationOn: "2026-10-01" };
    const { w } = await mountAt();
    expect(w.text()).toContain("Med-Stop reported a positive or refused test collected 10/01/2026");
  });

  it("tells every other reader only that a safety review is outstanding", async () => {
    hold.value = { held: true, cause: null, violationOn: null };
    const { w } = await mountAt();
    expect(w.text()).toContain("outstanding safety review");
    expect(w.text()).not.toMatch(/Med-Stop|positive|refused/);
  });

  it("keeps the application's admission notice for every reader", async () => {
    hold.value = { held: true, cause: "admission", violationOn: null };
    const { w } = await mountAt();
    expect(w.text()).toContain("This applicant said they had a positive or refused pre-employment test");
  });
});
