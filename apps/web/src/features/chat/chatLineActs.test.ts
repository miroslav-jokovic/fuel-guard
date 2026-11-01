import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatMessage } from "@silvicom/shared";

/**
 * CH6c-2 on the web: what a person does to a line. What they rely on —
 *  · every line takes a reaction, a pin and a save, not only their own (the toolbar's old rule was
 *    "your lines and channel posts");
 *  · pressing a reaction they already chose takes it back, from the picker and from the bar alike;
 *  · the bar says who reacted, and marks their own;
 *  · a row with no acts provided — the compliance console's — offers none;
 *  · each act reaches its own route with exactly the body the API validates.
 */
const apiFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, data: { rev: 9 } })));
vi.mock("@/lib/api", () => ({ apiFetch }));

import ChatMessageRow from "./ChatMessageRow.vue";
import { LINE_ACTS, provideChatLineActs, type ChatLineActs } from "./useChatLineActs";
import { provideChatNames } from "./chatNames";

const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const MSG = "44444444-4444-4444-8444-444444444444";

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: MSG, thread_id: "33333333-3333-4333-8333-333333333333", seq: 3, rev: 3, sender_user_id: BEN, sender_name: "Ben Admin",
  body: "Gate code 4411", created_at: "2026-10-30T09:00:00Z", edited_at: null, deleted_at: null, parent_id: null,
  reply_count: 0, last_reply_at: null, reactions: [], pinned_at: null, saved: false, ...over,
});

/** A row under acts that are spies, or under none at all (`acts: null`) — the compliance console's case. */
function render(msg: ChatMessage, acts: ChatLineActs | null = { react: vi.fn(), pin: vi.fn(), save: vi.fn() }) {
  const Host = defineComponent({
    setup() {
      provideChatNames({ value: [{ user_id: BEN, name: "Ben Admin", role: "admin" }] } as never);
      if (acts) provide(LINE_ACTS, acts);
      return () => h(ChatMessageRow, { message: msg, viewerId: ME, first: true });
    },
  });
  return mount(Host, { attachTo: document.body });
}

afterEach(() => {
  document.body.innerHTML = "";
  apiFetch.mockClear();
});

describe("a line's acts", () => {
  it("offers react, pin and save on somebody else's line, and edit only on your own", () => {
    const w = render(message());
    expect(w.find('button[aria-label="Add a reaction"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Pin"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Save"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Edit"]').exists()).toBe(false);
    w.unmount();
  });

  it("offers none of them where no acts were provided, and only a line's own edit tools remain", () => {
    const w = render(message({ sender_user_id: ME }), null);
    expect(w.find('button[aria-label="Add a reaction"]').exists()).toBe(false);
    expect(w.find('button[aria-label="Pin"]').exists()).toBe(false);
    expect(w.find('button[aria-label="Edit"]').exists()).toBe(true);
    w.unmount();
  });

  it("adds a reaction from the picker, and takes back one you already chose", async () => {
    const acts = { react: vi.fn(), pin: vi.fn(), save: vi.fn() };
    const w = render(message({ reactions: [{ reaction: "heart", users: [ME] }] }), acts);
    await w.find('button[aria-label="Add a reaction"]').trigger("click");
    await flushPromises();
    const pick = (emoji: string) => [...document.body.querySelectorAll<HTMLButtonElement>('[aria-label="Reactions"] button')].find((b) => b.getAttribute("aria-label") === emoji)!;
    pick("👍").click();
    pick("❤️").click();
    expect(acts.react.mock.calls).toEqual([[MSG, "thumbs_up", true], [MSG, "heart", false]]);
    w.unmount();
  });

  it("draws the bar with counts and who reacted, presses your own, and toggles from it", async () => {
    const acts = { react: vi.fn(), pin: vi.fn(), save: vi.fn() };
    const w = render(message({ reactions: [{ reaction: "thumbs_up", users: [BEN, ME] }, { reaction: "done", users: [BEN] }] }), acts);
    const pills = w.findAll('[aria-label="Reactions"] button');
    expect(pills.map((p) => p.attributes("aria-label"))).toEqual(["👍 2: Ben Admin, You", "✅ 1: Ben Admin"]);
    expect(pills.map((p) => p.attributes("aria-pressed"))).toEqual(["true", "false"]);
    await pills[0]!.trigger("click");
    await pills[1]!.trigger("click");
    expect(acts.react.mock.calls).toEqual([[MSG, "thumbs_up", false], [MSG, "done", true]]);
    w.unmount();
  });

  it("pins and unpins, says Pinned on a pinned line, and saves and unsaves", async () => {
    const acts = { react: vi.fn(), pin: vi.fn(), save: vi.fn() };
    const w = render(message({ pinned_at: "2026-10-30T10:00:00Z", saved: true }), acts);
    expect(w.text()).toContain("Pinned");
    await w.find('button[aria-label="Unpin"]').trigger("click");
    await w.find('button[aria-label="Remove from Saved"]').trigger("click");
    expect(acts.pin).toHaveBeenCalledWith(MSG, false);
    expect(acts.save).toHaveBeenCalledWith(MSG, false);
    w.unmount();
  });

  it("offers nothing on a removed line, and draws no reactions or Pinned for it", () => {
    const w = render(message({ deleted_at: "2026-10-30T10:00:00Z", body: null, pinned_at: "2026-10-30T10:00:00Z", reactions: [{ reaction: "heart", users: [BEN] }] }));
    expect(w.find('[role="toolbar"]').exists()).toBe(false);
    expect(w.find('[aria-label="Reactions"]').exists()).toBe(false);
    expect(w.text()).not.toContain("Pinned");
    w.unmount();
  });
});

describe("the provider's writes", () => {
  it("sends each act to its own route with the body the API validates", async () => {
    let acts!: ChatLineActs;
    const Probe = defineComponent({
      setup() {
        acts = provideChatLineActs(() => {});
        return () => null;
      },
    });
    const w = mount(Probe, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await acts.react(MSG, "done", true);
    await acts.pin(MSG, false);
    await acts.save(MSG, true);
    expect(apiFetch.mock.calls).toEqual([
      [`/api/chat/messages/${MSG}/reactions`, { method: "POST", body: { reaction: "done", on: true } }],
      [`/api/chat/messages/${MSG}/pin`, { method: "PUT", body: { on: false } }],
      [`/api/chat/messages/${MSG}/save`, { method: "PUT", body: { on: true } }],
    ]);
    w.unmount();
  });

  it("tells a refusal to the page in the API's words, and does not throw at the row", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, data: undefined, error: { message: "That message was removed" } } as never);
    const told: string[] = [];
    let acts!: ChatLineActs;
    const Probe = defineComponent({
      setup() {
        acts = provideChatLineActs((m) => told.push(m));
        return () => null;
      },
    });
    const w = mount(Probe, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await expect(acts.pin(MSG, true)).resolves.toBeUndefined();
    expect(told).toEqual(["That message was removed"]);
    w.unmount();
  });
});
