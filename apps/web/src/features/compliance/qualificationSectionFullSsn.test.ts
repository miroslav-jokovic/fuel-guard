import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";

/**
 * Q-AM20 (a): the stored signed application prints the SSN's last four, and only a holder of "See the
 * full SSN" is offered the copy with all nine — opened from the API, never from the stored file.
 */
const query = <T>(data: T) => ({ data: ref(data), isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() });
const state = vi.hoisted(() => ({ full: false, docs: [] as Array<Record<string, unknown>> }));
const opened = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useCompliance", () => ({
  useCertificationsQuery: () => query([]),
  useDocumentsQuery: () => query(state.docs),
  useQualificationRecordsQuery: () => query([]),
  useDispatchHoldQuery: () => query({ held: false, cause: null, violationOn: null }),
}));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => query(null) }));
vi.mock("@/composables/useDrivers", () => ({ useDriverQuery: () => query({ full_name: "Ann Driver", cdl_number: "X1", return_to_duty_required: false }) }));
vi.mock("@/composables/useDqExports", () => ({ useExportDocument: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false, canReadKind: () => true, hasPermission: () => state.full }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/documentDownload", () => ({ openPdf: opened }));

import QualificationSection from "./QualificationSection.vue";

const RequirementTable = { name: "RequirementTable", props: ["rows"], emits: ["preview"], template: "<div />" };
const DocumentPreview = { name: "DocumentPreview", props: ["open", "doc", "label"], template: "<div><slot name='actions' /></div>" };

async function openApplication(kind = "employment_application") {
  state.docs = [{ id: "doc-app", kind, url: "https://signed/doc", thumbUrl: null, contentType: "application/pdf" }];
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/drivers/:id", component: { template: "<div/>" } }] });
  await router.push("/drivers/d1");
  await router.isReady();
  const w = mount(QualificationSection, {
    props: { driverId: "d1" },
    global: { plugins: [router], stubs: { RequirementTable, DocumentPreview, ScreeningIdentityCard: true, DocumentDropCard: true, CertificationHistory: true, RequirementDrawer: true } },
  });
  await flushPromises();
  w.findComponent(RequirementTable).vm.$emit("preview", { documentId: "doc-app", label: "Employment application" });
  await flushPromises();
  return w;
}
const fullButton = (w: Awaited<ReturnType<typeof openApplication>>) => w.findAll("button").find((b) => b.text() === "Open with the full SSN");

beforeEach(() => {
  state.full = false;
  opened.mockReset();
});

describe("the signed application, with the full SSN", () => {
  it("is offered to a holder of the permission, and opens the API's on-demand copy", async () => {
    state.full = true;
    const w = await openApplication();
    await fullButton(w)!.trigger("click");
    expect(opened).toHaveBeenCalledWith("/api/recruitment/filed-applications/doc-app/full-ssn.pdf");
  });

  it("is not offered without the permission, nor on any other document", async () => {
    expect(fullButton(await openApplication())).toBeUndefined();
    state.full = true;
    expect(fullButton(await openApplication("mvr"))).toBeUndefined();
  });
});
