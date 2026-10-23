import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * /chat (CH2) — the page's own decisions: it waits for the plan before saying anything about it, the
 * open conversation is the `?c=` in the URL and a value that is not an id is never sent, picking one
 * person opens the direct conversation while several make a group, and an unread conversation that is
 * opened is read to its last line.
 */
const state = vi.hoisted(() => ({
  modules: "has" as "has" | "lacks" | "pending",
  conversations: [] as unknown[],
  conversationAsked: [] as Array<string | null>,
  openDirect: vi.fn(async () => "33333333-3333-4333-8333-333333333333"),
  createGroup: vi.fn(async () => "44444444-4444-4444-8444-444444444444"),
  markRead: vi.fn(),
  detail: null as unknown,
  followed: [] as Array<string | null>,
  setLink: (_: string) => {},
}));

vi.mock("@/composables/useModules", async () => {
  const { computed, ref } = await import("vue");
  return {
    useModulesQuery: () => ({
      data: computed(() => (state.modules === "has" ? new Set(["messages"]) : state.modules === "lacks" ? new Set<string>() : undefined)),
      isPending: ref(state.modules === "pending"),
      isError: ref(false),
      error: ref(null),
      isFetching: ref(false),
      refetch: vi.fn(),
    }),
  };
});
vi.mock("@/features/chat/useChat", async () => {
  const { ref, watch } = await import("vue");
  const q = (data: unknown) => ({ data: ref(data), isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() });
  return {
    mergeLines: () => [],
    useChatInboxQuery: () => q({ conversations: state.conversations, next: null, unread_total: 0 }),
    useChatPeopleQuery: () => q([]),
    useChatConversationQuery: (id: { value: string | null }) => {
      const r = q(state.detail);
      watch(() => id.value, (v) => state.conversationAsked.push(v), { immediate: true });
      return r;
    },
    useChatSend: () => ({ mutate: vi.fn(), isPending: ref(false) }),
    useChatMarkRead: () => ({ mutate: state.markRead }),
    useChatOpenDirect: () => ({ mutateAsync: state.openDirect, isPending: ref(false) }),
    useChatCreateGroup: () => ({ mutateAsync: state.createGroup, isPending: ref(false) }),
    useChatMessageActions: () => ({ edit: { mutateAsync: vi.fn() }, retract: { mutateAsync: vi.fn() } }),
  };
});
vi.mock("@/features/chat/chatRealtime", async () => {
  const { watch } = await import("vue");
  return {
    useChatFollow: (id: { value: string | null }) =>
      watch(() => id.value, (v) => state.followed.push(v), { immediate: true }),
  };
});
vi.mock("@/features/chat/transport", async () => {
  const { ref } = await import("vue");
  const link = ref("off");
  state.setLink = (v) => (link.value = v);
  return { chatLinkState: link };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ChatPage from "./ChatPage.vue";
import NewChatDialog from "@/features/chat/NewChatDialog.vue";

const T = "33333333-3333-4333-8333-333333333333";

async function render(path = "/chat") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div/>" }, meta: { title: "Chat" } }] });
  await router.push(path);
  await router.isReady();
  const w = mount(ChatPage, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  state.modules = "has";
  state.conversations = [];
  state.conversationAsked = [];
  state.detail = null;
  state.followed = [];
  state.setLink("off");
  state.openDirect.mockClear();
  state.createGroup.mockClear();
  state.markRead.mockClear();
});

describe("ChatPage", () => {
  it("says nothing about the plan, and offers nothing, until the plan has answered", async () => {
    state.modules = "pending";
    const { w } = await render();
    expect(w.text()).not.toContain("isn't part of your plan");
    expect(w.text()).not.toContain("New conversation");
  });

  it("says chat is not in the plan when it is not", async () => {
    state.modules = "lacks";
    const { w } = await render();
    expect(w.text()).toContain("Chat isn't part of your plan");
  });

  it("asks for the conversation in ?c=, and never for a value that is not an id", async () => {
    await render(`/chat?c=${T}`);
    expect(state.conversationAsked).toContain(T);
    state.conversationAsked = [];
    await render("/chat?c=../../etc");
    expect(state.conversationAsked.every((v) => v === null)).toBe(true);
  });

  it("reads an opened conversation to its last line when it has unread", async () => {
    state.detail = {
      conversation: { thread_id: T, kind: "direct", subject: null, title_members: [], member_count: 2, unread: 2, last_seq: 7 },
      members: [], messages: [], before_seq: null,
    };
    await render(`/chat?c=${T}`);
    expect(state.markRead).toHaveBeenCalledWith({ threadId: T, seq: 7 });
  });

  it("opens the direct conversation for one person, and a named group for several", async () => {
    const { w, router } = await render();
    const dialog = w.findComponent(NewChatDialog);
    dialog.vm.$emit("start", ["22222222-2222-4222-8222-222222222222"], null);
    await flushPromises();
    expect(state.openDirect).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    expect(router.currentRoute.value.query.c).toBe(T);

    dialog.vm.$emit("start", ["22222222-2222-4222-8222-222222222222", "55555555-5555-4555-8555-555555555555"], "Night dispatch");
    await flushPromises();
    expect(state.createGroup).toHaveBeenCalledWith({
      subject: "Night dispatch",
      memberIds: ["22222222-2222-4222-8222-222222222222", "55555555-5555-4555-8555-555555555555"],
    });
  });

  it("follows the open conversation's signals, and nothing for a value that is not an id", async () => {
    await render(`/chat?c=${T}`);
    expect(state.followed).toEqual([T]);
    state.followed = [];
    await render("/chat?c=../../etc");
    expect(state.followed).toEqual([null]);
  });

  it("says Reconnecting only when the live link is down, not while it first connects", async () => {
    for (const [link, shown] of [["reconnecting", true], ["connecting", false], ["live", false], ["off", false]] as const) {
      state.setLink(link);
      const { w } = await render();
      expect(w.text().includes("Reconnecting"), link).toBe(shown);
      w.unmount();
    }
  });

  it("tells an empty inbox how to begin", async () => {
    const { w } = await render();
    expect(w.text()).toContain("No conversations yet");
  });
});
