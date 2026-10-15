import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
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
  /** "" for the newest page, `before:<cursor>` / `after:<cursor>` otherwise → the page the API answers. */
  pages: {} as Record<
    string,
    { rows: unknown[]; hasNext: boolean; nextCursor: string | null; hasNewer: boolean; newerCursor: string | null }
  >,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    state.urls.push(url);
    if (state.refuse) return { ok: false, error: state.refuse };
    const sp = new URL(url, "http://x").searchParams;
    const key = sp.get("before") ? `before:${sp.get("before")}` : sp.get("after") ? `after:${sp.get("after")}` : "";
    return { ok: true, data: state.pages[key] ?? { rows: [], hasNext: false, nextCursor: null, hasNewer: false, newerCursor: null } };
  }),
}));

const row = (n: number): AuditLog => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  org_id: "org-1",
  actor_id: null,
  action: `action.number-${n}`,
  entity: null,
  entity_id: null,
  meta: {},
  // Newest first: row 0 is the newest, a minute apart, so a page spans a range of time.
  created_at: new Date(Date.UTC(2026, 8, 30, 18, 0) - n * 60_000).toISOString(),
});
const PAGE_ONE = Array.from({ length: AUDIT_LOG_PAGE_SIZE }, (_, i) => row(i));
const cursorOf = (r: AuditLog) => `${r.created_at}|${r.id}`;
const OLDER = cursorOf(PAGE_ONE.at(-1)!);
const PAGE_TWO = [row(50), row(51)];
const NEWER = cursorOf(PAGE_TWO[0]!);

enableAutoUnmount(afterEach);
const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
// A real memory router, not a mocked `useRoute`: the tab and the search are read from and written to
// the URL through `useQueryState` (D-US2), which needs `router.replace` to answer a promise.
let router: Router;
const page = async (url = "/audit") => {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/audit", component: { template: "<div/>" } }] });
  await router.push(url);
  await router.isReady();
  const w = mount(AuditPage, { global: { plugins: [router, [VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: false } } } }]], stubs: { PageHeader: true, CardChangeLog: { name: "CardChangeLog", props: ["cardId"], template: "<div/>" } } } });
  await settle(w);
  return w;
};
const query = () => router.currentRoute.value.query;
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text))!;

beforeEach(() => {
  setActivePinia(createPinia());
  state.urls = [];
  state.refuse = null;
  state.pages = {};
});

describe("the Audit log page (SP4)", () => {
  it("switches the canonical tabs and exposes the matching labelled panel", async () => {
    const w = await page();
    expect(w.get('[role="tab"][aria-selected="true"]').text()).toBe("Activity");
    expect(w.get("#audit-panel-activity").attributes("aria-labelledby")).toBe("audit-tab-activity");

    await button(w, "Card changes").trigger("click");

    expect(w.get('[role="tab"][aria-selected="true"]').text()).toBe("Card changes");
    expect(w.get("#audit-panel-cards").attributes("aria-labelledby")).toBe("audit-tab-cards");
    expect(w.find("#audit-panel-activity").exists()).toBe(false);
  });

  it("keeps the activity toolbar and table in one data workspace", async () => {
    const w = await page();
    const workspace = w.find("section.divide-y");
    expect(workspace.exists()).toBe(true);
    expect(workspace.find('input[type="search"], input').exists()).toBe(true);
    expect(workspace.text()).toContain("No audit entries.");
  });

  it("reads the API, not PostgREST, and says it has nothing when there is nothing", async () => {
    const w = await page();
    expect(state.urls).toEqual(["/api/audit/log?"]);
    expect(w.text()).toContain("No audit entries.");
  });

  it("says the log could not be loaded, not the API's raw refusal, instead of an empty table", async () => {
    state.refuse = { code: "forbidden", message: "You do not have access to this screen" };
    const w = await page();
    expect(w.text()).toContain("Could not load the audit log.");
    expect(w.text()).not.toContain("You do not have access to this screen");
    expect(w.text()).not.toContain("No audit entries.");
  });

  it("names the time a page spans, never a page number or a row count (D-US12)", async () => {
    state.pages[""] = { rows: PAGE_ONE, hasNext: true, nextCursor: OLDER, hasNewer: false, newerCursor: null };
    const w = await page();
    const footer = w.text();
    expect(footer).toMatch(/\d{2}\/\d{2}\/2026 [^–]+ – \d{2}\/\d{2}\/2026/);
    expect(footer).not.toMatch(/Showing|Page \d/);
    expect(button(w, "Newer").attributes("disabled")).toBeDefined();
    expect(button(w, "Newest")).toBeUndefined();
  });

  it("puts the older page's cursor in the URL, so the link it makes reopens those rows", async () => {
    state.pages[""] = { rows: PAGE_ONE, hasNext: true, nextCursor: OLDER, hasNewer: false, newerCursor: null };
    state.pages[`before:${OLDER}`] = { rows: PAGE_TWO, hasNext: false, nextCursor: null, hasNewer: true, newerCursor: NEWER };
    const w = await page();

    await button(w, "Older").trigger("click");
    await settle(w);
    expect(query().before).toBe(OLDER);
    expect(new URL(state.urls.at(-1)!, "http://x").searchParams.get("before")).toBe(OLDER);
    expect(w.text()).toContain("action.number-51");
    expect(button(w, "Older").attributes("disabled")).toBeDefined();
    expect(button(w, "Newer").attributes("disabled")).toBeUndefined();

    // The link, pasted: a fresh page on that URL asks for the same rows, with no walk before it.
    state.urls = [];
    const pasted = await page(`/audit?before=${encodeURIComponent(OLDER)}`);
    expect(state.urls).toEqual([`/api/audit/log?before=${encodeURIComponent(OLDER)}`]);
    expect(pasted.text()).toContain("action.number-51");
  });

  it("walks Newer from a pasted link by the server's cursor, and Newest clears the URL", async () => {
    state.pages[`before:${OLDER}`] = { rows: PAGE_TWO, hasNext: false, nextCursor: null, hasNewer: true, newerCursor: NEWER };
    state.pages[`after:${NEWER}`] = { rows: PAGE_ONE, hasNext: true, nextCursor: OLDER, hasNewer: true, newerCursor: cursorOf(PAGE_ONE[0]!) };
    const w = await page(`/audit?before=${encodeURIComponent(OLDER)}`);

    await button(w, "Newer").trigger("click");
    await settle(w);
    expect(query()).toEqual({ after: NEWER });
    expect(w.text()).toContain("action.number-0");

    await button(w, "Newest").trigger("click");
    await settle(w);
    expect(query()).toEqual({});
    expect(state.urls.at(-1)).toBe("/api/audit/log?");
  });

  it("starts a new search from its newest page", async () => {
    const w = await page(`/audit?before=${encodeURIComponent(OLDER)}`);
    await w.find('input[type="search"], input').setValue("invite");
    await new Promise((r) => setTimeout(r, 400));
    await settle(w);
    expect(query()).toEqual({ action: "invite" });
  });

  it("sends the search as the action prefix", async () => {
    const w = await page();
    await w.find('input[type="search"], input').setValue("invite");
    await new Promise((r) => setTimeout(r, 400));
    await settle(w);
    expect(new URL(state.urls.at(-1)!, "http://x").searchParams.get("action")).toBe("invite");
  });
});

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12): the tab and the Activity search are in the URL, so Back from
 * a card the Card changes tab linked to lands on that tab, and a forwarded search reopens. The page is
 * in it too, as its cursor (D-US12) — tested above.
 */
describe("the Audit log keeps its view in the URL (D-US2)", () => {
  it("opens on Activity with nothing in the URL, and a tab click writes the tab", async () => {
    const w = await page();
    expect(query()).toEqual({});
    await button(w, "Card changes").trigger("click");
    await settle(w);
    expect(query()).toEqual({ tab: "cards" });
    await button(w, "Activity").trigger("click");
    await settle(w);
    expect(query()).toEqual({});
  });

  it("opens the card ledger for one card from the card page's link", async () => {
    const w = await page("/audit?tab=cards&cardId=card-9");
    expect(w.get('[role="tab"][aria-selected="true"]').text()).toBe("Card changes");
    expect(w.getComponent({ name: "CardChangeLog" }).props("cardId")).toBe("card-9");
  });

  it("reads a pasted search back into the box and the request", async () => {
    const w = await page("/audit?action=invite");
    expect((w.find('input[type="search"], input').element as HTMLInputElement).value).toBe("invite");
    expect(new URL(state.urls.at(-1)!, "http://x").searchParams.get("action")).toBe("invite");
  });

  it("writes the search to the URL", async () => {
    const w = await page();
    await w.find('input[type="search"], input').setValue("anomaly");
    await new Promise((r) => setTimeout(r, 400));
    await settle(w);
    expect(query().action).toBe("anomaly");
  });
});
