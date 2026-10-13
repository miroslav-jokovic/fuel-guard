import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import DispositionSection from "@/features/recruitment/DispositionSection.vue";
import RecruitingSettingsForm from "@/features/recruitment/RecruitingSettingsForm.vue";
import SignatoryRegister from "@/features/recruitment/SignatoryRegister.vue";

/**
 * D-US5 for the three recruiting surfaces that had no suite of their own: a read that fails says so
 * and offers a Retry that asks the API again (`QueryState`). Grouped here rather than three files of
 * one case each, because the claim is the same for all three and so is the fixture.
 *
 * ⚠ What each one used to do is why it is worth pinning. The decisions panel said "Still open.
 * Nothing has been decided" — a statement about the applicant made from no data. The settings form and
 * the signatory register said the failure in a tinted line with no way back but the browser's reload.
 */
const state = vi.hoisted(() => ({ failing: true, asked: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    if (opts?.method) return { ok: true, data: {} };
    state.asked.push(url);
    if (state.failing) return { ok: false, status: 500, data: null, error: { message: "The API is down." } };
    if (url.endsWith("/dispositions")) return { ok: true, data: { dispositions: [] } };
    if (url === "/api/recruitment/settings") {
      return {
        ok: true,
        data: {
          settings: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 },
          isDefault: true,
          updatedAt: null,
        },
      };
    }
    if (url === "/api/recruitment/representatives") return { ok: true, data: { representatives: [] } };
    return { ok: true, data: {} };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => false }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

/** `retry: false` so the first failure is the one on screen, not vue-query's third attempt. */
const plugins = () => [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] as never;

const retry = async (w: ReturnType<typeof mount>) => {
  state.failing = false;
  await w.findAll("button").find((b) => b.text().trim() === "Retry")!.trigger("click");
  await settle(w);
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.failing = true;
  state.asked = [];
});

describe("a recruiting read that fails says so, with a Retry (D-US5)", () => {
  it("the decisions panel says it could not load them rather than calling the application open", async () => {
    const w = mount(DispositionSection, {
      props: { driverId: "d1", driverStatus: "applicant" },
      global: { plugins: plugins(), stubs: { SlideOver: true } },
    });
    await settle(w);
    expect(w.text()).toContain("Could not load the decisions on this application.");
    expect(w.text()).not.toContain("Still open.");

    await retry(w);

    expect(state.asked.filter((u) => u.endsWith("/dispositions"))).toHaveLength(2);
    expect(w.text()).toContain("Still open.");
  });

  it("the settings form keeps the API's sentence and gains a Retry", async () => {
    const w = mount(RecruitingSettingsForm, { global: { plugins: plugins() } });
    await settle(w);
    expect(w.get("[role=alert]").text()).toContain("The API is down.");

    await retry(w);

    expect(state.asked.filter((u) => u === "/api/recruitment/settings")).toHaveLength(2);
    expect(w.text()).toContain("These are the product's defaults.");
  });

  it("the signatory register keeps the API's sentence and gains a Retry", async () => {
    const w = mount(SignatoryRegister, { props: { kind: "representative" }, global: { plugins: plugins() } });
    await settle(w);
    expect(w.get("[role=alert]").text()).toContain("The API is down.");

    await retry(w);

    expect(state.asked.filter((u) => u === "/api/recruitment/representatives")).toHaveLength(2);
    expect(w.text()).toContain("Nobody signs for the carrier yet.");
  });
});
