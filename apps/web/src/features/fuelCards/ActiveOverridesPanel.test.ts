import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * The account's active fuel exceptions (audit B3) as a table, and a failed read that says so (the
 * sweep after US6b batch 3, 2026-10-14). Before: five facts and two actions on a wrapping line, and a
 * failed read drawing nothing — the same as before first data, so the panel was quietest exactly when
 * it knew least. The desktop breakpoint is stubbed: jsdom has no `matchMedia`.
 */
const { read } = await vi.hoisted(async () => ({ read: { state: "ok" as "ok" | "loading" | "failed", refetches: 0, rereads: [] as string[] } }));
vi.mock("@vueuse/core", async (orig) => {
  const { ref } = await import("vue");
  return { ...((await orig()) as object), useMediaQuery: () => ref(true) };
});
vi.mock("./useEfsCards", async () => {
  const { ref } = await import("vue");
  const card = (id: string, last4: string, uses: number) => ({
    id, maskedRef: `••${last4}`, last4, driverName: "Ann Lee", unitPrompt: "101", status: "Active",
    overrideUses: uses, overrideAllLocations: true, locationOverrideId: null, detailSyncedAt: new Date().toISOString(),
  });
  return {
    useEfsCards: () => ({
      data: ref(read.state === "ok" ? { cards: [card("c1", "1234", 2), card("c2", "5678", 0)], staleAfterMinutes: 60 } : undefined),
      isError: ref(read.state === "failed"),
      isFetching: ref(false),
      refetch: () => { read.refetches++; },
    }),
  };
});
vi.mock("./useCardControl", () => ({
  useRefreshCard: () => ({ mutate: (id: string) => { read.rereads.push(id); } }),
}));

import ActiveOverridesPanel from "./ActiveOverridesPanel.vue";

const render = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/fuel-cards");
  return { router, w: mount(ActiveOverridesPanel, { attachTo: document.body, global: { plugins: [router] } }) };
};

beforeEach(() => {
  read.state = "ok";
  read.refetches = 0;
  read.rereads = [];
});

describe("active fuel exceptions", () => {
  it("says the read failed, with Retry, instead of drawing nothing", async () => {
    read.state = "failed";
    const { w } = await render();
    expect(w.text()).toContain("Could not load the active fuel overrides.");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(read.refetches).toBe(1);
    w.unmount();
  });

  it("still draws nothing before first data, so it never flashes a guess", async () => {
    read.state = "loading";
    const { w } = await render();
    expect(w.text()).toBe("");
    w.unmount();
  });

  it("lists each card with an exception as a table row, its actions in the row's menu", async () => {
    const { w, router } = await render();
    expect(w.findAll("th").map((th) => th.text()).slice(0, 5)).toEqual(["Card", "Unit and driver", "Override", "Where", "Read"]);
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text()).toContain("••1234");
    expect(rows[0]!.text()).toContain("2 uses left");
    await w.get('[aria-label="Actions for card ••1234"]').trigger("click");
    const items = () => [...document.querySelectorAll<HTMLElement>("button.kebab-item")];
    expect(items().map((el) => el.textContent!.trim())).toEqual(["Re-read", "Remove override…"]);
    items()[0]!.click();
    expect(read.rereads).toEqual(["c1"]);
    await w.get('[aria-label="Actions for card ••1234"]').trigger("click");
    items()[1]!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.fullPath).toContain("/fuel-cards/c1");
    w.unmount();
  });
});
