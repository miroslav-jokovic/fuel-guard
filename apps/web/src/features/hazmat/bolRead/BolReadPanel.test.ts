import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FileDropzone from "@/components/ui/FileDropzone.vue";

/**
 * The panel on the Placard calculator (N2). The rule it owns is that what the dispatcher SEES is what is
 * read: the pages shown ticked, in the order shown, become the document — an unticked photo is never
 * sent, and a page moved earlier is read earlier.
 */
const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
/** What the read answers while it runs; null = it is done at once. */
let running: { status: string; stage: string } | null = null;
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body });
    if (path === "/api/documents/sources") {
      const name = String(init!.body!.fileName);
      return { ok: true, status: 201, data: { sourceId: `src-${name}`, uploadUrl: `https://storage.test/${name}`, duplicate: false } };
    }
    if (path.endsWith("/complete")) return { ok: true, status: 202, data: { jobId: "j" } };
    if (path.startsWith("/api/documents/sources/")) return { ok: true, status: 200, data: { status: "ready", refusal: null, pageCount: 1, readId: null } };
    if (path === "/api/documents/assemblies") return { ok: true, status: 201, data: { assemblyId: "asm-1", pageCount: 2 } };
    if (path === "/api/documents/reads") return { ok: true, status: 201, data: { readId: "read-1" } };
    if (running) return { ok: true, status: 200, data: { id: "read-1", ...running, failureCode: null, result: null, evidence: [], pages: [] } };
    return {
      ok: true, status: 200,
      data: { id: "read-1", status: "done", stage: null, failureCode: null, result: {}, evidence: [], pages: [
        { page: 1, pageClass: "bol", url: "https://signed.test/1", width: 10, height: 10 },
        { page: 2, pageClass: "placard", url: "https://signed.test/2", width: 10, height: 10 },
      ] },
    };
  }),
}));

import BolReadPanel from "./BolReadPanel.vue";
import { PENDING_READ_KEY } from "./bolReadPipeline";

// A JPEG's leading bytes, then the name — the picker reads what a file IS from its bytes (bolFiles.ts `formatOf`).
const photo = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), name], name, { type: "image/jpeg", lastModified: 1 });

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  running = null;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
});

describe("BolReadPanel", () => {
  it("words the stage the server says the read is in, not the same sentence for the whole read (TC0.2)", async () => {
    sessionStorage.setItem(PENDING_READ_KEY, "read-1");
    running = { status: "reading", stage: "checking" };
    const w = mount(BolReadPanel);
    await flushPromises();
    expect(w.text()).toContain("Checking the reading against the page…");
    w.unmount();
    sessionStorage.removeItem(PENDING_READ_KEY);
  });

  it("reads only the ticked photos, in the order shown, and says how many pages were read", async () => {
    const w = mount(BolReadPanel);
    w.findComponent(FileDropzone).vm.$emit("files", [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
    await flushPromises();
    expect(w.findAll("[data-testid^='bol-file-']")).toHaveLength(3);

    // Untick a.jpg, then move c.jpg before b.jpg.
    await w.get("[data-testid='bol-file-0'] input[type='checkbox']").setValue(false);
    await w.get("[aria-label='Move c.jpg earlier']").trigger("click");
    expect(w.get("[data-testid='bol-read']").text()).toBe("Read 2 pages");
    expect(w.get("[data-testid='bol-file-1']").text()).toContain("Page 1 · c.jpg");

    await w.get("[data-testid='bol-read']").trigger("click");
    await vi.waitFor(() => expect(w.find("[data-testid='bol-outcome']").exists()).toBe(true));

    expect(calls.filter((c) => c.path === "/api/documents/sources").map((c) => c.body!.fileName)).toEqual(["c.jpg", "b.jpg"]);
    expect(calls.find((c) => c.path === "/api/documents/assemblies")!.body).toEqual({ sourceIds: ["src-c.jpg", "src-b.jpg"] });
    expect(vi.mocked(globalThis.fetch).mock.calls.map((c) => c[0])).toEqual(["https://storage.test/c.jpg", "https://storage.test/b.jpg"]);
    expect(w.get("[data-testid='bol-outcome']").text()).toContain("Read 2 pages; 1 taken as the bill of lading.");
    expect(w.emitted("read")?.[0]?.[0]).toMatchObject({ id: "read-1" });
  });

  it("offers no Read button until a photo is added, and none enabled once every photo is unticked", async () => {
    const w = mount(BolReadPanel);
    expect(w.find("[data-testid='bol-read']").exists()).toBe(false);
    w.findComponent(FileDropzone).vm.$emit("files", [photo("a.jpg")]);
    await flushPromises();
    expect(w.get("[data-testid='bol-read']").text()).toBe("Read 1 page");
    await w.get("[data-testid='bol-file-0'] input[type='checkbox']").setValue(false);
    expect(w.get("[data-testid='bol-read']").attributes("disabled")).toBeDefined();
  });

  it("keeps a started read's id until it ends, and picks it up again after a reload with no files", async () => {
    // Every write to the key, in order: the panel must set it once the server has the read and clear it at the end.
    const store = new Map<string, string>();
    const writes: (string | null)[] = [];
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { if (k === PENDING_READ_KEY) writes.push(v); store.set(k, v); },
      removeItem: (k: string) => { if (k === PENDING_READ_KEY) writes.push(null); store.delete(k); },
    });
    store.set(PENDING_READ_KEY, "read-1");
    const w = mount(BolReadPanel);
    await vi.waitFor(() => expect(w.find("[data-testid='bol-outcome']").exists()).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(["/api/documents/reads/read-1"]);
    expect(w.emitted("read")?.[0]?.[0]).toMatchObject({ id: "read-1" });
    expect(writes).toEqual(["read-1", null]);

    writes.length = 0;
    w.findComponent(FileDropzone).vm.$emit("files", [photo("a.jpg")]);
    await flushPromises();
    await w.get("[data-testid='bol-read']").trigger("click");
    await vi.waitFor(() => expect(w.emitted("read")).toHaveLength(2));
    expect(writes).toEqual(["read-1", null]);
    vi.unstubAllGlobals();
  });
});
