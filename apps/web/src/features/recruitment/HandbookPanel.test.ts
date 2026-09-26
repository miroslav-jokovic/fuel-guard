import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import HandbookPanel from "@/features/recruitment/HandbookPanel.vue";

/**
 * The handbook's office screen (HANDBOOK-SIGNING-PLAN.md HB4). ⚠ Pins the ONE move each state
 * offers and the body each act posts — the server re-decides everything, and only the body says a
 * panel asked for the right thing.
 */
const REP = "11111111-2222-4333-8444-555555555555";
const state = vi.hoisted(() => ({
  handbook: null as unknown,
  reps: [] as unknown[],
  calls: [] as Array<{ url: string; method: string; body: unknown }>,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.calls.push({ url, method, body: opts?.body });
      return { ok: true, data: {} };
    }
    if (url.endsWith("/representatives")) return { ok: true, data: { representatives: state.reps } };
    return { ok: true, data: { handbook: state.handbook } };
  }),
}));

const status = (over: Record<string, unknown> = {}) => ({
  canOpen: true, openedAt: null, driverSigned: [], driverComplete: false, filedAt: null,
  linkExpiresAt: "2099-01-01T00:00:00.000Z", ...over,
});

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () =>
  mount(HandbookPanel, { props: { driverId: "d1", done: false }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text));

beforeEach(() => {
  setActivePinia(createPinia());
  state.calls = [];
  state.reps = [{ id: REP, full_name: "Miroslav Jokovic", title: "Safety manager", created_at: "" }];
});

describe("before the application is filed", () => {
  it("says the handbook comes after it, and offers no Open", async () => {
    state.handbook = status({ canOpen: false });
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("signed after the application");
    expect(button(w, "Open handbook signing")).toBeUndefined();
  });
});

describe("opening it", () => {
  it("posts Open for this applicant", async () => {
    state.handbook = status();
    const w = mountPanel();
    await settle(w);
    await button(w, "Open handbook signing")!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([{ url: "/api/recruitment/applicants/d1/handbook/open", method: "POST", body: {} }]);
  });
});

describe("while the driver signs", () => {
  it("shows how many places are signed and offers no countersignature yet", async () => {
    state.handbook = status({ openedAt: "2026-09-25T11:00:00Z", driverSigned: ["h1", "h2"] });
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("The driver has signed 2 of 5");
    expect(button(w, "Countersign and file")).toBeUndefined();
  });
});

describe("keeping the driver's link alive (APPLICATION-FLOW-V2-PLAN.md A-2)", () => {
  it("shows when the link lapses and extends it through the Open door, once signing is open", async () => {
    state.handbook = status({ openedAt: "2026-09-25T20:08:00Z", driverSigned: ["h1"] });
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("The driver's link is open until");
    await button(w, "Extend the driver's link")!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([{ url: "/api/recruitment/applicants/d1/handbook/open", method: "POST", body: {} }]);
  });

  it("says a lapsed link has expired, and still offers the extension", async () => {
    state.handbook = status({ openedAt: "2026-09-25T20:08:00Z", linkExpiresAt: "2026-09-20T00:00:00.000Z" });
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("The driver's link expired on");
    expect(button(w, "Extend the driver's link")).toBeDefined();
  });

  it("offers no extension once the handbook is filed", async () => {
    state.handbook = status({ openedAt: "t", filedAt: "2026-09-26T10:00:00Z", driverComplete: true, driverSigned: ["h1", "h2", "h3", "h4", "h5"] });
    const w = mountPanel();
    await settle(w);
    expect(button(w, "Extend the driver's link")).toBeUndefined();
  });
});

describe("countersigning", () => {
  it("posts the chosen Representative once the driver is done", async () => {
    state.handbook = status({ openedAt: "t", driverSigned: ["h1", "h2", "h3", "h4", "h5"], driverComplete: true });
    const w = mountPanel();
    await settle(w);
    const pick = w.findAllComponents({ name: "AppCombobox" })[0]!;
    pick.vm.$emit("update:modelValue", REP);
    await settle(w);
    await button(w, "Countersign and file")!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([
      { url: "/api/recruitment/applicants/d1/handbook/countersign", method: "POST", body: { representative_id: REP } },
    ]);
  });

  it("asks for a Representative first when there is none", async () => {
    state.reps = [];
    state.handbook = status({ openedAt: "t", driverSigned: ["h1", "h2", "h3", "h4", "h5"], driverComplete: true });
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("Add a representative");
    expect(button(w, "Countersign and file")).toBeUndefined();
  });
});

describe("the Representatives (D-HB3)", () => {
  it("removes one by id", async () => {
    state.handbook = status({ canOpen: false });
    const w = mountPanel();
    await settle(w);
    await button(w, "Remove")!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([{ url: `/api/recruitment/representatives/${REP}`, method: "DELETE", body: undefined }]);
  });
});
