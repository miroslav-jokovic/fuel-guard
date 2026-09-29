import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import type { SelfieCheck } from "@silvicom/shared";
import SelfieCheckPanel from "@/features/recruitment/SelfieCheckPanel.vue";

/**
 * The selfie beside the licence photo (AW6, §6.7). Pinned: both photos are shown and nothing suggests
 * an answer; the three words are posted as said; a skipped selfie and one not reached yet read
 * differently; a role that may only look is not offered the buttons; and a lapsed photo URL is asked for
 * again once, not forever.
 */
const state = vi.hoisted(() => ({
  check: null as unknown,
  reads: 0,
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { verdict: (opts?.body as { verdict: string }).verdict, at: "2026-09-28T16:00:00Z" } };
    }
    state.reads += 1;
    return { ok: true, data: state.check };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const PHOTOS: SelfieCheck = {
  partOneDone: true,
  selfie: { url: "https://signed.test/selfie.webp", capturedAt: "2026-09-27T14:00:00Z" },
  licenceFront: { url: "https://signed.test/front.webp", capturedAt: "2026-09-27T13:55:00Z" },
  verdict: null,
};

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () => mount(SelfieCheckPanel, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin] } });
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
  setActivePinia(createPinia());
  state.check = PHOTOS;
  state.reads = 0;
  state.requests = [];
  state.canManage = true;
});

describe("the selfie beside the licence", () => {
  it("shows both photos, the same size, and no answer until somebody gives one", async () => {
    const w = mountPanel();
    await settle(w);
    const srcs = w.findAll("img").map((i) => i.attributes("src"));
    expect(srcs).toEqual(["https://signed.test/front.webp", "https://signed.test/selfie.webp"]);
    const classes = w.findAll("img").map((i) => i.classes().join(" "));
    expect(classes[0]).toBe(classes[1]);
    expect(w.find("[data-selfie-verdict]").exists()).toBe(false);
    // Three words, none of them pressed.
    for (const label of ["Same person", "Not the same person", "Can't tell"]) {
      expect(button(w, label)?.attributes("aria-pressed")).toBe("false");
    }
  });

  it("posts the reading as said", async () => {
    const w = mountPanel();
    await settle(w);
    await button(w, "Not the same person")!.trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{
      url: "/api/recruitment/applicants/d1/intake/selfie-verdict", method: "POST", body: { verdict: "does_not_match" },
    }]);
  });

  it("shows the reading on file, marks its button, and says what to do when it is not a match", async () => {
    state.check = { ...PHOTOS, verdict: { verdict: "unclear", at: "2026-09-28T15:00:00Z" } };
    const w = mountPanel();
    await settle(w);
    expect(w.find("[data-selfie-verdict]").text()).toContain("Can't tell");
    expect(button(w, "Can't tell")?.attributes("aria-pressed")).toBe("true");
    expect(w.text()).toContain("Check their licence against them in person");

    state.check = { ...PHOTOS, verdict: { verdict: "matches", at: "2026-09-28T15:00:00Z" } };
    const matched = mountPanel();
    await settle(matched);
    expect(matched.text()).not.toContain("Check their licence against them in person");
  });

  it("tells a selfie skipped from one not reached yet", async () => {
    state.check = { ...PHOTOS, selfie: null };
    const skipped = mountPanel();
    await settle(skipped);
    expect(skipped.text()).toContain("finished Part 1 without a photo of themselves");
    expect(skipped.findAll("button")).toHaveLength(0);

    state.check = { ...PHOTOS, selfie: null, partOneDone: false };
    const notYet = mountPanel();
    await settle(notYet);
    expect(notYet.text()).toContain("No photo yet");
  });

  it("shows a role that may only look the photos and the reading, and no buttons", async () => {
    state.canManage = false;
    state.check = { ...PHOTOS, verdict: { verdict: "matches", at: "2026-09-28T15:00:00Z" } };
    const w = mountPanel();
    await settle(w);
    expect(w.findAll("img")).toHaveLength(2);
    expect(w.find("[data-selfie-verdict]").exists()).toBe(true);
    expect(w.findAll("button")).toHaveLength(0);
  });

  /** The URLs live five minutes; a photo whose object is gone fails on a fresh one too. */
  it("asks for fresh photo URLs once when an image fails, not on every failure", async () => {
    const w = mountPanel();
    await settle(w);
    expect(state.reads).toBe(1);
    await w.findAll("img")[1]!.trigger("error");
    await settle(w);
    expect(state.reads).toBe(2);
    // The fresh URLs fail too — the object is gone: no third read, however many times it fails.
    await w.findAll("img")[0]!.trigger("error");
    await w.findAll("img")[1]!.trigger("error");
    await settle(w);
    expect(state.reads).toBe(2);
    // A picture that loads re-arms it: a URL that lapses LATER is asked for again.
    await w.findAll("img")[0]!.trigger("load");
    await w.findAll("img")[0]!.trigger("error");
    await settle(w);
    expect(state.reads).toBe(3);
  });
});
