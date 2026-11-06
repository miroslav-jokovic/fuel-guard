import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import type { UserRole } from "@silvicom/shared";
import HazmatLoadDetailPage from "./HazmatLoadDetailPage.vue";

/**
 * The hazmat load's "Qualification — cannot clear" card (DQ-INTO-DRIVERS-PLAN DD4). It used to say
 * "Fix the record in Compliance" with no link, and that page is gone. A driver finding now links to the
 * driver's qualification section and a carrier finding to Settings › Carrier records, each only where
 * it opens for the reader.
 */
const load = ref<Record<string, unknown> | undefined>(undefined);
const runs = ref<Array<Record<string, unknown>>>([]);
vi.mock("@/features/hazmat/useHazmatLoads", () => ({
  isAnalyzing: () => false,
  useHazmatLoadQuery: () => ({ data: load, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  useHazmatRunsQuery: () => ({ data: runs }),
  useSubmitLoad: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  useAnalyzeLoad: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  useCancelLoad: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
}));
vi.mock("@/features/hazmat/useDefensePacket", () => ({ useDefensePacket: () => ({ loading: ref(false), download: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header><slot name='actions' /></header>" } }));

const finding = (message: string) => ({ code: "x", message, citation: "§391.41" });
const run = (driver: unknown[], org: unknown[]) => ({
  id: "r1", load_id: "L1", engine_version: "1", dataset_version: "1", verdict: null, outcome: "flagged",
  flags: [], input_hash: "h", created_at: "2026-11-06T00:00:00Z",
  qualification: { evalDate: "2026-11-06", usedFallback: false, driver, org },
});
const asRole = async (role: UserRole) => {
  const { __session } = (await import("@/stores/session")) as unknown as { __session: { role: UserRole } };
  __session.role = role;
};
const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["/hazmat/loads/:id", "/drivers/:id", "/settings/carrier-records", "/loads", "/"].map((path) => ({
      path,
      component: { template: "<div />" },
    })),
  });
  await router.push("/hazmat/loads/L1");
  await router.isReady();
  const w = mount(HazmatLoadDetailPage, {
    global: {
      plugins: [router],
      stubs: { ReviewPanel: true, DeclaredProductsCard: true, LoadDeclarationCard: true, VerdictPanel: true, LoadStatusBadge: true },
    },
  });
  await flushPromises();
  return w;
};
const hrefs = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll("a").map((a) => a.attributes("href"));
/** By its words, so a link rendered with no destination still counts as shown. */
const driverLinks = (w: Awaited<ReturnType<typeof mountPage>>) =>
  w.findAll("a").filter((a) => a.text().includes("driver's qualification file"));

beforeEach(async () => {
  load.value = { id: "L1", driver_id: "d7", status: "needs_review" };
  runs.value = [];
  await asRole("admin");
});

describe("hazmat qualification findings link to where they are fixed", () => {
  it("links a driver finding to that driver's qualification section, no longer to Compliance", async () => {
    runs.value = [run([finding("Medical certificate expired")], [])];
    const w = await mountPage();
    expect(hrefs(w)).toContain("/drivers/d7?section=qualification");
    expect(hrefs(w)).not.toContain("/settings/carrier-records");
    expect(w.text()).not.toContain("in Compliance");
  });

  it("links a carrier finding to Carrier records", async () => {
    runs.value = [run([], [finding("PHMSA registration lapsed")])];
    const w = await mountPage();
    expect(hrefs(w)).toContain("/settings/carrier-records");
    expect(driverLinks(w)).toHaveLength(0);
  });

  it("offers no driver link when the load names no driver", async () => {
    load.value = { id: "L1", driver_id: null, status: "needs_review" };
    runs.value = [run([finding("Medical certificate expired")], [])];
    expect(driverLinks(await mountPage())).toHaveLength(0);
  });

  it("shows a reader only the links that open for them", async () => {
    // A dispatcher reads the roster but starts without Carrier records (Q-SET2, D-DQ20).
    await asRole("dispatcher");
    runs.value = [run([finding("Medical certificate expired")], [finding("PHMSA registration lapsed")])];
    const w = await mountPage();
    expect(hrefs(w)).toContain("/drivers/d7?section=qualification");
    expect(hrefs(w)).not.toContain("/settings/carrier-records");
  });

  it("offers no driver link to a reader the driver page does not open for", async () => {
    const { __session } = (await import("@/stores/session")) as unknown as { __session: { surfaces: unknown } };
    __session.surfaces = { "fleet.drivers": false };
    try {
      runs.value = [run([finding("Medical certificate expired")], [])];
      expect(driverLinks(await mountPage())).toHaveLength(0);
    } finally {
      __session.surfaces = null;
    }
  });
});
