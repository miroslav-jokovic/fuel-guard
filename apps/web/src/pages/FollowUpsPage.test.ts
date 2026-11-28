import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { FollowUpLine } from "@silvicom/shared";

/**
 * Follow-ups opens newest activity first (WARNING-DESK-PLAN D-WD18, owner 2026-11-27; contract §5.3):
 * on release day a high-severity 3:31 PM line sat above the 6:23 PM warnings and the desk read as four hours
 * behind. Sort and the Severity filter live in the URL (D-US2).
 */
const line = (id: string, o: Partial<FollowUpLine> = {}): FollowUpLine => ({
  id, ruleKey: "safety_other", ruleLabel: "Repeated driving events", windowDays: 7,
  category: "safety", severity: "normal", status: "new", outcome: null, subjectKind: "driver", subjectName: `Driver ${id}`, inRoster: true,
  truck: null, trailer: null, driver: { id: null, name: `Driver ${id}`, phone: null, source: "samsara" },
  warningCount: 3, firstAt: "2026-11-25T12:00:00Z", lastAt: "2026-11-27T12:00:00Z", contactedAt: null, closedAt: null, mine: false,
  looksFixed: false, warnedAgain: false, version: 1, ...o,
});

const lines = [
  line("red-light", { ruleKey: "safety_serious", ruleLabel: "Serious driving event", severity: "high", lastAt: "2026-11-27T21:31:36Z" }),
  line("following", { lastAt: "2026-11-28T00:23:57Z" }),
  line("braking", { lastAt: "2026-11-28T00:14:23Z" }),
];

vi.mock("@/features/followUps/useFollowUps", () => ({
  useFollowUpsQuery: () => ({
    data: ref({ lines, categories: ["maintenance", "safety", "compliance", "route"], counts: { maintenance: 0, safety: 3, compliance: 0, route: 0 } }),
    isLoading: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn(),
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, canManage: true }) }));
// DataTable swaps cards below 768px and jsdom has no matchMedia; the desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import FollowUpsPage from "./FollowUpsPage.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/shop/follow-ups", component: { template: "<div/>" }, meta: { title: "Follow-ups" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(FollowUpsPage, { global: { plugins: [router, createPinia()], stubs: { FollowUpDrawer: true } } });
  await flushPromises();
  const order = () => w.findAll("tbody tr").map((tr) => tr.text());
  return { w, order, query: () => router.currentRoute.value.query };
}

describe("FollowUpsPage — newest activity first", () => {
  it("opens with the line warned most recently on top, the high-severity one from earlier last", async () => {
    const { order } = await mountAt("/shop/follow-ups");
    const rows = order();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Driver following");
    expect(rows[1]).toContain("Driver braking");
    expect(rows[2]).toContain("Driver red-light");
  });

  it("lets a header in the URL override the opening order", async () => {
    const { order } = await mountAt("/shop/follow-ups?sort=lastAt&dir=asc");
    expect(order()[0]).toContain("Driver red-light");
  });

  it("narrows to one severity from the URL", async () => {
    const { order } = await mountAt("/shop/follow-ups?severity=high");
    expect(order()).toHaveLength(1);
    expect(order()[0]).toContain("Driver red-light");
  });
});
