import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * A row's Print label (Equipment lists, owner 2026-11-09): one label straight to the default printer,
 * or — with none set up — a toast that says where to set one, and no request at all.
 */

const api = vi.hoisted(() => ({
  printer: null as null | { id: string; name: string; online: boolean },
  posts: [] as Array<{ path: string; body: unknown }>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init: { method?: string; body?: unknown } = {}) => {
    if (path.endsWith("/defaults")) return { ok: true, data: { defaults: { effectivePrinterId: api.printer?.id ?? null } } };
    if (path.endsWith("/printers")) return { ok: true, data: { printers: api.printer ? [api.printer] : [] } };
    if (path.endsWith("/labels") && init.method === "POST") {
      api.posts.push({ path, body: init.body });
      return { ok: true, data: { job: { id: "job-1", status: "queued" }, dropped: 0 } };
    }
    if (path.includes("/jobs/")) return { ok: true, data: { job: { id: "job-1", status: "queued" } } };
    return { ok: false, error: { message: `unexpected ${path}` } };
  }),
}));
const toast = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

import { usePrintOneLabel } from "./usePrinting";

async function setup() {
  let printOne!: ReturnType<typeof usePrintOneLabel>["printOne"];
  const Host = defineComponent({
    setup() {
      ({ printOne } = usePrintOneLabel());
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  return printOne;
}

beforeEach(() => {
  api.printer = null;
  api.posts = [];
  vi.clearAllMocks();
});

describe("usePrintOneLabel", () => {
  it("sends exactly one label to the default printer and says where it went", async () => {
    api.printer = { id: "p-1", name: "Label printer", online: true };
    const printOne = await setup();
    await printOne({ kind: "asset", assetId: "11111111-1111-4111-8111-111111111111" });
    await flushPromises();
    expect(api.posts).toHaveLength(1);
    expect((api.posts[0]!.body as { targets: unknown[] }).targets).toEqual([
      { kind: "asset", assetId: "11111111-1111-4111-8111-111111111111" },
    ]);
    expect(toast.info).toHaveBeenCalledWith("Printing on Label printer");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says the label waits when the printer is offline", async () => {
    api.printer = { id: "p-1", name: "Label printer", online: false };
    const printOne = await setup();
    await printOne({ kind: "unit", unitKind: "vehicle", unitId: "22222222-2222-4222-8222-222222222222" });
    expect(api.posts).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith("Label printer is offline", expect.stringContaining("waits"));
  });

  it("with no printer set up, sends nothing and says where to set one", async () => {
    const printOne = await setup();
    await printOne({ kind: "asset", assetId: "11111111-1111-4111-8111-111111111111" });
    expect(api.posts).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("No label printer is set up", expect.stringContaining("Settings"));
  });
});
