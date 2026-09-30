import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { AUDIT_LOG_PAGE_SIZE, type AuditLog } from "@silvicom/shared";
import AuditPage from "@/pages/AuditPage.vue";

/**
 * The Audit log page since SP4: it reads `GET /api/audit/log`, not PostgREST, and pages on the
 * server's `hasNext` without a total (Q-SET5). Mocked at `apiFetch`, so the URL the page sends — the
 * cursor and the search — is what is asserted.
 */
const state = vi.hoisted(() => ({
  urls: [] as string[],
  refuse: null as null | { code: string; message: string },
  /** cursor ("" for the first page) → the page the API answers. */
  pages: {} as Record<string, { rows: unknown[]; hasNext: boolean; nextCursor: string | null }>,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    state.urls.push(url);
    if (state.refuse) return { ok: false, error: state.refuse };
    const cursor = new URL(url, "http://x").searchParams.get("cursor") ?? "";
    return { ok: true, data: state.pages[cursor] ?? { rows: [], hasNext: false, nextCursor: null } };
  }),
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const row = (n: number): AuditLog => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  org_id: "org-1",
  actor_id: null,
  action: `action.number-${n}`,
  entity: null,
  entity_id: null,
  meta: {},
  created_at: "2026-09-30T12:00:00+00:00",
});
const PAGE_ONE = Array.from({ length: AUDIT_LOG_PAGE_SIZE }, (_, i) => row(i));
const CURSOR = "2026-09-30T12:00:00+00:00|00000000-0000-4000-8000-000000000049";

enableAutoUnmount(afterEach);
const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const page = async () => {
  const w = mount(AuditPage, { global: { plugins: [[VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: false } } } }]], stubs: { PageHeader: true, CardChangeLog: true } } });
  await settle(w);
  return w;
};
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text))!;

beforeEach(() => {
  setActivePinia(createPinia());
  state.urls = [];
  state.refuse = null;
  state.pages = {};
});

describe("the Audit log page (SP4)", () => {
  it("reads the API, not PostgREST, and says it has nothing when there is nothing", async () => {
    const w = await page();
    expect(state.urls).toEqual(["/api/audit/log?"]);
    expect(w.text()).toContain("No audit entries.");
  });

  it("shows the API's refusal instead of an empty table", async () => {
    state.refuse = { code: "forbidden", message: "You do not have access to this screen" };
    const w = await page();
    expect(w.text()).toContain("You do not have access to this screen");
    expect(w.text()).not.toContain("No audit entries.");
  });

  it("pages on hasNext without a total, handing the server's cursor back", async () => {
    state.pages[""] = { rows: PAGE_ONE, hasNext: true, nextCursor: CURSOR };
    state.pages[CURSOR] = { rows: [row(50), row(51)], hasNext: false, nextCursor: null };
    const w = await page();
    expect(w.text()).toContain("Showing 1–50");
    expect(w.text()).not.toMatch(/Showing 1–50\s*of/);

    await button(w, "Next").trigger("click");
    await settle(w);
    expect(new URL(state.urls.at(-1)!, "http://x").searchParams.get("cursor")).toBe(CURSOR);
    expect(w.text()).toContain("action.number-51");
    expect(w.text()).toContain("Showing 51–52");
    expect(button(w, "Next").attributes("disabled")).toBeDefined();
    expect(button(w, "Prev").attributes("disabled")).toBeUndefined();
  });

  it("offers no next page when the server says there is none", async () => {
    state.pages[""] = { rows: PAGE_ONE, hasNext: false, nextCursor: null };
    const w = await page();
    expect(button(w, "Next").attributes("disabled")).toBeDefined();
  });

  it("sends the search as the action prefix", async () => {
    const w = await page();
    await w.find('input[type="search"], input').setValue("invite");
    await new Promise((r) => setTimeout(r, 400));
    await settle(w);
    expect(new URL(state.urls.at(-1)!, "http://x").searchParams.get("action")).toBe("invite");
  });
});
