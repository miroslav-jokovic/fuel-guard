import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";

/**
 * MS2's open item (MEDSTOP-PLAN §7A.15): a Med-Stop positive or refusal stops dispatch, and the
 * driver's qualification file never said so. The api sends the violation's day only to a
 * testing-record reader; with it, the return-to-duty requirement appears, and a record older than
 * the violation does not satisfy it.
 */
const query = <T>(data: T) => ({ data: ref(data), isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() });
const state = vi.hoisted(() => ({
  hold: { held: false, cause: null, violationOn: null } as { held: boolean; cause: string | null; violationOn: string | null },
  records: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => query([]),
  useDocumentsQuery: () => query([]),
  useQualificationRecordsQuery: () => query(state.records),
  useDispatchHoldQuery: () => query(state.hold),
}));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => query(null) }));
vi.mock("@/composables/useDrivers", () => ({ useDriverQuery: () => query({ full_name: "Ann Driver", cdl_number: "X1", return_to_duty_required: false }) }));
vi.mock("@/composables/useDqExports", () => ({ useExportDocument: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false, canReadKind: () => true }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import QualificationSection from "./QualificationSection.vue";

const RequirementTable = { name: "RequirementTable", props: ["rows"], template: "<div />" };

async function rtdRow(): Promise<{ state: string } | undefined> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/drivers/:id", component: { template: "<div/>" } }] });
  await router.push("/drivers/d1?dq.all=1");
  await router.isReady();
  const w = mount(QualificationSection, {
    props: { driverId: "d1" },
    global: { plugins: [router], stubs: { RequirementTable, ScreeningIdentityCard: true, DocumentDropCard: true, CertificationHistory: true, RequirementDrawer: true, DocumentPreview: true } },
  });
  await flushPromises();
  const rows = w.findComponent(RequirementTable).props("rows") as Array<{ key: string; state: string }>;
  return rows.find((r) => r.key === "return_to_duty");
}

beforeEach(() => {
  state.hold = { held: false, cause: null, violationOn: null };
  state.records = [];
});

describe("the qualification file shows a Med-Stop hold (§7A.15)", () => {
  it("has no return-to-duty requirement for a driver who is not held", async () => {
    expect(await rtdRow()).toBeUndefined();
  });

  it("asks for return-to-duty documentation once a testing-record reader is told of a violation", async () => {
    state.hold = { held: true, cause: "violation", violationOn: "2026-10-01" };
    expect(await rtdRow()).toMatchObject({ state: "missing" });
  });

  it("does not count paperwork from before the violation, and counts paperwork from after it", async () => {
    state.hold = { held: true, cause: "violation", violationOn: "2026-10-01" };
    state.records = [{ kind: "return_to_duty", occurred_on: "2026-03-01", covers_until: null, document_id: null }];
    expect(await rtdRow()).toMatchObject({ state: "missing" });
    state.records = [{ kind: "return_to_duty", occurred_on: "2026-10-05", covers_until: null, document_id: null }];
    expect(await rtdRow()).toMatchObject({ state: "current" });
  });

  it("adds nothing for a reader the api told only THAT the driver is held", async () => {
    state.hold = { held: true, cause: null, violationOn: null };
    expect(await rtdRow()).toBeUndefined();
  });
});
