import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * Message text in notifications, in the rail (INSTALLED-APP-PLAN IA-S4). What a person relies on: the control
 * says which state they are in and what it means for a locked phone; one press changes it and the control
 * shows what the SERVER stored; a refusal is said in words and changes nothing; nothing is drawn before the
 * server has answered; and the in-tab alerts hide the text until the answer is known.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

import ChatPushPrivacy from "./ChatPushPrivacy.vue";
import { useChatPushPrivacy } from "./useChatPushPrivacy";

let server: { hide_text: boolean };
const puts = () => apiFetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([path, init]) => ({ path, body: init.body }));

beforeEach(() => {
  server = { hide_text: false };
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_path: string, init?: { method?: string; body?: { hide_text: boolean } }) => {
    if (init?.method === "PUT") server = { hide_text: init.body!.hide_text };
    return { ok: true, status: 200, data: server };
  });
});

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});
const plugins = () => [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] as never;
async function render() {
  const w = mount(ChatPushPrivacy, { attachTo: document.body, global: { plugins: plugins() } });
  mounted.push(w);
  await flushPromises();
  return w;
}
const press = async (w: VueWrapper, label: string) => {
  const b = w.findAll("button").find((x) => x.text().trim() === label);
  if (!b) throw new Error(`no button "${label}" in: ${w.text()}`);
  await b.trigger("click");
  await flushPromises();
};

describe("Message text in notifications", () => {
  it("is shown until the person hides it, and says what a locked phone shows meanwhile", async () => {
    const w = await render();
    expect(w.text()).toContain("Message text in notifications: shown");
    expect(w.text()).toContain("A locked phone shows who wrote and the start of the message.");
    expect(apiFetch.mock.calls[0]![0]).toBe("/api/chat/push/privacy");
    expect(puts()).toEqual([]);
  });

  it("hides with one press, says what that means, and shows again with another", async () => {
    const w = await render();
    await press(w, "Hide");
    expect(puts()).toEqual([{ path: "/api/chat/push/privacy", body: { hide_text: true } }]);
    expect(w.text()).toContain("Message text in notifications: hidden");
    expect(w.text()).toContain("Notifications say only who wrote, on all your devices.");
    await press(w, "Show");
    expect(puts()[1]).toEqual({ path: "/api/chat/push/privacy", body: { hide_text: false } });
    expect(w.text()).toContain("Message text in notifications: shown");
  });

  it("shows what the server stored, not what was pressed", async () => {
    apiFetch.mockImplementation(async () => ({ ok: true, status: 200, data: { hide_text: false } }));
    const w = await render();
    await press(w, "Hide");
    expect(w.text()).toContain("Message text in notifications: shown");
  });

  it("says a refusal in words and stays as it was", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "PUT" ? { ok: false, status: 403, error: { code: "forbidden", message: "Only an office member can change this" } } : { ok: true, status: 200, data: { hide_text: false } });
    const w = await render();
    await press(w, "Hide");
    expect(w.find("[role=status]").text()).toBe("Only an office member can change this");
    expect(w.text()).toContain("Message text in notifications: shown");
  });

  it("draws nothing when the setting cannot be read — never a guess", async () => {
    apiFetch.mockImplementation(async () => ({ ok: false, status: 500, error: { code: "internal", message: "down" } }));
    const w = await render();
    expect(w.text()).toBe("");
  });
});

describe("hide the text, for the in-tab alerts", () => {
  const host = async () => {
    let privacy!: ReturnType<typeof useChatPushPrivacy>;
    const Host = defineComponent({ setup() { privacy = useChatPushPrivacy(); return () => h("div"); } });
    mounted.push(mount(Host, { global: { plugins: plugins() } }));
    return privacy;
  };

  it("hides before the server has answered, then follows the answer", async () => {
    const privacy = await host();
    expect(privacy.hideText()).toBe(true);
    await flushPromises();
    expect(privacy.hideText()).toBe(false);
  });

  it("keeps hiding when the answer never comes", async () => {
    apiFetch.mockImplementation(async () => ({ ok: false, status: 500, error: { code: "internal", message: "down" } }));
    const privacy = await host();
    await flushPromises();
    expect(privacy.hideText()).toBe(true);
  });

  it("hides when the person said so", async () => {
    server = { hide_text: true };
    const privacy = await host();
    await flushPromises();
    expect(privacy.hideText()).toBe(true);
  });
});
