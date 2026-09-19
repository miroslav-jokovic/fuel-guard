import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { DocumentRow } from "@silvicom/shared";
import DocumentPreview from "@/components/DocumentPreview.vue";

/**
 * B6 — the two branches the plan's done-when names: a PDF renders the browser's viewer in an
 * iframe AND hides Print (a button that silently prints an empty frame is worse than no button,
 * D-DQ9); an image renders <img> from the NORMALIZED variant and shows Print.
 */
const fetchObjectUrl = vi.hoisted(() => vi.fn());
const saveObjectUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: { url: "u", filename: "f" } })),
  fetchObjectUrl,
}));
vi.mock("@/lib/documentDownload", () => ({ saveObjectUrl, openPdf: vi.fn(), downloadPdf: vi.fn() }));

const base: DocumentRow = {
  id: "00000000-0000-4000-8000-00000000000a",
  subjectType: "driver",
  subjectId: "00000000-0000-4000-8000-0000000000d1",
  kind: "medical_card",
  contentType: "image/jpeg",
  bytes: 4_200_000,
  sha256: "ab".repeat(32),
  page: 1,
  variant: "original",
  capturedAt: "2026-05-01",
  createdAt: "2026-05-01T10:00:00Z",
  url: "https://signed.example/original.jpg",
  thumbUrl: "https://signed.example/thumb.webp",
  normalizedUrl: "https://signed.example/normalized.webp",
};

const MODAL_STUB = {
  BaseModal: {
    template: "<div><slot /><slot name='footer' /></div>",
    props: ["open", "title", "size", "printable"],
  },
};

function mountPreview(doc: DocumentRow) {
  setActivePinia(createPinia());
  return mount(DocumentPreview, {
    props: { open: true, label: "Medical examiner's certificate", doc },
    global: { stubs: MODAL_STUB },
  });
}

/** A document the API renders on demand: a path, a filename, no row and no hash (B8). */
function mountRendered(
  path = "/api/recruitment/applications/inv-1/preview.pdf",
  source?: string,
) {
  setActivePinia(createPinia());
  return mount(DocumentPreview, {
    props: {
      open: true,
      label: "Application preview",
      rendered: { path, filename: "application-preview.pdf", source },
    },
    global: { stubs: MODAL_STUB },
  });
}

/** Ten ticks, because the frame's source arrives from a fetch rather than from a prop. */
const settle = async (w: { vm: { $nextTick: () => Promise<unknown> } }) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("DocumentPreview (B6)", () => {
  it("image branch: renders the NORMALIZED variant, not the original, and shows Print", () => {
    const w = mountPreview(base);
    const img = w.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe(base.normalizedUrl);
    expect(w.find("iframe").exists()).toBe(false);
    expect(w.text()).toContain("Print");
    expect(w.text()).toContain("ababababababa".slice(0, 12)); // sha256 prefix, §390.32(c) visible
  });

  it("falls back to the signed original while the derive job has not run yet", () => {
    const w = mountPreview({ ...base, normalizedUrl: null, thumbUrl: null });
    expect(w.find("img").attributes("src")).toBe(base.url);
  });

  it("PDF branch: renders an iframe on the signed original and hides Print (D-DQ9)", () => {
    const w = mountPreview({ ...base, contentType: "application/pdf", normalizedUrl: null, thumbUrl: null });
    expect(w.find("iframe").exists()).toBe(true);
    expect(w.find("iframe").attributes("src")).toBe(base.url);
    expect(w.find("img").exists()).toBe(false);
    expect(w.text()).not.toContain("Print");
    expect(w.text()).toContain("Download original");
  });

  /**
   * ⚠ The hash is asserted PRESENT here so that its absence in the rendered branch below means
   * something. An "it does not show a hash" test on its own passes just as well against a viewer
   * that shows nobody a hash ever, which is A2's vacuous-assertion lesson in its other form.
   */
  it("filed branch: prints the §390.32(c) hash, because a stored document has one", () => {
    const w = mountPreview({ ...base, contentType: "application/pdf" });
    expect(w.text()).toContain("abababababab");
  });
});

/**
 * B8 — the second source: a document the API RENDERS ON DEMAND has no row, no storage URL and no
 * hash, so it reached the office only through `openPdf`'s new tab. These pin the three things that
 * separate it from a filed document: where the bytes come from, what evidence it may claim, and who
 * owns the object URL.
 */
describe("DocumentPreview, a document with no row (B8)", () => {
  beforeEach(() => {
    fetchObjectUrl.mockReset();
    saveObjectUrl.mockReset();
    fetchObjectUrl.mockResolvedValue("blob:rendered-1");
    URL.revokeObjectURL = vi.fn(); // jsdom implements neither half of the object-URL API
  });

  it("fetches the path it was given and shows THOSE bytes in the frame", async () => {
    const w = mountRendered();
    await settle(w);
    expect(fetchObjectUrl).toHaveBeenCalledWith("/api/recruitment/applications/inv-1/preview.pdf");
    expect(w.find("iframe").attributes("src")).toBe("blob:rendered-1");
  });

  /**
   * ⚠ The caption is the sentence that tells a reader what they are holding, and the two rendered
   * documents are drawn from different things — the application preview from the answers on file,
   * B2's permissions PDF from the signed instruments. Both halves are asserted: a component that
   * ignored `source` would pass the default case for ever.
   */
  it("names what it was drawn from, which is not the same for both rendered documents", async () => {
    const preview = mountRendered();
    await settle(preview);
    expect(preview.text()).toContain("Rendered from the answers on file");

    const permissions = mountRendered(
      "/api/recruitment/applications/inv-1/permissions.pdf",
      "the instruments this applicant signed",
    );
    await settle(permissions);
    expect(permissions.text()).toContain("Rendered from the instruments this applicant signed");
    expect(permissions.text()).not.toContain("the answers on file");
  });

  it("claims no hash, and says why instead of printing a blank one", async () => {
    const w = mountRendered();
    await settle(w);
    expect(w.text()).not.toContain("abababababab");
    expect(w.text()).toContain("not a stored copy");
  });

  it("says the API's own sentence when the render is refused", async () => {
    fetchObjectUrl.mockRejectedValueOnce(new Error("They have not filled anything in yet."));
    const w = mountRendered();
    await settle(w);
    expect(w.text()).toContain("filled anything in");
    expect(w.find("iframe").exists()).toBe(false);
  });

  it("revokes the blob when it closes, rather than on a timer it cannot observe", async () => {
    const w = mountRendered();
    await settle(w);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await w.setProps({ open: false });
    await settle(w);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rendered-1");
  });

  it("downloads the bytes already on screen rather than rendering a second, different copy", async () => {
    const w = mountRendered();
    await settle(w);
    const download = w.findAll("button").find((b) => b.text().includes("Download"))!;
    expect(download.text()).toContain("Download a copy"); // not "original" — there is no original
    await download.trigger("click");
    await settle(w);

    expect(saveObjectUrl).toHaveBeenCalledWith("blob:rendered-1", "application-preview.pdf");
    expect(fetchObjectUrl).toHaveBeenCalledTimes(1);
  });
});
