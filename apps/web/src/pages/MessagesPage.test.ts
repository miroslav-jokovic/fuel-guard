import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";

/**
 * F30 (US6b batch 3) — the plan decides what the Messages page offers, and only once it has answered.
 * The browser pass found "New message" in the header of a page that said Messages was not in the
 * plan; reading the page found the other half: while the module read waited, or when it failed,
 * the page told a customer who HAD Messages that it was not part of their plan.
 */
const modules = vi.hoisted(() => ({ state: "has" as "has" | "lacks" | "pending" | "failed", refetch: vi.fn() }));
const threads = vi.hoisted(() => ({ failed: false, refetch: vi.fn() }));

vi.mock("@/composables/useModules", async () => {
  const { computed, ref: r } = await import("vue");
  return {
    useModulesQuery: () => ({
      data: computed(() =>
        modules.state === "has" ? new Set(["messages"]) : modules.state === "lacks" ? new Set<string>() : undefined),
      isPending: r(modules.state === "pending"),
      isError: r(modules.state === "failed"),
      error: r(modules.state === "failed" ? new Error("502") : null),
      isFetching: r(false),
      refetch: modules.refetch,
    }),
  };
});
vi.mock("@/features/messages/useMessages", async () => {
  const { ref: r } = await import("vue");
  return {
    useThreadsQuery: () => ({
      data: r(threads.failed ? undefined : { threads: [] }),
      isPending: r(false),
      isLoading: r(false),
      isError: r(threads.failed),
      error: r(threads.failed ? new Error("502") : null),
      isFetching: r(false),
      refetch: threads.refetch,
    }),
    useThreadDetailQuery: () => ({ data: r(undefined) }),
    useSendMessage: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
    useMarkThreadRead: () => ({ mutate: vi.fn() }),
    useComposeThreads: () => ({ mutateAsync: vi.fn(), isPending: r(false) }),
  };
});
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "u1", orgId: "o1", can: () => true }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import MessagesPage from "./MessagesPage.vue";

async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/messages", component: { template: "<div/>" }, meta: { title: "Messages" } }],
  });
  await router.push("/messages");
  await router.isReady();
  const w = mount(MessagesPage, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}
const offersNew = (w: Awaited<ReturnType<typeof render>>) => w.findAll("button").some((b) => b.text() === "New message");

beforeEach(() => {
  setActivePinia(createPinia());
  modules.state = "has";
  threads.failed = false;
});

describe("MessagesPage — what the plan allows (F30)", () => {
  it("offers no New message when Messages is not in the plan, and says why", async () => {
    modules.state = "lacks";
    const w = await render();
    expect(w.text()).toContain("Messages isn't part of your plan.");
    expect(offersNew(w)).toBe(false);
  });

  it("offers New message and the conversations when it is", async () => {
    const w = await render();
    expect(offersNew(w)).toBe(true);
    expect(w.text()).toContain("No conversations in the last 90 days.");
    expect(w.text()).not.toContain("isn't part of your plan");
  });

  it("says nothing about the plan while the plan is being read", async () => {
    modules.state = "pending";
    const w = await render();
    expect(w.text()).toContain("Loading your messages…");
    expect(w.text()).not.toContain("isn't part of your plan");
    expect(offersNew(w)).toBe(false);
  });

  it("tells a failed plan read from a plan without Messages, and asks again on Retry", async () => {
    modules.state = "failed";
    const w = await render();
    expect(w.text()).toContain("Could not check whether Messages is part of your plan.");
    expect(w.text()).not.toContain("isn't part of your plan");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(modules.refetch).toHaveBeenCalledTimes(1);
  });

  it("tells failed conversations from no conversations", async () => {
    threads.failed = true;
    const w = await render();
    expect(w.text()).toContain("Could not load the conversations.");
    expect(w.text()).not.toContain("No conversations in the last 90 days.");
  });
});
