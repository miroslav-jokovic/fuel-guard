import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { AppCombobox } from "@silvicom/ui";
import type { DocumentRow } from "@silvicom/shared";

/**
 * An inspection's paper, on the Inspection page (IC2). What it can get wrong that the API's tests
 * would not see:
 *
 *   1. **A filed document reads as its database word** ("court_disposition") instead of its name.
 *   2. **The drop zone shows to a reader without the manage level.**
 *   3. **A file goes out without saying what it is**, or as a kind this card does not offer.
 *   4. **The viewer's Download asks the DQ file's route**, which is gated on `roster` and answers an
 *      inspection's document as not on file — so a safety reader could look at a ticket and never
 *      download it.
 */

const mutateAsync = vi.fn();
const docs = ref<DocumentRow[] | undefined>([]);
const isError = ref(false);
let canManage = true;
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("./useRoadsideInspections", () => ({
  useInspectionDocumentsQuery: () => ({ data: docs, isLoading: ref(false), isError, error: ref(new Error("boom")), isFetching: ref(false), refetch: vi.fn() }),
  useUploadInspectionDocument: () => ({ mutateAsync, isPending: ref(false) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "safety" && canManage }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
/** The viewer, reduced to the props this card hands it. */
const Preview = defineComponent({
  name: "DocumentPreview",
  props: { open: Boolean, label: String, doc: Object, downloadPath: String },
  template: "<div data-test='preview' />",
});
vi.mock("@/components/DocumentPreview.vue", () => ({ default: Preview }));

const InspectionDocumentsCard = (await import("./InspectionDocumentsCard.vue")).default;

const row = (id: string, kind: string, createdAt: string): DocumentRow => ({
  id, subjectType: "roadside_inspection", subjectId: "insp-1", kind, contentType: "application/pdf", bytes: 10, sha256: "a".repeat(64),
  page: 1, variant: "original", capturedAt: null, createdAt, url: `https://storage.test/${id}`, thumbUrl: null, normalizedUrl: null,
});

async function card() {
  const w = mount(InspectionDocumentsCard, { props: { inspectionId: "insp-1" } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ documentId: "doc-new" });
  toast.success.mockReset();
  toast.error.mockReset();
  docs.value = [];
  isError.value = false;
  canManage = true;
});

describe("the list", () => {
  it("names each filed document and when it was filed", async () => {
    docs.value = [row("doc-2", "court_disposition", "2026-10-15T17:30:00Z"), row("doc-1", "citation", "2026-10-14T15:00:00Z")];
    const w = await card();
    const items = w.findAll("[data-test='document']").map((li) => li.text());
    expect(items[0]).toContain("Court result");
    expect(items[1]).toContain("Citation (ticket)");
    expect(items[0]).toMatch(/Filed 10\/15\/2026/);
    expect(w.text()).not.toContain("court_disposition");
  });

  it("says when nothing is filed, and when the list could not be read", async () => {
    expect((await card()).find("[data-test='documents-none']").exists()).toBe(true);
    isError.value = true;
    const failed = await card();
    expect(failed.get("[data-test='documents-state'] [role='alert']").text()).toContain("Could not load the documents.");
    expect(failed.find("[data-test='documents-none']").exists()).toBe(false);
  });
});

describe("filing", () => {
  it("is not offered to a reader without the safety section's manage level", async () => {
    canManage = false;
    expect((await card()).find("[data-test='documents-upload']").exists()).toBe(false);
  });

  it("asks what the file is before filing it, and offers only the three kinds a person uploads", async () => {
    const w = await card();
    const file = new File(["%PDF"], "ticket.pdf", { type: "application/pdf" });
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [file]);
    await flushPromises();
    expect(w.get("[data-test='documents-file']").attributes("disabled")).toBeDefined();
    const combo = w.findComponent(AppCombobox);
    expect((combo.props("options") as Array<{ value: string }>).map((o) => o.value)).toEqual(["citation", "court_disposition", "roadside_inspection_report"]);

    combo.vm.$emit("update:modelValue", "court_disposition");
    await flushPromises();
    await w.get("[data-test='documents-file']").trigger("click");
    await flushPromises();
    expect(mutateAsync).toHaveBeenCalledWith({ kind: "court_disposition", file });
    expect(toast.success).toHaveBeenCalledWith("Document filed", "Court result is on this inspection.");
  });

  it("says why when the filing fails, and keeps the file to try again", async () => {
    mutateAsync.mockRejectedValue(new Error("Upload a PDF or an image (JPEG, PNG, WebP or HEIC)."));
    const w = await card();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [new File(["x"], "ticket.txt")]);
    await flushPromises();
    w.findComponent(AppCombobox).vm.$emit("update:modelValue", "citation");
    await flushPromises();
    await w.get("[data-test='documents-file']").trigger("click");
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("Could not file the document", "Upload a PDF or an image (JPEG, PNG, WebP or HEIC).");
    expect(w.find("[data-test='documents-file']").exists()).toBe(true);
  });
});

describe("viewing", () => {
  it("opens the one viewer on the document, downloading through the inspection's own route", async () => {
    docs.value = [row("doc-1", "citation", "2026-10-14T15:00:00Z")];
    const w = await card();
    expect(w.findComponent(Preview).props("open")).toBe(false);
    await w.get("[data-test='document-view']").trigger("click");
    const preview = w.findComponent(Preview);
    expect(preview.props("open")).toBe(true);
    expect(preview.props("label")).toBe("Citation (ticket)");
    expect(preview.props("downloadPath")).toBe("/api/roadside-inspections/insp-1/documents/doc-1/download");
  });
});
