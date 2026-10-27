import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatTransportHandlers } from "./transport";

const captured = vi.hoisted(() => ({ handlers: null as ChatTransportHandlers | null }));
vi.mock("./transport", async () => {
  const { ref } = await import("vue");
  return {
    chatLinkState: ref("off"),
    sharedChatTransport: (handlers: () => ChatTransportHandlers) => {
      captured.handlers = handlers();
      return { start: vi.fn(), stop: vi.fn(), openConversation: vi.fn() };
    },
  };
});
vi.mock("@/lib/supabase", () => ({ supabase: {}, DEV_BYPASS: false }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "11111111-1111-4111-8111-111111111111" }) }));

import { SIGNAL_SPREAD_MS, useChatFollow } from "./chatRealtime";
import { activityKey, inboxKey, teamsKey } from "./useChat";

/**
 * What a signal on my own topic refreshes (CH3b, CH6b-2): the rail — the inbox and the teams — and
 * Activity, because a line that names me or answers my post arrives on that same signal (D-CHAT25).
 */
afterEach(() => vi.useRealTimers());

describe("a signal on my own topic", () => {
  it("refreshes the inbox, the teams and Activity, once the spread has passed", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const Host = defineComponent({ setup() { useChatFollow(ref(null)); return () => h("div"); } });
    mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: qc }]] } });
    captured.handlers!.onUserSignal({ thread_id: "t", seq: 1, rev: 1, kind: "channel", op: "message" });
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SIGNAL_SPREAD_MS);
    expect(invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly string[] }).queryKey)).toEqual([inboxKey, teamsKey, activityKey]);
  });
});
