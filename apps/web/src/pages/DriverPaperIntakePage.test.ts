import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { PaperBatchResponse } from "@silvicom/shared";

/**
 * Drivers › Upload scanned files (DRIVER-PAPER-INTAKE-PLAN PI4): the three upload steps in order, a drop
 * starting a batch in the URL, an oversize file refused before it is sent, a duplicate said as such, the
 * stack's progress in words, and each paper shown on the scan's own page numbers.
 */
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body?: unknown }>);
const state = vi.hoisted(() => ({ batch: null as unknown, register: null as unknown }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body });
    if (path.endsWith("/paper-intake/stacks")) return { ok: true, data: state.register };
    if (path.includes("/complete")) return { ok: true, data: { status: "queued" } };
    if (path.includes("/batches/")) return { ok: true, data: state.batch };
    if (path.includes("/parts/")) return { ok: true, data: { url: "https://signed/piece.pdf" } };
    return { ok: false, error: { message: "unexpected" } };
  }),
}));
const uploads = vi.hoisted(() => [] as Array<{ path: string; token: string }>);
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: async (path: string, token: string) => { uploads.push({ path, token }); return { error: null }; } }) } },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header />" } }));
vi.mock("@/features/roster/PaperReviewDrawer.vue", () => ({ default: { name: "PaperReviewDrawer", props: ["open", "item"], template: "<div />" } }));

import DriverPaperIntakePage from "./DriverPaperIntakePage.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";

const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const STACK = "5a5a5a5a-1111-4222-8333-444444444444";
const batch = (over: Partial<PaperBatchResponse> = {}): PaperBatchResponse => ({
  stacks: [{
    id: STACK, batchId: "b", fileName: "monday-stack.pdf", status: "split", failure: null, pageCount: 12, coverSheetCount: 2, blankPageCount: 3,
    createdAt: "2026-11-06T18:00:00Z", reading: { done: 2, pending: 1, failed: 0 },
    parts: [
      { partIndex: 0, driverId: A, driverName: "Ann Driver", basis: "cover_sheet", stackPages: [2, 3, 5] },
      { partIndex: 1, driverId: null, driverName: null, basis: "none", stackPages: [11, 12] },
    ],
  }],
  items: [
    { id: "i1", stackId: STACK, partIndex: 0, pages: [3, 5], pieceFrom: 2, pieceTo: 3, driverId: A, driverName: "Ann Driver", basis: "scope", kind: "medical_card", issuedOn: "2026-06-01", expiresOn: "2027-06-30", title: "Medical Examiner's Certificate", unread: false, status: "pending" },
    { id: "i2", stackId: STACK, partIndex: 1, pages: [11, 12], pieceFrom: 1, pieceTo: 2, driverId: null, driverName: null, basis: null, kind: null, issuedOn: null, expiresOn: null, title: null, unread: true, status: "pending" },
  ],
  ...over,
});

async function mountAt(query = "") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/drivers/paper-intake", component: { template: "<div/>" } }] });
  await router.push(`/drivers/paper-intake${query}`);
  await router.isReady();
  const w = mount(DriverPaperIntakePage, { global: { plugins: [router, VueQueryPlugin], stubs: { SlideOver: { props: ["open", "title"], template: "<div v-if='open' data-test='viewer'>{{ title }}<slot /></div>" }, teleport: true } } });
  await flushPromises();
  return { w, router };
}
function pdf(name: string, size?: number): File {
  const f = new File([new Uint8Array(8)], name, { type: "application/pdf" });
  Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
  if (size) Object.defineProperty(f, "size", { value: size });
  return f;
}

/** The hash is WebCrypto's, which resolves on a later tick than `flushPromises` waits for. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 5));
  }
};

beforeEach(() => {
  calls.length = 0;
  uploads.length = 0;
  toast.success.mockReset();
  toast.error.mockReset();
  state.batch = batch();
  state.register = { stackId: STACK, uploadUrl: "https://put", storagePath: `org/${STACK}/stack.pdf`, token: "tok", duplicate: false };
});

describe("DriverPaperIntakePage", () => {
  it("registers, uploads straight to storage, then queues the split — and puts the new drop in the URL", async () => {
    const { w, router } = await mountAt();
    w.findComponent(FileDropzone).vm.$emit("files", [pdf("monday-stack.pdf")]);
    await settle();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/api/compliance/paper-intake/stacks",
      `/api/compliance/paper-intake/stacks/${STACK}/complete`,
    ]);
    const registered = calls.find((c) => c.path.endsWith("/paper-intake/stacks"))!;
    expect(registered.body).toMatchObject({ fileName: "monday-stack.pdf", bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(uploads).toEqual([{ path: `org/${STACK}/stack.pdf`, token: "tok" }]);
    expect(router.currentRoute.value.query.batch).toBe((registered.body as { batchId: string }).batchId);
  });

  it("refuses a file over 50 MB before anything is sent, and says a duplicate is one", async () => {
    const { w } = await mountAt("?batch=b0b0b0b0-1111-4222-8333-444444444444");
    w.findComponent(FileDropzone).vm.$emit("files", [pdf("huge.pdf", 60 * 1024 * 1024)]);
    await flushPromises();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("huge.pdf is too large", expect.stringContaining("50 MB"));

    state.register = { stackId: STACK, uploadUrl: null, storagePath: null, token: null, duplicate: true };
    w.findComponent(FileDropzone).vm.$emit("files", [pdf("again.pdf")]);
    await settle();
    expect(uploads).toEqual([]);
    expect(calls.some((c) => c.path.includes("/complete"))).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("again.pdf was already uploaded", expect.any(String));
  });

  it("says what a stack became, in the office's words, and shows each paper on the scan's page numbers", async () => {
    const { w } = await mountAt("?batch=b0b0b0b0-1111-4222-8333-444444444444");
    const line = w.find("[data-testid=stacks]").text();
    expect(line).toContain("12 pages · 1 driver · 3 blank pages left out · 2 pages with no cover sheet");
    expect(line).toContain("Reading 2 of 3 pieces…");
    const text = w.text();
    expect(text).toContain("Ann Driver");
    expect(text).toContain("by cover sheet");
    expect(text).toContain("Pages 3, 5");
    expect(text).toContain("until 06/30/2027");
    expect(text).toContain("No driver yet");
    expect(text).toContain("Could not be read");
  });

  it("opens a row's pages in the viewer at the row's first page of its piece", async () => {
    const { w } = await mountAt("?batch=b0b0b0b0-1111-4222-8333-444444444444");
    await w.find('[aria-label="View Pages 3, 5"]').trigger("click");
    await flushPromises();
    expect(calls.some((c) => c.path === `/api/compliance/paper-intake/stacks/${STACK}/parts/0`)).toBe(true);
    expect(w.find("[data-test=viewer] iframe").attributes("src")).toBe("https://signed/piece.pdf#page=2");
  });
});
