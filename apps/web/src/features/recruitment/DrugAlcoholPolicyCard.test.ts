import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import DrugAlcoholPolicyCard from "@/features/recruitment/DrugAlcoholPolicyCard.vue";

/**
 * Settings → Recruiting's "Drug and alcohol policy" (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, DAP2's office
 * preview). What is pinned: the text version shown is the API's, the press opens the blank policy's own
 * route in the shared viewer and closing it closes it, and a failed read says so instead of a version.
 */
const state = vi.hoisted(() => ({ ok: true, urls: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    state.urls.push(url);
    if (!state.ok) return { ok: false, error: { message: "You do not have access to recruiting." } };
    return { ok: true, data: { policy: { name: "Drug and alcohol abuse policy", version: "dap-0123456789abcdef" } } };
  }),
}));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const mountCard = () =>
  mount(DrugAlcoholPolicyCard, {
    global: {
      // No retries, so a refused read lands as an error inside the test instead of three backed-off tries later.
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
      stubs: {
        DocumentPreview: {
          props: ["open", "label", "rendered"],
          emits: ["close"],
          template:
            "<div v-if='open' data-viewer :data-path='rendered?.path' :data-label='label'><button data-close @click=\"$emit('close')\">x</button></div>",
        },
      },
    },
  });

beforeEach(() => {
  state.ok = true;
  state.urls = [];
});

describe("Settings → Recruiting: the drug and alcohol policy", () => {
  it("shows the text version the API names", async () => {
    const w = mountCard();
    await settle(w);
    expect(state.urls).toEqual(["/api/recruitment/drug-alcohol-policy"]);
    expect(w.find('[data-testid="drug-alcohol-policy-version"]').text()).toBe("Text in use: dap-0123456789abcdef");
  });

  it("opens the blank policy's route in the viewer, and closes it", async () => {
    const w = mountCard();
    await settle(w);
    expect(w.find("[data-viewer]").exists()).toBe(false);
    await w.findAll("button").find((b) => b.text() === "Preview the policy")!.trigger("click");
    const viewer = w.find("[data-viewer]");
    expect(viewer.attributes("data-path")).toBe("/api/recruitment/drug-alcohol-policy/preview.pdf");
    expect(viewer.attributes("data-label")).toBe("Drug and alcohol policy, blank");
    await w.find("[data-close]").trigger("click");
    expect(w.find("[data-viewer]").exists()).toBe(false);
  });

  it("says why when the version cannot be read, and still offers the preview", async () => {
    state.ok = false;
    const w = mountCard();
    await settle(w);
    expect(w.find('[data-testid="drug-alcohol-policy-version"]').text()).toContain("Could not load the policy's version.");
    expect(w.findAll("button").some((b) => b.text() === "Preview the policy")).toBe(true);
  });
});
