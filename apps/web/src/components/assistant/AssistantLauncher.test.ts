import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import AssistantLauncher from "./AssistantLauncher.vue";
import { useAssistantStore } from "@/stores/assistant";

/**
 * The launcher is a second door onto `/ask`, so it must open for exactly the people the `ask-ai`
 * surface admits: the admin by default, anyone else only when granted (Q-SET15).
 */
const session = vi.hoisted(() => ({
  isAuthenticated: true,
  role: "admin" as string,
  sections: null as Record<string, string> | null,
  surfaces: null as Record<string, boolean> | null,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => ({ data: { value: null } }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { answer: "ok" } })) }));

const Blank = defineComponent({ render: () => h("div") });

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Blank },
      { path: "/idling", component: Blank },
      { path: "/ask", name: "ask", component: Blank },
    ],
  });
  await router.push(path);
  const w = mount(AssistantLauncher, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return { w, router };
}

const launcher = () => document.querySelector<HTMLButtonElement>('button[aria-controls="assistant-dock"]');
const dock = () => document.getElementById("assistant-dock");

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(session, { isAuthenticated: true, role: "admin", sections: null, surfaces: null });
  document.body.innerHTML = "";
});

describe("AssistantLauncher", () => {
  it("shows for the admin and opens the dock with the page's own suggestions", async () => {
    const { w } = await mountAt("/idling");
    expect(launcher()).not.toBeNull();
    launcher()!.click();
    await flushPromises();
    expect(dock()).not.toBeNull();
    expect(dock()!.textContent).toContain("who are the worst idlers?");
    w.unmount();
  });

  it("stays hidden for a dispatcher the org has not granted Ask AI", async () => {
    session.role = "dispatcher";
    const { w } = await mountAt("/");
    expect(launcher()).toBeNull();
    w.unmount();
  });

  it("shows for a dispatcher once an admin grants the surface", async () => {
    session.role = "dispatcher";
    session.surfaces = { "ask-ai": true };
    const { w } = await mountAt("/");
    expect(launcher()).not.toBeNull();
    w.unmount();
  });

  it("never shows past a revoked Fuel section, whatever the grant says (D-SURF2)", async () => {
    session.role = "dispatcher";
    session.sections = { fuel: "none" };
    session.surfaces = { "ask-ai": true };
    const { w } = await mountAt("/");
    expect(launcher()).toBeNull();
    w.unmount();
  });

  it("is absent on /ask, where the page is the thread", async () => {
    const { w } = await mountAt("/ask");
    expect(launcher()).toBeNull();
    w.unmount();
  });

  it("toggles on Ctrl/⌘K and closes on Escape from inside the dock", async () => {
    const { w } = await mountAt("/");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    await flushPromises();
    expect(useAssistantStore().open).toBe(true);
    dock()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(useAssistantStore().open).toBe(false);
    w.unmount();
  });

  it("does not claim Escape pressed outside the dock", async () => {
    const { w } = await mountAt("/");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    await flushPromises();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(useAssistantStore().open).toBe(true);
    w.unmount();
  });
});
