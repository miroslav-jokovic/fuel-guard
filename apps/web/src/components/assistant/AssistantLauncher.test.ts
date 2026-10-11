import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** jsdom has no `PointerEvent` constructor; a MouseEvent carrying a `pointerId` is what the handlers read. */
function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerId", { value: 1 });
  launcher()!.dispatchEvent(e);
}

/** A press at (x,y), a move by (dx,dy), a release, then the click a browser fires at the end of it. */
async function dragBy(dx: number, dy: number) {
  const [x, y] = [900, 700];
  pointer("pointerdown", x, y);
  pointer("pointermove", x + dx, y + dy);
  pointer("pointerup", x + dx, y + dy);
  launcher()!.click();
  await flushPromises();
}

/** The repo's jsdom has no `localStorage` at all (see `useColorScheme.test.ts`), so install one. */
function installStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

beforeEach(() => {
  setActivePinia(createPinia());
  installStorage();
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

  it("moves when dragged, remembers where, and does not open the dock on release", async () => {
    const { w } = await mountAt("/");
    await dragBy(-300, -200);
    expect(useAssistantStore().open).toBe(false);
    expect(launcher()!.style.right).toBe("324px");
    expect(launcher()!.style.bottom).toBe("224px");
    expect(JSON.parse(localStorage.getItem("fg.assistant-launcher")!)).toEqual({ right: 324, bottom: 224 });
    w.unmount();

    const again = await mountAt("/");
    expect(launcher()!.style.right).toBe("324px");
    again.w.unmount();
  });

  it("still opens on a click that wobbles less than the drag threshold", async () => {
    const { w } = await mountAt("/");
    await dragBy(2, 1);
    expect(useAssistantStore().open).toBe(true);
    expect(localStorage.getItem("fg.assistant-launcher")).toBeNull();
    w.unmount();
  });

  it("keeps the launcher on screen however far it is dragged, or however it was stored", async () => {
    localStorage.setItem("fg.assistant-launcher", JSON.stringify({ right: 99999, bottom: -50 }));
    const { w } = await mountAt("/");
    // jsdom's window is 1024×768: 1024 − 52 − 8 = 964 at most from the right, 8 at least from the bottom.
    expect(launcher()!.style.right).toBe("964px");
    expect(launcher()!.style.bottom).toBe("8px");
    await dragBy(5000, 5000);
    expect(launcher()!.style.right).toBe("8px");
    expect(launcher()!.style.bottom).toBe("8px");
    w.unmount();
  });
});
