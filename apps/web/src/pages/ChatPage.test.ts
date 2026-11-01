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
  setMute: vi.fn(async () => ({ muted: "all" })),
  activityUnread: 0,
  activityItems: [] as unknown[],
  /** Replaces the list a mounted page holds, as a refetch would. */
  setActivityItems: (_: unknown[]) => {},
  activityRead: vi.fn(),
  activityAsked: [] as boolean[],
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
    useChatSetMute: () => ({ mutateAsync: state.setMute }),
    useChatOpenDirect: () => ({ mutateAsync: state.openDirect, isPending: ref(false) }),
    useChatCreateGroup: () => ({ mutateAsync: state.createGroup, isPending: ref(false) }),
    useChatMessageActions: () => ({ edit: { mutateAsync: vi.fn() }, retract: { mutateAsync: vi.fn() } }),
  };
});
vi.mock("@/features/chat/useChatActivity", async () => {
  const { computed, ref, watch } = await import("vue");
  return {
    useChatActivityUnreadQuery: () => ({ data: computed(() => state.activityUnread) }),
    useChatActivityQuery: (enabled: { value: boolean }) => {
      watch(() => enabled.value, (v) => state.activityAsked.push(v), { immediate: true });
      const held = ref(state.activityItems);
      state.setActivityItems = (v) => (held.value = v);
      return {
        items: computed(() => (enabled.value ? held.value : [])),
        isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
        hasNextPage: ref(false), isFetchingNextPage: ref(false), fetchNextPage: vi.fn(), refetch: vi.fn(),
      };
    },
    useChatActivityMarkRead: () => ({ mutate: state.activityRead }),
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
const T2 = "44444444-4444-4444-8444-444444444444";
const CH = "77777777-7777-4777-8777-777777777777";
const SPACE = "55555555-5555-4555-8555-555555555555";

const conversation = (thread_id: string, name: string) => ({
  thread_id, kind: "direct", subject: null, load_id: null, created_at: "2026-10-25T14:00:00Z", last_message_at: "2026-10-25T15:00:00Z",
  last_seq: 1, rev: 1, read_seq: 1, unread: 0, muted: "none", member_role: "member", member_count: 2,
  title_members: [{ user_id: "22222222-2222-4222-8222-222222222222", name }], last_message: null,
});
const team = { space_id: SPACE, name: "Dispatch", description: null, space_role: "member", member_count: 1, created_at: "2026-10-25T14:00:00Z", channels: [] };

async function render(path = "/chat") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div/>" }, meta: { title: "Chat" } }] });
  await router.push(path);
  await router.isReady();
  const w = mount(ChatPage, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}

beforeEach(() => {
  state.activityUnread = 0;
  state.activityItems = [];
  state.activityAsked = [];
  state.activityRead.mockClear();
  state.setMute.mockClear();
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

  it("opens a workspace with nothing in it on the first-run stage, with New team for a holder of Chat teams (CR4)", async () => {
    const { w } = await render();
    expect(w.text()).toContain("No conversations yet");
    expect(w.text()).toContain("Nobody has started a conversation yet");
    expect(w.text()).not.toContain("Pick one on the left");
    expect(w.findAll("button").filter((b) => b.text() === "New team")).toHaveLength(0);
    await w.findAll("button").find((b) => b.text() === "New conversation")!.trigger("click");
    expect(w.findComponent(NewChatDialog).props("open")).toBe(true);

    state.teams = { teams: [], can_manage: true };
    const { w: w2 } = await render();
    expect(w2.findAll("button").filter((b) => b.text() === "New team")).toHaveLength(1);
  });

  it("tells the empty stage what to do once anything exists, and holds the button to do it (D-CHATUI25)", async () => {
    state.teams = { teams: [team], can_manage: true };
    const { w } = await render();
    expect(w.text()).toContain("Pick one on the left, or start a new one.");
    expect(w.text()).not.toContain("Nobody has started");
    // New team belongs to the first run only; once a team exists it is the rail's New menu.
    expect(w.findAll("button").filter((b) => b.text() === "New team")).toHaveLength(0);
    await w.findAll("button").find((b) => b.text() === "New conversation")!.trigger("click");
    expect(w.findComponent(NewChatDialog).props("open")).toBe(true);
  });

  it("sends / to the rail's search and J and K along the rail, and nothing while typing (CR2)", async () => {
    state.conversations = [conversation(T, "Ben Admin"), conversation(T2, "Cal Dispatcher")];
    const { w, router } = await render();
    const key = (k: string, target: EventTarget = window) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      return flushPromises();
    };
    await key("/");
    const search = w.find("input").element as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    search.blur();
    await key("j");
    expect(router.currentRoute.value.query).toEqual({ c: T });
    await key("j");
    expect(router.currentRoute.value.query).toEqual({ c: T2 });
    await key("k");
    expect(router.currentRoute.value.query).toEqual({ c: T });
    search.focus();
    await key("j", search);
    expect(router.currentRoute.value.query).toEqual({ c: T });
    w.unmount();
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

  describe("Activity and mute (CH6b-2)", () => {
    const POST = "88888888-8888-4888-8888-888888888888";
    const item = (over: Record<string, unknown> = {}) => ({
      message_id: "99999999-9999-4999-8999-999999999999", reason: "reply", at: "2026-10-27T15:02:00.123456+00:00", unread: true,
      thread_id: CH, kind: "channel", subject: "Loads", space_id: SPACE, parent_id: POST, seq: 7,
      sender_user_id: "22222222-2222-4222-8222-222222222222", sender_name: "Ben", body: "Done.", created_at: "2026-10-27T15:02:00Z", ...over,
    });

    it("counts Activity in the rail and opens it at its own address, alone", async () => {
      state.activityUnread = 3;
      const { w, router } = await render(`/chat?c=${T}`);
      const row = w.findAll("button").find((b) => b.text().includes("Activity"))!;
      expect(row.find('[aria-label="3 unread"]').exists()).toBe(true);
      await row.trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ activity: "1" });
      expect(w.find('section[aria-label="Activity"]').exists()).toBe(true);
    });

    it("asks for the list only while it is on the stage, and reads it up to the newest item shown", async () => {
      state.activityItems = [item(), item({ message_id: T2, at: "2026-10-27T15:01:00Z" })];
      await render("/chat");
      expect(state.activityAsked).toEqual([false]);
      await render("/chat?activity=1");
      expect(state.activityRead).toHaveBeenCalledWith("2026-10-27T15:02:00.123456+00:00");
    });

    it("keeps an item that was unread when shown looking unread after the read lands, while Activity stays open", async () => {
      state.activityItems = [item()];
      const { w } = await render("/chat?activity=1");
      expect(w.find('section[aria-label="Activity"]').text()).toContain(", unread");
      state.setActivityItems([item({ unread: false })]);
      await flushPromises();
      expect(w.find('section[aria-label="Activity"]').text()).toContain(", unread");
    });

    it("reads nothing when the newest item is already read", async () => {
      state.activityItems = [item({ unread: false })];
      await render("/chat?activity=1");
      expect(state.activityRead).not.toHaveBeenCalled();
    });

    it("opens a reply in its post's thread beside the channel", async () => {
      state.activityItems = [item()];
      const { w, router } = await render("/chat?activity=1");
      expect(w.text()).toContain("Ben replied in # Loads");
      await w.find('section[aria-label="Activity"] li button').trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ ch: CH, post: POST });
    });

    it("mutes the open conversation from its header", async () => {
      state.detail = {
        conversation: { ...conversation(T, "Ben"), muted: "none" },
        members: [], messages: [], before_seq: null,
      };
      const { w } = await render(`/chat?c=${T}`);
      await w.find('button[aria-label="Conversation actions"]').trigger("click");
      await flushPromises();
      const mute = [...document.body.querySelectorAll('[role="menuitemradio"]')].find((b) => b.textContent?.trim() === "Mute") as HTMLElement;
      expect(mute).toBeTruthy();
      mute.click();
      await flushPromises();
      expect(state.setMute).toHaveBeenCalledWith({ threadId: T, muted: "all" });
    });
  });
});
