import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { DocumentRow } from "@silvicom/shared";
import DocumentsModal from "@/components/DocumentsModal.vue";

/**
 * The §391.51 folder (R5b, D-ROS8).
 *
 * The load-bearing assertion is the PANEL COUNT. Printing a scan works by hiding `body *` and
 * revealing a single `.print-target` panel — the only cross-origin-safe way to print a signed-URL
 * image — and that is the product's actual job during a DOT visit. A second panel on screen is not
 * an aesthetic complaint; it is the audit print path becoming something nobody tested.
 *
 * `BaseModal` is stubbed, as `DocumentPreview.test.ts` does: HeadlessUI's `Dialog` throws under this
 * repo's jsdom, and every one of these assertions is about what THIS component renders — how many
 * panels exist, and which — rather than about HeadlessUI's focus management. The stub keeps `v-if`
 * on `open`, which is precisely the behaviour being counted.
 */
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { url: "u", filename: "f" } })) }));

const MODAL_STUB = {
  props: ["open", "title", "description", "size", "printable"],
  template: `<div v-if="open" role="dialog" :aria-label="title"><p>{{ description }}</p><slot /><slot name="footer" /></div>`,
};

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "doc-1", subjectType: "driver", subjectId: "d-1", kind: "medical_card",
  contentType: "image/jpeg", bytes: 1024, sha256: "ab".repeat(32), page: 1, variant: "original",
  capturedAt: null, createdAt: "2026-08-01T00:00:00Z", url: "https://signed.example/a.jpg",
  thumbUrl: null, normalizedUrl: null, ...over,
});

const open = (documents: DocumentRow[] = [doc()], over: Record<string, unknown> = {}) => {
  setActivePinia(createPinia());
  return mount(DocumentsModal, {
    props: { open: true, subjectLabel: "Marcus Reyes", documents, loading: false, error: null, ...over },
    global: { stubs: { BaseModal: MODAL_STUB } },
  });
};

const openScan = async (w: ReturnType<typeof open>, text = "Medical") => {
  await w.findAll("button").find((b) => b.text().includes(text))!.trigger("click");
};

describe("DocumentsModal", () => {
  it("lists the filed scans under the requirement's own name", () => {
    const w = open([doc({ kind: "medical_card" })]);
    // `DQ_KIND_LABELS`, not the raw column value — a scan is called the same thing here as on the
    // driver's qualification page.
    expect(w.text()).toContain("Medical examiner's certificate");
    expect(w.text()).not.toContain("medical_card");
  });

  it("shows the newest scan first, because that is usually why somebody opened this", () => {
    const w = open([
      doc({ id: "old", kind: "cdl", createdAt: "2026-01-01T00:00:00Z" }),
      doc({ id: "new", kind: "medical_card", createdAt: "2026-08-01T00:00:00Z" }),
    ]);
    const text = w.text();
    expect(text.indexOf("Medical examiner")).toBeLessThan(text.indexOf("Commercial"));
  });

  it("NEVER renders two panels at once — the list is gone while a scan is open", async () => {
    const w = open();
    expect(w.findAll('[role="dialog"]')).toHaveLength(1);

    await openScan(w);
    expect(w.findAll('[role="dialog"]')).toHaveLength(1);
    // …and the one that survived is the viewer, not the list.
    expect(w.text()).not.toContain("Every scan filed");
  });

  it("returns to the list when the viewer closes, rather than to the page", async () => {
    const w = open();
    await openScan(w);
    expect(w.text()).not.toContain("Every scan filed");

    w.findComponent({ name: "DocumentPreview" }).vm.$emit("close");
    await w.vm.$nextTick();
    expect(w.text()).toContain("Every scan filed");
    expect(w.findAll('[role="dialog"]')).toHaveLength(1);
  });

  it("does not reopen onto the last scan after the folder is closed", async () => {
    const w = open();
    await openScan(w);
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    // Reopening a folder lands on the folder, not on whatever was being read last time.
    expect(w.text()).toContain("Every scan filed");
  });

  it("says the folder is empty rather than rendering an empty list", () => {
    expect(open([]).text()).toContain("Nothing filed yet");
  });

  it("reports a failure instead of an empty folder, which would read as 'no evidence'", () => {
    const w = open([], { error: "Could not load this driver's folder." });
    expect(w.text()).toContain("Could not load");
    expect(w.text()).not.toContain("Nothing filed yet");
  });
});
