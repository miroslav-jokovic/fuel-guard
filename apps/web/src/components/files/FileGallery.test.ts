import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { DocumentRow } from "@silvicom/shared";
import FileGallery from "@/components/files/FileGallery.vue";

/**
 * Q-UF12 (owner 2026-10-21): "+N" opens a gallery of ALL the unit's papers. The strip lists every paper
 * the reader may see, newest first by the paper's own date (Q-UF10) — the order the cell draws — and
 * "+N" opens on the first paper the cell did not draw, not on the one it already showed.
 */
const docs = ref<DocumentRow[]>([]);
vi.mock("@/composables/useCompliance", () => ({ useDocumentsQuery: () => ({ data: docs }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), fetchObjectUrl: vi.fn() }));
vi.mock("@/lib/documentDownload", () => ({ saveObjectUrl: vi.fn(), openPdf: vi.fn(), downloadPdf: vi.fn() }));

const doc = (id: string, capturedAt: string, createdAt: string): DocumentRow => ({
  id, subjectType: "tractor", subjectId: "t-697", kind: "irp", contentType: "image/jpeg", bytes: 1, sha256: "ab".repeat(32),
  page: 1, variant: "original", capturedAt, createdAt, url: `https://signed.test/${id}.jpg`,
  thumbUrl: `https://signed.test/${id}.thumb.webp`, normalizedUrl: `https://signed.test/${id}.webp`,
});
// Truck 697's shape: the 07/27 annual uploaded 10/06, then four cab cards imported on 10/20.
const PAPERS = [
  doc("cab21", "2021-03-26", "2026-10-20T20:40:00Z"),
  doc("cab24", "2024-09-03", "2026-10-20T20:30:00Z"),
  doc("annual", "2026-07-27", "2026-10-06T14:00:00Z"),
  doc("cab26", "2026-02-23", "2026-10-20T20:10:00Z"),
  doc("cab25", "2025-03-24", "2026-10-20T20:20:00Z"),
];
const MODAL_STUB = { BaseModal: { template: "<div><slot /><slot name='footer' /></div>", props: ["open", "title", "size", "printable"] } };

function mountGallery(startId: string | null) {
  setActivePinia(createPinia());
  docs.value = PAPERS;
  return mount(FileGallery, {
    props: { subject: { type: "tractor", id: "t-697" }, subjectLabel: "Unit 697", startId },
    global: { stubs: MODAL_STUB },
  });
}
const shown = (w: ReturnType<typeof mountGallery>) => w.find("img[src$='.webp']:not([loading])").attributes("src");

describe("FileGallery", () => {
  it("lays every paper out in the strip, newest first by the paper's own date", () => {
    const w = mountGallery("annual");
    const strip = w.findAll("[data-test=gallery-thumb] img").map((i) => i.attributes("src"));
    expect(strip).toEqual(["annual", "cab26", "cab25", "cab24", "cab21"].map((id) => `https://signed.test/${id}.thumb.webp`));
    expect(w.get("[data-test=gallery-position]").text()).toBe("1 of 5");
  });

  it("opens \"+N\" on the first paper the cell did not draw", () => {
    const w = mountGallery(null);
    expect(w.get("[data-test=gallery-position]").text()).toBe("4 of 5");
    expect(shown(w)).toBe("https://signed.test/cab24.webp");
    expect(w.findAll("[data-test=gallery-thumb]")[3]!.attributes("aria-current")).toBe("true");
  });

  it("shows the paper a strip thumbnail names when it is clicked", async () => {
    const w = mountGallery("annual");
    await w.findAll("[data-test=gallery-thumb]")[4]!.trigger("click");
    expect(w.get("[data-test=gallery-position]").text()).toBe("5 of 5");
    expect(shown(w)).toBe("https://signed.test/cab21.webp");
  });
});
