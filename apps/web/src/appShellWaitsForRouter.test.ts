import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";

/**
 * `App.vue` renders no shell until the router has resolved the first URL (2026-10-13).
 *
 * Before that, the route is the router's start location — no meta — and the layout rule answers "the
 * signed-in shell" for every URL, `/login` included. On staging that shell mounted for a moment on the
 * sign-in page, read the org's modules with the anon key and cached the empty answer, so the person
 * who then signed in had no dispatch surfaces until a reload. This holds the router's first answer
 * back behind a guard the test controls, so "for a moment" is as long as the assertion needs.
 */
const shellMounts = vi.fn();
vi.mock("@/layouts/AppShell.vue", () => ({
  default: defineComponent({ setup: (_p, { slots }) => { shellMounts(); return () => h("div", { "data-test": "app-shell" }, slots.default?.()); } }),
}));
vi.mock("@/layouts/AuthLayout.vue", () => ({
  default: defineComponent({ setup: (_p, { slots }) => () => h("div", { "data-test": "auth-layout" }, slots.default?.()) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ isAuthenticated: false }) }));
// The chrome above the shells is not what this is about; each would want its own environment.
for (const c of ["UpdateBanner", "EnvironmentBanner", "ToastContainer", "SkipLink", "ErrorBoundary"]) {
  vi.doMock(`@/components/${c}.vue`, () => ({ default: defineComponent({ render: () => null }) }));
}
vi.mock("@/components/assistant/AssistantLauncher.vue", () => ({ default: defineComponent({ render: () => null }) }));

const App = (await import("@/App.vue")).default;

describe("the shell and the first route", () => {
  it("mounts no shell on the sign-in page while the router is still deciding, and then the auth layout", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // The app's first navigation is the one the router starts itself when it is installed, from the
    // history's current location — so the URL is put in the history, not pushed.
    const history = createMemoryHistory();
    history.replace("/login");
    const router = createRouter({
      history,
      routes: [{ path: "/login", component: { render: () => h("p", "sign in") }, meta: { public: true, layout: "auth" } }],
    });
    router.beforeEach(() => held);
    const w = mount(App, { global: { plugins: [createPinia(), router] } });
    await flushPromises();

    expect(w.find("[data-test='app-shell']").exists()).toBe(false);

    release();
    await flushPromises();
    expect(w.find("[data-test='auth-layout']").exists()).toBe(true);
    // Never — not even for the frame before the route resolved.
    expect(shellMounts).not.toHaveBeenCalled();
  });
});
