import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { computed, defineComponent, h, ref } from "vue";
import { useAssistantStore } from "@/stores/assistant";
import { useOpenView } from "./useOpenView";

/** The dock's half of `open_view` (F21 Step 5): the page goes with the question; an opened page is followed. */
const session = vi.hoisted(() => ({ role: "admin" as string, sections: null as Record<string, string> | null, surfaces: null as Record<string, boolean> | null }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => ({ data: { value: null } }) }));

const Blank = defineComponent({ render: () => h("div") });
const docked = ref(true);

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["/fuel-spend", "/fuel-problems", "/settings/users"].map((p) => ({ path: p, component: Blank })),
  });
  await router.push(path);
  const Host = defineComponent({ setup: () => (useOpenView(computed(() => docked.value)), () => h("div")) });
  mount(Host, { global: { plugins: [router] } });
  await flushPromises();
  return router;
}

const NAV = { surfaceKey: "fuel.exceptions", query: { state: "open", trucks: "v718" }, navigate: true as const };
function answer(store: ReturnType<typeof useAssistantStore>, links: unknown[]) {
  store.turns.push({ id: store.turns.length + 1, question: "q", status: "pending", answer: null });
  const t = store.turns.at(-1)!;
  t.status = "done";
  t.answer = "Opened.";
  t.links = links as never;
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(session, { role: "admin", sections: null, surfaces: null });
  docked.value = true;
});

describe("useOpenView", () => {
  it("sends the page the person is on, and opens the page an answer opened, with its filters, once", async () => {
    const router = await mountAt("/fuel-spend");
    const store = useAssistantStore();
    expect(store.page).toBe("fuel.spend");
    answer(store, [NAV]);
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/fuel-problems?state=open&trucks=v718");
    expect(store.page).toBe("fuel.exceptions");
    // The same answer is not followed again when the person moves on.
    await router.push("/fuel-spend");
    store.turns.at(-1)!.answer = "Opened!";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/fuel-spend");
  });

  it("moves nothing for an answer without a navigate link, on /ask, or to a page this person cannot open", async () => {
    const router = await mountAt("/fuel-spend");
    const store = useAssistantStore();
    answer(store, [{ surfaceKey: "fuel.exceptions", query: { state: "open" } }]);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/fuel-spend");

    docked.value = false;
    await flushPromises();
    expect(store.page).toBeUndefined();
    answer(store, [NAV]);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/fuel-spend");

    docked.value = true;
    session.role = "technician";
    answer(store, [NAV]);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/fuel-spend");
  });
});
