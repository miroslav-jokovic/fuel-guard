import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — a filtered list keeps its filters in the URL.
 *
 * The qualification file is a SECTION of the driver page, so its keys are scoped `dq.` and must sit
 * beside the page's own `?section=` without disturbing it. "Show all requirements" is a URL flag
 * too (it chooses which list this is), and Clear filters leaves it alone, as it always did.
 */

const query = <T>(data: T) => ({ data: ref(data), isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() });
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => query([]),
  useDocumentsQuery: () => query([]),
  useQualificationRecordsQuery: () => query([]),
}));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => query(null) }));
/** F10: the driver read refused. */
const driverRead = vi.hoisted(() => ({ fails: false }));
vi.mock("@/composables/useDrivers", () => ({
  useDriverQuery: () =>
    driverRead.fails
      ? { ...query(undefined), isError: ref(true) }
      : query({ full_name: "Ann Driver", cdl_number: "X1" }),
}));
vi.mock("@/composables/useDqExports", () => ({ useExportDocument: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false, canReadKind: () => true }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import QualificationSection from "./QualificationSection.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";

const RequirementTable = { name: "RequirementTable", props: ["rows"], template: "<div />" };

async function mountAt(url: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/drivers/:id", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(QualificationSection, {
    props: { driverId: "d1" },
    global: {
      plugins: [router],
      stubs: {
        RequirementTable,
        ScreeningIdentityCard: true,
        DocumentDropCard: true,
        CertificationHistory: true,
        RequirementDrawer: true,
        DocumentPreview: true,
      },
    },
  });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const rows = (w: Mounted) => w.findComponent(RequirementTable).props("rows") as Array<{ group: string; label: string }>;
const group = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Group")!;

describe("the qualification file keeps its requirement list in the URL", () => {
  it("reads the group from a pasted link, scoped beside the page's own section", async () => {
    const { w } = await mountAt("/drivers/d1?section=qualification&dq.group=medical");
    expect(group(w).props("modelValue")).toBe("medical");
    expect(rows(w).length).toBeGreaterThan(0);
    expect(rows(w).every((r) => r.group === "medical")).toBe(true);
  });

  it("writes a group change under its scope and leaves the page's section alone", async () => {
    const { w, query } = await mountAt("/drivers/d1?section=qualification");
    group(w).vm.$emit("update:modelValue", "licence");
    await flushPromises();
    expect(query()).toEqual({ section: "qualification", "dq.group": "licence" });
  });

  it("reads a group outside the catalogue as no filter", async () => {
    const { w } = await mountAt("/drivers/d1?dq.group=bogus");
    expect(group(w).props("modelValue")).toBe("");
    expect(new Set(rows(w).map((r) => r.group)).size).toBeGreaterThan(1);
  });

  it("Clear filters keeps the show-all switch and the page's section", async () => {
    const { w, query } = await mountAt("/drivers/d1?section=qualification&dq.group=medical&dq.search=card&dq.all=1");
    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ section: "qualification", "dq.all": "1" });
  });
});

/**
 * F10 (US6b): the group tiles are a verdict on the file, built from five reads. Before, a failed driver
 * read drew every group "Blocked" above a table that said the file could not be loaded.
 */
describe("the group tiles wait for the file's reads", () => {
  beforeEach(() => {
    driverRead.fails = false;
  });

  it("draws the tiles once every read has answered", async () => {
    const { w } = await mountAt("/drivers/d1");
    expect(w.text()).toMatch(/blocked/i);
  });

  it("draws no verdict when a read failed", async () => {
    driverRead.fails = true;
    const { w } = await mountAt("/drivers/d1");
    expect(w.text()).not.toMatch(/blocked/i);
  });
});
