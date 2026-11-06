import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";

/**
 * DRIVER-ROSTER-PLAN §6 Q6, answered 2026-11-06: a requirement dated on file with no scan behind it
 * keeps its state and says "Date on file, no scan" — the driver's half of the truck file's
 * "Date only, no paper" (D-UF3). Not said to a reader the scan is withheld from.
 */
const query = <T>(data: T) => ({ data: ref(data), isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() });
const state = vi.hoisted(() => ({
  certs: [] as Array<Record<string, unknown>>,
  docs: [] as Array<Record<string, unknown>>,
  unreadable: new Set<string>(),
}));
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => query(state.certs),
  useDocumentsQuery: () => query(state.docs),
  useQualificationRecordsQuery: () => query([]),
  useDispatchHoldQuery: () => query({ held: false, cause: null, violationOn: null }),
}));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => query(null) }));
vi.mock("@/composables/useDrivers", () => ({ useDriverQuery: () => query({ full_name: "Ann Driver", cdl_number: "X1", return_to_duty_required: false }) }));
vi.mock("@/composables/useDqExports", () => ({ useExportDocument: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false, canReadKind: (k: string) => !state.unreadable.has(k) }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import QualificationSection from "./QualificationSection.vue";

const RequirementTable = { name: "RequirementTable", props: ["rows"], template: "<div />" };
type Row = { key: string; state: string; note?: string | null };

async function rowFor(key: string): Promise<Row | undefined> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/drivers/:id", component: { template: "<div/>" } }] });
  await router.push("/drivers/d1?dq.all=1");
  await router.isReady();
  const w = mount(QualificationSection, {
    props: { driverId: "d1" },
    global: { plugins: [router], stubs: { RequirementTable, ScreeningIdentityCard: true, DocumentDropCard: true, CertificationHistory: true, RequirementDrawer: true, DocumentPreview: true } },
  });
  await flushPromises();
  return (w.findComponent(RequirementTable).props("rows") as Row[]).find((r) => r.key === key);
}

const cdl = (documentId: string | null) => ({ id: "c1", kind: "cdl", qualifier: null, training_type: null, issued_at: "2024-01-01", expires_at: "2030-01-01", document_id: documentId });

beforeEach(() => {
  state.certs = [];
  state.docs = [];
  state.unreadable = new Set();
});

describe("a dated requirement with no scan says so (Q6)", () => {
  it("keeps a synced CDL current and notes that its scan is missing", async () => {
    state.certs = [cdl(null)];
    expect(await rowFor("cdl")).toMatchObject({ state: "current", note: "Date on file, no scan" });
  });

  it("says nothing once the scan the record cites is on file", async () => {
    state.certs = [cdl("doc1")];
    state.docs = [{ id: "doc1", kind: "cdl", url: "https://signed/doc1", thumbUrl: null, contentType: "application/pdf" }];
    expect((await rowFor("cdl"))?.note ?? null).toBeNull();
  });

  it("does not repeat 'missing' as a note on a requirement nobody recorded", async () => {
    expect(await rowFor("cdl")).toMatchObject({ state: "missing", note: null });
  });

  it("does not tell a reader the scan is withheld from that there is none", async () => {
    state.certs = [cdl(null)];
    state.unreadable = new Set(["cdl"]);
    expect((await rowFor("cdl"))?.note ?? null).toBeNull();
  });
});
