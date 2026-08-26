import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h, ref } from "vue";
import ErrorBoundary from "./ErrorBoundary.vue";

const stub = { template: "<div />" };
const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: stub, meta: { title: "Dashboard" } },
      { path: "/idling", name: "idling", component: stub, meta: { title: "Idling" } },
    ],
  });

/** A child that throws on render once `boom` is set — the render-failure this boundary exists for. */
const Exploder = defineComponent({
  props: { boom: { type: Boolean, default: false } },
  setup(props) {
    return () => {
      if (props.boom) throw new Error("render blew up");
      return h("div", { class: "child" }, "fine");
    };
  },
});

beforeEach(() => {
  // Vue still warns about the caught error in dev builds; keep the test output readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function mountBoundary(boom = ref(false)) {
  const router = makeRouter();
  await router.push("/idling");
  // Mounted with a render-function slot rather than a wrapper component, so this file defines
  // exactly one component (vue/one-component-per-file). The slot reads `boom` on each render, which
  // is what makes flipping it re-render the child into throwing.
  const w = mount(ErrorBoundary, {
    global: { plugins: [router] },
    slots: { default: () => h(Exploder, { boom: boom.value }) },
  });
  return { w, router };
}

describe("ErrorBoundary (Q-UI5)", () => {
  it("renders its slot untouched while nothing is wrong", async () => {
    const { w } = await mountBoundary();
    expect(w.find(".child").exists()).toBe(true);
    expect(w.text()).not.toContain("Something went wrong");
  });

  it("replaces a render failure with an explanation instead of a blank region", async () => {
    const boom = ref(false);
    const { w } = await mountBoundary(boom);
    boom.value = true;
    await flushPromises();
    expect(w.text()).toContain("Something went wrong");
    expect(w.find(".child").exists()).toBe(false);
  });

  it("quotes a reference carrying when and where it failed", async () => {
    const boom = ref(false);
    const { w } = await mountBoundary(boom);
    boom.value = true;
    await flushPromises();
    const detail = w.find("code").text();
    expect(detail).toContain("/idling");
    expect(detail).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // No Sentry client in tests, so no event id may be invented — the measured trap in
    // errorReference.ts is that captureException() would have produced one anyway.
    expect(detail).not.toMatch(/[0-9a-f]{32}/);
  });

  it("contains the error rather than letting it re-throw through the tree", async () => {
    // The first cut returned undefined here, on the theory that Sentry's app-level errorHandler
    // should stay the single reporting path. It left the throwing child mounted, Vue re-patched it,
    // and it threw again — the boundary contained nothing. Returning false is what makes it a
    // boundary; reporting is done explicitly instead.
    const boom = ref(false);
    const { w } = await mountBoundary(boom);
    boom.value = true;
    await flushPromises();
    expect(w.text()).toContain("Something went wrong");
    // Rendering settled: a second flush does not produce a different tree or another throw.
    await flushPromises();
    expect(w.text()).toContain("Something went wrong");
  });

  it("navigating away clears it, so one broken page cannot wedge the shell", async () => {
    const boom = ref(false);
    const { w, router } = await mountBoundary(boom);
    boom.value = true;
    await flushPromises();
    expect(w.text()).toContain("Something went wrong");
    boom.value = false;
    await router.push("/");
    await flushPromises();
    expect(w.find(".child").exists()).toBe(true);
  });
});
