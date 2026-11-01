import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { applyLanguage } from "@/features/apply/language";
import ApplyVideosPage from "@/pages/ApplyVideosPage.vue";

/**
 * The applicant's orientation videos page (HW8a, 0539), against a stubbed `fetch`: the list of links, a
 * pressed link reported as opened, the one tick with a name — sent with every video the page showed —
 * and Spanish.
 */
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: { token: "tok" } }),
}));

const state = vi.hoisted(() => ({
  page: null as unknown,
  posts: [] as Array<{ url: string; body: unknown }>,
  refuse: null as null | { code: string; message: string },
}));

const V1 = "90000000-0000-4000-8000-000000000001";
const V2 = "90000000-0000-4000-8000-000000000002";
const PAGE = {
  carrier: "Silvicom Inc",
  videos: [
    { id: V1, title: "Pre-trip", url: "https://v.example/1", minutes: 10, required: true, attested: false },
    { id: V2, title: "Using the ELD", url: "https://v.example/2", minutes: null, required: false, attested: false },
  ],
  lastAttestation: null,
};

beforeEach(() => {
  state.page = PAGE;
  state.posts = [];
  state.refuse = null;
  applyLanguage.value = "en";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      state.posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (state.refuse) return new Response(JSON.stringify({ error: state.refuse }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, attestedAt: "2026-10-31T15:00:00Z" }), { status: 201 });
    }
    return new Response(JSON.stringify(state.page), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPage = async () => {
  const w = mount(ApplyVideosPage, { global: { plugins: [VueQueryPlugin], stubs: { RouterLink: true } } });
  await settle(w);
  return w;
};

describe("ApplyVideosPage", () => {
  it("lists each video as a link, with required or optional and its minutes", async () => {
    const w = await mountPage();
    expect(w.text()).toContain("Silvicom Inc asks you to watch these before you come in.");
    expect(w.get(`[data-testid="open-${V1}"]`).attributes("href")).toBe("https://v.example/1");
    expect(w.text()).toContain("Required · 10 min");
    expect(w.text()).toContain("Optional");
  });

  it("reports a pressed link as opened, to this link's own route", async () => {
    const w = await mountPage();
    await w.get(`[data-testid="open-${V1}"]`).trigger("click");
    await settle(w);
    expect(state.posts).toEqual([{ url: `/api/public/application/tok/videos/${V1}/opened`, body: null }]);
  });

  it("sends 'I watched these' only with the tick and a name, naming every video on the page", async () => {
    const w = await mountPage();
    const send = () => w.get('[data-testid="attest-send"]');
    expect(send().attributes("disabled")).toBeDefined();
    w.get('[data-testid="attest"]').findComponent({ name: "AppCheckbox" }).vm.$emit("update:modelValue", true);
    await settle(w);
    expect(send().attributes("disabled")).toBeDefined();
    await w.get('[data-testid="attest"] input:not([type="checkbox"])').setValue("Ana Plicant");
    await settle(w);
    await send().trigger("click");
    await settle(w);
    expect(state.posts).toEqual([{ url: "/api/public/application/tok/videos/attest", body: { name: "Ana Plicant", videoIds: [V1, V2] } }]);
  });

  it("will not send a name without the tick — the tick is the statement", async () => {
    const w = await mountPage();
    await w.get('[data-testid="attest"] input:not([type="checkbox"])').setValue("Ana Plicant");
    await settle(w);
    expect(w.get('[data-testid="attest-send"]').attributes("disabled")).toBeDefined();
  });

  it("says the list changed when the server refuses the tick for it", async () => {
    state.refuse = { code: "list_changed", message: "x" };
    const w = await mountPage();
    w.get('[data-testid="attest"]').findComponent({ name: "AppCheckbox" }).vm.$emit("update:modelValue", true);
    await w.get('[data-testid="attest"] input:not([type="checkbox"])').setValue("Ana Plicant");
    await settle(w);
    await w.get('[data-testid="attest-send"]').trigger("click");
    await settle(w);
    expect(w.text()).toContain("The list of videos changed.");
  });

  it("once every video is ticked, says there is nothing more to do and offers no tick", async () => {
    state.page = { ...PAGE, videos: PAGE.videos.map((v) => ({ ...v, attested: true })), lastAttestation: { signerName: "Ana", attestedAt: "2026-10-31T15:00:00Z" } };
    const w = await mountPage();
    expect(w.get('[data-testid="attested"]').text()).toContain("You have watched every video.");
    expect(w.find('[data-testid="attest"]').exists()).toBe(false);
  });

  it("with no videos, says so in the carrier's name", async () => {
    state.page = { ...PAGE, videos: [] };
    const w = await mountPage();
    expect(w.get('[data-testid="no-videos"]').text()).toContain("Silvicom Inc has not added any videos yet.");
  });

  it("speaks Spanish when the applicant chose it", async () => {
    applyLanguage.value = "es";
    const w = await mountPage();
    expect(w.text()).toContain("Videos de orientación");
    expect(w.text()).toContain("Obligatorio");
  });
});
