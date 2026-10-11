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
    return {
      ok: true, status: 200,
      data: { id: "read-1", status: "done", failureCode: null, result: {}, evidence: [], pages: [
        { page: 1, pageClass: "bol", url: "https://signed.test/1", width: 10, height: 10 },
        { page: 2, pageClass: "placard", url: "https://signed.test/2", width: 10, height: 10 },
      ] },
    };
  }),
}));

import BolReadPanel from "./BolReadPanel.vue";

const photo = (name: string) => new File([name], name, { type: "image/jpeg", lastModified: 1 });

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
});

describe("BolReadPanel", () => {
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
});
