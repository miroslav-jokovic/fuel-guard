import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * The Teams side of /chat (CH5c) — the view's own decisions: the rail lists the channels you are in
 * and folds the public ones to join; joining opens the channel; a channel you are not in is never
 * read, only offered; opening a channel reads it to its last post; a post goes to the channel and a
 * reply to its post; General cannot be left from the channel; leaving asks first; and "New team"
 * shows only for a holder of `chat.teams` (the API's `can_manage`).
 */
const ME = "11111111-1111-4111-8111-111111111111";
const SPACE = "55555555-5555-4555-8555-555555555555";
const GENERAL = "66666666-6666-4666-8666-666666666666";
const LOADS = "77777777-7777-4777-8777-777777777777";
const YARD = "99999999-9999-4999-8999-999999999999";
const POST = "88888888-8888-4888-8888-888888888888";

const state = vi.hoisted(() => ({
  teams: null as unknown,
  posts: null as unknown,
  postsAsked: [] as Array<string | null>,
  replies: null as unknown,
  markRead: vi.fn(),
  send: vi.fn(),
  join: vi.fn(async () => undefined),
  leaveChannel: vi.fn(async () => undefined),
  leaveTeam: vi.fn(async () => undefined),
  confirm: vi.fn(async () => true),
  followed: [] as Array<string | null>,
  earlierPosts: vi.fn(),
  earlierReplies: vi.fn(),
  earlierFailed: false,
}));

vi.mock("./useChatTeams", async () => {
  const { ref, watch } = await import("vue");
  const q = (data: unknown) => ({ data: ref(data), isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() });
  const m = (fn: unknown) => ({ mutateAsync: fn, isPending: ref(false) });
  return {
    useChatTeamsQuery: () => q(state.teams),
    useChannelPostsQuery: (id: { value: string | null }) => {
      watch(() => id.value, (v) => state.postsAsked.push(v), { immediate: true });
      return q(state.posts);
    },
    useRepliesQuery: () => q(state.replies),
    useTeamMembersQuery: () => q([]),
    useJoinChannel: () => m(state.join),
    useLeaveChannel: () => m(state.leaveChannel),
    useLeaveTeam: () => m(state.leaveTeam),
    useAddTeamMembers: () => m(vi.fn()),
    useCreateChannel: () => m(vi.fn()),
    useEarlierPosts: () => ({ mutate: state.earlierPosts, isPending: ref(false), isError: ref(state.earlierFailed) }),
    useEarlierReplies: () => ({ mutate: state.earlierReplies, isPending: ref(false), isError: ref(state.earlierFailed) }),
  };
});
vi.mock("./useChatTeamsAdmin", async () => {
  const { ref } = await import("vue");
  return { useCreateTeam: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }) };
});
vi.mock("../useChat", async (importOriginal) => {
  const real = await importOriginal<typeof import("../useChat")>();
  const { ref } = await import("vue");
  return {
    mergeLines: real.mergeLines,
    useChatMarkRead: () => ({ mutate: state.markRead }),
    useChatSend: () => ({ mutate: state.send, isPending: ref(false) }),
    useChatMessageActions: () => ({ edit: { mutateAsync: vi.fn() }, retract: { mutateAsync: vi.fn() } }),
    useChatPeopleQuery: () => ({ data: ref([]) }),
  };
});
vi.mock("../chatRealtime", async () => {
  const { watch } = await import("vue");
  return { useChatFollow: (id: { value: string | null }) => watch(() => id.value, (v) => state.followed.push(v), { immediate: true }) };
});
vi.mock("@silvicom/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@silvicom/ui")>()), useConfirm: () => state.confirm }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: ME }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ChatTeamsView from "./ChatTeamsView.vue";

const channel = (over: Record<string, unknown>) => ({
  thread_id: GENERAL, name: "General", visibility: "public", general: true, joined: true,
  last_message_at: "2026-10-25T15:00:00Z", last_seq: 4, read_seq: 4, unread: 0, muted: "none", ...over,
});
const teams = (canManage = false) => ({
  can_manage: canManage,
  teams: [{
    space_id: SPACE, name: "Dispatch", description: null, space_role: "member", member_count: 3, created_at: "2026-10-25T14:00:00Z",
    channels: [
      channel({}),
      channel({ thread_id: LOADS, name: "Loads", general: false, last_seq: 9, read_seq: 6, unread: 3 }),
      channel({ thread_id: YARD, name: "Yard", general: false, joined: false, read_seq: null, unread: 0, muted: null }),
    ],
  }],
});
const line = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: LOADS, seq, rev: seq,
  sender_user_id: "22222222-2222-4222-8222-222222222222", sender_name: "Ben", body: `post ${seq}`,
  created_at: "2026-10-25T15:00:00Z", edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null, ...over,
});
const buttons = (w: VueWrapper, label: string) => w.findAll("button").filter((b) => b.text().trim() === label);

let router: Router;
async function render(path = "/chat?view=teams") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div/>" } }] });
  await router.push(path);
  await router.isReady();
  const w = mount(ChatTeamsView, { props: { entitled: true }, global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  state.teams = teams();
  state.posts = { posts: [line(1, { id: POST, reply_count: 2, last_reply_at: "2026-10-25T15:05:00Z" }), line(2)], before_seq: null };
  state.postsAsked = [];
  state.replies = { posts: [line(3, { parent_id: POST })], before_seq: null };
  state.followed = [];
  state.earlierFailed = false;
  for (const f of [state.markRead, state.send, state.join, state.leaveChannel, state.leaveTeam, state.confirm, state.earlierPosts, state.earlierReplies]) f.mockClear();
  state.confirm.mockResolvedValue(true);
});

describe("the rail", () => {
  it("lists the channels you are in with their unread, and folds the ones to join", async () => {
    const w = await render();
    expect(w.text()).toContain("# General");
    expect(w.find('[aria-label="3 unread"]').exists()).toBe(true);
    expect(w.text()).not.toContain("# Yard");
    await buttons(w, "1 more channel to join")[0]!.trigger("click");
    expect(w.text()).toContain("# Yard");
  });

  it("joins a channel and opens it", async () => {
    const w = await render();
    await buttons(w, "1 more channel to join")[0]!.trigger("click");
    await buttons(w, "Join")[0]!.trigger("click");
    await flushPromises();
    expect(state.join).toHaveBeenCalledWith(YARD);
    expect(router.currentRoute.value.query).toEqual({ view: "teams", ch: YARD });
  });

  it("offers New team only to a holder of Chat teams", async () => {
    expect(buttons(await render(), "New team")).toHaveLength(0);
    state.teams = teams(true);
    expect(buttons(await render(), "New team")).toHaveLength(1);
  });
});

describe("an open channel", () => {
  it("reads a channel you are in to its last post, and follows its signals", async () => {
    await render(`/chat?view=teams&ch=${LOADS}`);
    expect(state.markRead).toHaveBeenCalledWith({ threadId: LOADS, seq: 9 });
    expect(state.followed).toContain(LOADS);
  });

  it("never reads a channel you are not in — it offers Join instead", async () => {
    const w = await render(`/chat?view=teams&ch=${YARD}`);
    expect(state.postsAsked.every((v) => v === null)).toBe(true);
    expect(state.followed.every((v) => v === null)).toBe(true);
    expect(state.markRead).not.toHaveBeenCalled();
    expect(buttons(w, "Join the channel")).toHaveLength(1);
  });

  it("posts to the channel, and opens a post's replies in the URL", async () => {
    const w = await render(`/chat?view=teams&ch=${LOADS}`);
    w.findComponent({ name: "ChatChannelPane" }).vm.$emit("send", "Truck 811 is loaded");
    expect(state.send).toHaveBeenCalledWith({ threadId: LOADS, body: "Truck 811 is loaded" });
    await w.findAll("button").find((b) => b.text().startsWith("2 replies"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ view: "teams", ch: LOADS, post: POST });
  });

  it("sends a reply to the post that is open", async () => {
    const w = await render(`/chat?view=teams&ch=${LOADS}&post=${POST}`);
    expect(w.text()).toContain("post 3");
    w.findComponent({ name: "ChatRepliesPane" }).vm.$emit("send", "On it");
    expect(state.send).toHaveBeenCalledWith({ threadId: LOADS, body: "On it", parentId: POST });
  });

  it("does not offer to leave General — that is leaving the team", async () => {
    expect(buttons(await render(`/chat?view=teams&ch=${GENERAL}`), "Leave channel")).toHaveLength(0);
    expect(buttons(await render(`/chat?view=teams&ch=${LOADS}`), "Leave channel")).toHaveLength(1);
  });

  it("asks before leaving a channel, and leaves nothing when declined", async () => {
    state.confirm.mockResolvedValue(false);
    const w = await render(`/chat?view=teams&ch=${LOADS}`);
    await buttons(w, "Leave channel")[0]!.trigger("click");
    await flushPromises();
    expect(state.confirm).toHaveBeenCalled();
    expect(state.leaveChannel).not.toHaveBeenCalled();
  });

  it("leaves the team after asking, and goes back to the rail", async () => {
    const w = await render(`/chat?view=teams&ch=${LOADS}`);
    await buttons(w, "Leave team")[0]!.trigger("click");
    await flushPromises();
    expect(state.leaveTeam).toHaveBeenCalledWith(SPACE);
    expect(router.currentRoute.value.query).toEqual({ view: "teams" });
  });
});

describe("earlier posts and replies (CH6a)", () => {
  const press = async (w: VueWrapper, label: string) => {
    await buttons(w, label)[0]!.trigger("click");
    await flushPromises();
  };

  it("offers the page above a channel's posts and a post's replies, only when there is one", async () => {
    expect(buttons(await render(`/chat?view=teams&ch=${LOADS}&post=${POST}`), "Show earlier posts")).toHaveLength(0);
    state.posts = { posts: [line(40, { id: POST, reply_count: 60 })], before_seq: 40 };
    state.replies = { posts: [line(90, { parent_id: POST })], before_seq: 90 };
    const w = await render(`/chat?view=teams&ch=${LOADS}&post=${POST}`);
    await press(w, "Show earlier posts");
    await press(w, "Show earlier replies");
    expect(state.earlierPosts).toHaveBeenCalledTimes(1);
    expect(state.earlierReplies).toHaveBeenCalledTimes(1);
  });

  it("says beside each button why its page failed", async () => {
    state.posts = { posts: [line(40, { id: POST, reply_count: 60 })], before_seq: 40 };
    state.replies = { posts: [line(90, { parent_id: POST })], before_seq: 90 };
    state.earlierFailed = true;
    const w = await render(`/chat?view=teams&ch=${LOADS}&post=${POST}`);
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toEqual(["Could not load the earlier posts. Try again.", "Could not load the earlier replies. Try again."]);
  });

  it("pages back toward a linked post that is older than the channel's first page", async () => {
    state.posts = { posts: [line(40), line(41)], before_seq: 40 };
    const w = await render(`/chat?view=teams&ch=${LOADS}&post=${POST}`);
    expect(w.text()).toContain("That post is not on this page of the channel.");
    // Both the channel's own button and the missing post's: either pages the same channel.
    expect(buttons(w, "Show earlier posts")).toHaveLength(2);
    await press(w, "Show earlier posts");
    expect(state.earlierPosts).toHaveBeenCalledTimes(1);
  });
});
