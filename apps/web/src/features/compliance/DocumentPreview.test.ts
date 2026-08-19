import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { DocumentRow } from "@fuelguard/shared";
import DocumentPreview from "@/features/compliance/DocumentPreview.vue";

/**
 * B6 — the two branches the plan's done-when names: a PDF renders the browser's viewer in an
 * iframe AND hides Print (a button that silently prints an empty frame is worse than no button,
 * D-DQ9); an image renders <img> from the NORMALIZED variant and shows Print.
 */
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { url: "u", filename: "f" } })) }));

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

function mountPreview(doc: DocumentRow) {
  setActivePinia(createPinia());
  return mount(DocumentPreview, {
    props: { open: true, label: "Medical examiner's certificate", doc },
    global: {
      stubs: {
        BaseModal: {
          template: "<div><slot /><slot name='footer' /></div>",
          props: ["open", "title", "size", "printable"],
        },
      },
    },
  });
}

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
});
