import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * /chat (CH2; CHAT-REDESIGN-PLAN §4) — the page's own decisions: it waits for the plan before saying
 * anything about it; the open conversation is `?c=` and the open channel `?ch=`, each written alone, and
 * a value that is not an id is never sent; picking one person opens the direct conversation while
 * several make a group; an unread conversation that is opened is read to its last line, and the New
 * line remembers where that read started.
 */
const state = vi.hoisted(() => ({
  modules: "has" as "has" | "lacks" | "pending",
  conversations: [] as unknown[],
  teams: { teams: [], can_manage: false } as unknown,
  conversationAsked: [] as Array<string | null>,
  openDirect: vi.fn(async () => "33333333-3333-4333-8333-333333333333"),
  createGroup: vi.fn(async () => "44444444-4444-4444-8444-444444444444"),
  markRead: vi.fn(),
  detail: null as unknown,
  followed: [] as Array<string | null>,
  inboxKinds: null as string[] | null,
  earlier: vi.fn(),
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
  const qs = (data: unknown) => ({ data: ref(data), isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() });
  return {
    mergeLines: () => [],
    useChatInboxQuery: (_enabled: unknown, kinds?: string[]) => {
      state.inboxKinds = kinds ?? null;
      return qs({ conversations: state.conversations, next: null, unread_total: 0 });
    },
    useChatPeopleQuery: () => qs([]),
    useChatConversationQuery: (id: { value: string | null }) => {
      const r = qs(state.detail);
      watch(() => id.value, (v) => state.conversationAsked.push(v), { immediate: true });
      return r;
    },
    useChatSend: () => ({ mutate: vi.fn(), isPending: ref(false) }),
    useChatLoadEarlier: () => ({ mutate: state.earlier, isPending: ref(false), isError: ref(false) }),
    useChatMarkRead: () => ({ mutate: state.markRead }),
    useChatOpenDirect: () => ({ mutateAsync: state.openDirect, isPending: ref(false) }),
    useChatCreateGroup: () => ({ mutateAsync: state.createGroup, isPending: ref(false) }),
    useChatMessageActions: () => ({ edit: { mutateAsync: vi.fn() }, retract: { mutateAsync: vi.fn() } }),
  };
});
vi.mock("@/features/chat/teams/useChatTeams", async () => {
  const { ref } = await import("vue");
  return {
    useChatTeamsQuery: () => ({ data: ref(state.teams), isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
  };
});
vi.mock("@/features/chat/teams/useChatRailActions", async () => {
  const { computed, ref } = await import("vue");
  return {
    useChatRailActions: () => ({
      channelFor: ref(null), peopleFor: ref(null), creatingTeam: ref(false),
      members: { data: ref([]) }, people: { data: ref([]) },
      onJoin: vi.fn(), onLeaveTeam: vi.fn(), onCreateChannel: vi.fn(), onAddPeople: vi.fn(), onCreateTeam: vi.fn(),
      createChannelBusy: computed(() => false), addPeopleBusy: computed(() => false), createTeamBusy: computed(() => false),
    }),
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
  return { chatLinkState: ref("off") };
});
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "11111111-1111-4111-8111-111111111111", fullName: "Ana" }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

// The channel side has its own tests (ChatChannelStage.test.ts); here it is the thing `?ch=` shows.
vi.mock("@/features/chat/teams/ChatChannelStage.vue", () => ({
  default: { props: ["entitled", "viewerName"], template: `<div data-test="channel-stage" />` },
}));
import ChatPage from "./ChatPage.vue";
import ChatRail from "@/features/chat/ChatRail.vue";
import NewChatDialog from "@/features/chat/NewChatDialog.vue";

const T = "33333333-3333-4333-8333-333333333333";
const CH = "77777777-7777-4777-8777-777777777777";

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
  document.body.innerHTML = "";
  state.modules = "has";
  state.conversations = [];
  state.teams = { teams: [], can_manage: false };
  state.conversationAsked = [];
  state.detail = null;
  state.followed = [];
  state.openDirect.mockClear();
  state.createGroup.mockClear();
  state.markRead.mockClear();
  state.earlier.mockClear();
});

describe("ChatPage", () => {
  it("says nothing about the plan, and offers nothing, until the plan has answered", async () => {
    state.modules = "pending";
    const { w } = await render();
    expect(w.text()).not.toContain("isn't part of your plan");
    expect(w.find('button[aria-label="New"]').exists()).toBe(false);
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

  it("reads an opened conversation to its last line when it has unread, and hands the stage where unread started", async () => {
    state.detail = {
      conversation: { thread_id: T, kind: "direct", subject: null, title_members: [], member_count: 2, unread: 2, last_seq: 7, read_seq: 5 },
      members: [], messages: [], before_seq: null,
    };
    const { w } = await render(`/chat?c=${T}`);
    expect(state.markRead).toHaveBeenCalledWith({ threadId: T, seq: 7 });
    expect(w.findComponent({ name: "ChatConversationStage" }).props("firstUnreadSeq")).toBe(6);
  });

  it("opens the direct conversation for one person, and a named group for several", async () => {
    const { w, router } = await render();
    const dialog = w.findComponent(NewChatDialog);
    dialog.vm.$emit("start", ["22222222-2222-4222-8222-222222222222"], null);
    await flushPromises();
    expect(state.openDirect).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    expect(router.currentRoute.value.query).toEqual({ c: T });

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

  it("tells an empty inbox how to begin, and the empty stage what to do", async () => {
    const { w } = await render();
    expect(w.text()).toContain("No conversations yet");
    expect(w.text()).toContain("Pick a conversation or a channel, or start one with New.");
  });

  it("lists direct and group conversations under Chats — channels are listed by their team", async () => {
    await render();
    expect(state.inboxKinds).toEqual(["direct", "group"]);
  });

  it("shows the channel stage for ?ch=, and opens no conversation then, whatever ?c= says", async () => {
    const { w } = await render(`/chat?ch=${CH}&c=${T}`);
    expect(w.find('[data-test="channel-stage"]').exists()).toBe(true);
    expect(state.conversationAsked.every((v) => v === null)).toBe(true);
  });

  it("writes the open item alone into the URL: a conversation drops the channel and its thread, a channel drops the conversation", async () => {
    const { w, router } = await render(`/chat?ch=${CH}&post=${T}&view=teams`);
    w.findComponent(ChatRail).vm.$emit("open-conversation", T);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ c: T });
    w.findComponent(ChatRail).vm.$emit("open-channel", CH);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ ch: CH });
  });

  it("opens the New conversation dialog from the rail's New menu", async () => {
    const { w } = await render();
    expect(w.findComponent(NewChatDialog).props("open")).toBe(false);
    w.findComponent(ChatRail).vm.$emit("new-conversation");
    await flushPromises();
    expect(w.findComponent(NewChatDialog).props("open")).toBe(true);
  });
});
