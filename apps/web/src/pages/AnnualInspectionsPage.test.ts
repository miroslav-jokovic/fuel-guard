import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";

/**
 * The annual inspection register's row actions.
 *
 * ── WHY THIS FILE IS ABOUT THE ⋮ AND NOT ABOUT THE TABLE ───────────────────────────────────────
 * The list rendered correctly from the day it shipped and was still unusable for the two things
 * somebody with a half-finished inspection actually wants: carry on with it, or throw it away. Both
 * existed — the route, and a `DELETE` the API had implemented — and neither was reachable without
 * opening the report first. So what has to stay true is not that the rows appear; it is that the
 * actions are ON them, that Discard is offered for a DRAFT only, and that it asks before it acts.
 */

const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const state = vi.hoisted(() => ({
  admin: { value: true },
  manage: { value: true },
  rows: { value: [] as unknown[] },
  discard: { mutateAsync: vi.fn(async () => undefined), isPending: { value: false } },
}));

vi.mock("@/features/maintenance/useAnnualInspections", () => ({
  INSPECTIONS_PAGE_SIZE: 50,
  useInspectionsQuery: () => ({
    data: { value: { inspections: state.rows.value, total: state.rows.value.length } },
    isLoading: ref(false),
    isFetching: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  useDiscardInspection: () => state.discard,
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => state.manage.value, canView: () => true, admin: state.admin.value }),
}));
const documents = vi.hoisted(() => ({ download: vi.fn(async () => undefined) }));
vi.mock("@/features/maintenance/inspectionDocuments", async () => {
  const actual = await vi.importActual<typeof import("@/features/maintenance/inspectionDocuments")>(
    "@/features/maintenance/inspectionDocuments",
  );
  return { ...actual, downloadInspectionPdf: documents.download };
});

const AnnualInspectionsPage = (await import("@/pages/AnnualInspectionsPage.vue")).default;

const row = (over: Record<string, unknown> = {}) => ({
  id: "insp-1",
  subject_type: "tractor",
  subject_id: "v-1",
  unit_number: "1187",
  inspector_name: "George Gacev",
  inspected_on: "2026-06-16",
  status: "draft",
  outcome: null,
  next_due_on: null,
  decal_serial: null,
  inspector_id: "i-1",
  document_id: null,
  ...over,
});

const page = (rows: unknown[]) => {
  state.rows.value = rows;
  return mount(AnnualInspectionsPage, {
    attachTo: document.body,
    global: { stubs: { PageHeader: true, NewInspectionDrawer: true, DeleteInspectionDrawer: true, PrintInspectionDrawer: true } },
  });
};

/** The panel is teleported to `<body>`, so the menu items are not inside the wrapper. */
async function openMenu(w: ReturnType<typeof page>) {
  (w.element.querySelector('button[aria-label="Actions"]') as HTMLButtonElement).click();
  await nextTick();
  return Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");
}

async function click(w: ReturnType<typeof page>, label: string) {
  await openMenu(w);
  const item = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  expect(item, `no row action labelled "${label}"`).toBeTruthy();
  item!.click();
  await nextTick();
}

beforeEach(() => {
  document.body.innerHTML = "";
  setActivePinia(createPinia());
  push.mockClear();
  state.discard.mutateAsync.mockClear();
  documents.download.mockClear();
  state.manage.value = true;
  vi.restoreAllMocks();
});

describe("getting the page out without opening the report", () => {
  it("offers Download report and Print on a filed report, and Download preview on a draft", async () => {
    const filed = await openMenu(page([row({ status: "final", outcome: "pass", document_id: "d-1" })]));
    expect(filed).toContain("Download report");
    expect(filed).toContain("Print…");
    expect(filed).not.toContain("Download preview");
    document.body.innerHTML = "";
    const draft = await openMenu(page([row()]));
    expect(draft).toContain("Download preview");
    expect(draft).not.toContain("Download report");
    expect(draft).not.toContain("Print…");
  });

  it("downloads the filed report by unit and date, and never navigates to the report page", async () => {
    const w = page([row({ status: "final", outcome: "pass", inspected_on: "2026-06-16", unit_number: "1187" })]);
    await click(w, "Download report");
    expect(documents.download).toHaveBeenCalledWith(
      "/api/maintenance/inspections/insp-1/report.pdf",
      "annual-inspection-1187-2026-06-16.pdf",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("asks for a draft's preview, not a report the API would refuse", async () => {
    const w = page([row()]);
    await click(w, "Download preview");
    expect(documents.download).toHaveBeenCalledWith(
      "/api/maintenance/inspections/insp-1/preview.pdf",
      "annual-inspection-1187-2026-06-16-preview.pdf",
    );
  });

  it("opens the print drawer for that row rather than the report page", async () => {
    const w = page([row({ status: "final", outcome: "pass" })]);
    await click(w, "Print…");
    const drawer = w.findComponent({ name: "PrintInspectionDrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.attributes("inspection-id") ?? drawer.props("inspectionId")).toBe("insp-1");
    expect(push).not.toHaveBeenCalled();
  });

  /** `report.pdf` is behind `canView` at the API; a reader who cannot manage the section still gets the record. */
  it("lets somebody who can only view the section download a filed report, but not a draft's preview", async () => {
    state.manage.value = false;
    const filed = await openMenu(page([row({ status: "final", outcome: "pass" })]));
    expect(filed).toContain("Download report");
    expect(filed).not.toContain("Discard");
    document.body.innerHTML = "";
    const draft = await openMenu(page([row()]));
    expect(draft).not.toContain("Download preview");
    expect(draft).not.toContain("Continue inspection");
  });
});

describe("carrying on with an unfinished inspection", () => {
  it("offers to continue a draft, and opens the report it belongs to", async () => {
    const w = page([row()]);
    await click(w, "Continue inspection");
    expect(push).toHaveBeenCalledWith({ name: "annual-inspection", params: { id: "insp-1" } });
  });

  it("calls it opening the report once it is completed, because there is nothing left to continue", async () => {
    const labels = await openMenu(page([row({ status: "final", outcome: "pass" })]));
    expect(labels).toContain("Open report");
    expect(labels).not.toContain("Continue inspection");
  });
});

describe("throwing an unfinished one away", () => {
  it("is offered for a draft and asks before it acts", async () => {
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = page([row()]);
    await click(w, "Discard");

    expect(confirmed).toHaveBeenCalled();
    expect(state.discard.mutateAsync).toHaveBeenCalledWith("insp-1");
    expect(useToastStore().toasts[0]?.title).toBe("Inspection discarded");
  });

  it("does nothing when the question is answered no", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = page([row()]);
    await click(w, "Discard");
    expect(state.discard.mutateAsync).not.toHaveBeenCalled();
  });

  it("is not offered at all once the report is filed — a record is superseded, never deleted", async () => {
    // D-AVI4. The API refuses it too, by name; this is the half that stops the reader being offered
    // something the server is going to take away from them.
    const labels = await openMenu(page([row({ status: "final", outcome: "pass" })]));
    expect(labels).not.toContain("Discard");
  });
});

describe("destroying a record is a row action too, and a different one from Discard (D-AVI29)", () => {
  beforeEach(() => {
    state.admin.value = true;
  });

  it("is offered on a FILED report, which is exactly where Discard is not", async () => {
    // Cleaning up is a job you do from the list. Discard refuses a filed report by design; this is
    // the action that can remove one, and it is the whole reason the owner asked for it.
    const labels = await openMenu(page([row({ status: "final", outcome: "pass" })]));
    expect(labels).toContain("Delete record");
    expect(labels).not.toContain("Discard");
  });

  it("is offered on a draft as well, alongside Discard", async () => {
    const labels = await openMenu(page([row({ status: "draft" })]));
    expect(labels).toContain("Delete record");
    expect(labels).toContain("Discard");
  });

  it("is hidden from somebody who can manage maintenance but is not an admin", async () => {
    // `can("maintenance")` is still true — a technician certifies inspections. What they must not
    // have is the control that destroys the record of one.
    state.admin.value = false;
    const labels = await openMenu(page([row({ status: "final", outcome: "pass" })]));
    expect(labels).not.toContain("Delete record");
    expect(labels).toContain("Open report");
  });
});
