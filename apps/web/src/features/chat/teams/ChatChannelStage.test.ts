import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * The stage with a channel open (CH5c; CHAT-REDESIGN-PLAN §4) — its own decisions: a channel you are in
 * is read to its last post and followed; one you are not in is never read, only offered; a post goes to
 * the channel and a reply to its post; the thread is `?post=` beside `?ch=` and nothing else; General
 * cannot be left from the channel; leaving asks first; the page above is offered while there is one.
 * The rail and the team's acts are the page's now (`ChatRail.test.ts`, `ChatPage.test.ts`).
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
  confirm: vi.fn(async () => true),
  followed: [] as Array<string | null>,
  earlierPosts: vi.fn(),
  earlierReplies: vi.fn(),
  earlierFailed: false,
  members: [] as unknown[],
  teamMembers: [] as unknown[],
  teamMembersOf: [] as Array<string | null>,
  addMembers: vi.fn(async (_: unknown) => ({ added: 1 })),
  setMute: vi.fn(async (_: unknown) => ({ muted: "mentions" })),
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
    useJoinChannel: () => m(state.join),
    useLeaveChannel: () => m(state.leaveChannel),
    useEarlierPosts: () => ({ mutate: state.earlierPosts, isPending: ref(false), isError: ref(state.earlierFailed) }),
    useEarlierReplies: () => ({ mutate: state.earlierReplies, isPending: ref(false), isError: ref(state.earlierFailed) }),
    useTeamMembersQuery: (id: { value: string | null }) => {
      watch(() => id.value, (v) => state.teamMembersOf.push(v), { immediate: true });
      return q(state.teamMembers);
    },
    useAddChannelMembers: () => m(state.addMembers),
  };
});
vi.mock("../useChat", async (importOriginal) => {
  const real = await importOriginal<typeof import("../useChat")>();
  const { ref } = await import("vue");
  return {
    mergeLines: real.mergeLines,
    useChatMarkRead: () => ({ mutate: state.markRead }),
    useChatSend: () => ({ mutate: state.send, isPending: ref(false) }),
    useChatMessageActions: () => ({ edit: { mutateAsync: vi.fn() }, retract: { mutateAsync: vi.fn() } }),
    useChatMembersQuery: () => ({ data: ref(state.members) }),
    useChatSetMute: () => ({ mutateAsync: state.setMute }),
  };
});
vi.mock("../chatRealtime", async () => {
  const { watch } = await import("vue");
  return { useChatFollow: (id: { value: string | null }) => watch(() => id.value, (v) => state.followed.push(v), { immediate: true }) };
});
vi.mock("../transport", async () => {
  const { ref } = await import("vue");
  return { chatLinkState: ref("off") };
});
vi.mock("@silvicom/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@silvicom/ui")>()), useConfirm: () => state.confirm }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: ME }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ChatChannelStage from "./ChatChannelStage.vue";

const channel = (over: Record<string, unknown>) => ({
  thread_id: GENERAL, name: "General", visibility: "public", general: true, joined: true,
  last_message_at: "2026-10-25T15:00:00Z", last_seq: 4, read_seq: 4, unread: 0, muted: "none", ...over,
});
const teams = (description: string | null = null) => ({
  can_manage: false,
  teams: [{
    space_id: SPACE, name: "Dispatch", description, space_role: "member", member_count: 3, created_at: "2026-10-25T14:00:00Z",
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
const bodyButtons = (label: string) => [...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);

let router: Router;
async function render(path: string) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div/>" } }] });
  await router.push(path);
  await router.isReady();
  const w = mount(ChatChannelStage, { props: { entitled: true, viewerName: "Ana" }, global: { plugins: [router] }, attachTo: document.body });
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
  state.members = [];
  state.teamMembers = [];
  state.teamMembersOf = [];
  for (const f of [state.setMute, state.addMembers, state.markRead, state.send, state.join, state.leaveChannel, state.confirm, state.earlierPosts, state.earlierReplies]) f.mockClear();
  state.confirm.mockResolvedValue(true);
});

describe("an open channel", () => {
  it("reads a channel you are in to its last post, and follows its signals", async () => {
    await render(`/chat?ch=${LOADS}`);
    expect(state.markRead).toHaveBeenCalledWith({ threadId: LOADS, seq: 9 });
    expect(state.followed).toContain(LOADS);
  });

  it("draws the New line where unread started, from the read boundary the channel opened with", async () => {
    const w = await render(`/chat?ch=${LOADS}`);
    // read_seq 6 of 9: New sits above seq 7, which this page does not hold, so nothing is drawn…
    expect(w.find('[aria-label="New messages"]').exists()).toBe(false);
    // …and with the line on the page it is.
    state.posts = { posts: [line(6), line(7), line(8), line(9)], before_seq: null };
    const w2 = await render(`/chat?ch=${LOADS}`);
    expect(w2.find('[aria-label="New messages"]').element.nextElementSibling?.textContent).toContain("post 7");
  });

  it("never reads a channel you are not in — it offers Join instead", async () => {
    const w = await render(`/chat?ch=${YARD}`);
    expect(state.postsAsked.every((v) => v === null)).toBe(true);
    expect(state.followed.every((v) => v === null)).toBe(true);
    expect(state.markRead).not.toHaveBeenCalled();
    expect(buttons(w, "Join the channel")).toHaveLength(1);
  });

  it("posts to the channel, and opens a post's thread in the URL beside the channel alone", async () => {
    const w = await render(`/chat?view=teams&ch=${LOADS}`);
    w.findComponent({ name: "ChatChannelPane" }).vm.$emit("send", "Truck 811 is loaded");
    expect(state.send).toHaveBeenCalledWith({ threadId: LOADS, body: "Truck 811 is loaded" });
    await w.findAll("button").find((b) => b.text().startsWith("2 replies"))!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ ch: LOADS, post: POST });
  });

  it("sends a reply to the post that is open, and closes the thread back to the channel", async () => {
    const w = await render(`/chat?ch=${LOADS}&post=${POST}`);
    expect(w.text()).toContain("post 3");
    w.findComponent({ name: "ChatRepliesPane" }).vm.$emit("send", "On it");
    expect(state.send).toHaveBeenCalledWith({ threadId: LOADS, body: "On it", parentId: POST });
    await w.find('button[aria-label="Close thread"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ ch: LOADS });
  });

  it("opens a post's thread on Enter with the post focused (D-CHATUI16)", async () => {
    const w = await render(`/chat?ch=${LOADS}`);
    await w.find(`#chat-line-${POST}`).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ ch: LOADS, post: POST });
  });

  it("greets an empty General with the team's name and what its maker wrote about it; any other empty channel only says so (CR4)", async () => {
    state.teams = teams("Day and night dispatch, the board, roadside.");
    state.posts = { posts: [], before_seq: null };
    const w = await render(`/chat?ch=${GENERAL}`);
    expect(w.text()).toContain("Welcome to Dispatch");
    expect(w.text()).toContain("Day and night dispatch, the board, roadside.");
    expect(w.text()).not.toContain("No posts yet");
    const w2 = await render(`/chat?ch=${LOADS}`);
    expect(w2.text()).toContain("No posts yet. Start the channel off.");
    expect(w2.text()).not.toContain("Welcome to");
  });

  it("does not offer to leave General — that is leaving the team", async () => {
    // General's menu holds its mute only (CH6b-2); Leave is every other channel's.
    for (const [id, offered] of [[GENERAL, false], [LOADS, true]] as const) {
      const w = await render(`/chat?ch=${id}`);
      await w.find('button[aria-label="Channel actions"]').trigger("click");
      await flushPromises();
      expect(bodyButtons("Leave channel").length > 0, id).toBe(offered);
      w.unmount();
      document.body.innerHTML = "";
    }
  });

  it("asks before leaving a channel, and leaves nothing when declined", async () => {
    state.confirm.mockResolvedValue(false);
    const w = await render(`/chat?ch=${LOADS}`);
    await w.find('button[aria-label="Channel actions"]').trigger("click");
    await flushPromises();
    bodyButtons("Leave channel")[0]!.click();
    await flushPromises();
    expect(state.confirm).toHaveBeenCalled();
    expect(state.leaveChannel).not.toHaveBeenCalled();
  });
});

describe("earlier posts and replies (CH6a)", () => {
  const press = async (w: VueWrapper, label: string) => {
    await buttons(w, label)[0]!.trigger("click");
    await flushPromises();
  };

  it("offers the page above a channel's posts and a post's replies, only when there is one", async () => {
    expect(buttons(await render(`/chat?ch=${LOADS}&post=${POST}`), "Show earlier posts")).toHaveLength(0);
    state.posts = { posts: [line(40, { id: POST, reply_count: 60 })], before_seq: 40 };
    state.replies = { posts: [line(90, { parent_id: POST })], before_seq: 90 };
    const w = await render(`/chat?ch=${LOADS}&post=${POST}`);
    await press(w, "Show earlier posts");
    await press(w, "Show earlier replies");
    expect(state.earlierPosts).toHaveBeenCalledTimes(1);
    expect(state.earlierReplies).toHaveBeenCalledTimes(1);
  });

  it("says beside each button why its page failed", async () => {
    state.posts = { posts: [line(40, { id: POST, reply_count: 60 })], before_seq: 40 };
    state.replies = { posts: [line(90, { parent_id: POST })], before_seq: 90 };
    state.earlierFailed = true;
    const w = await render(`/chat?ch=${LOADS}&post=${POST}`);
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toEqual(["Could not load the earlier posts. Try again.", "Could not load the earlier replies. Try again."]);
  });

  it("pages back toward a linked post that is older than the channel's first page", async () => {
    state.posts = { posts: [line(40), line(41)], before_seq: 40 };
    const w = await render(`/chat?ch=${LOADS}&post=${POST}`);
    expect(w.text()).toContain("That post is not on this page of the channel.");
    // Both the channel's own button and the missing post's: either pages the same channel.
    expect(buttons(w, "Show earlier posts")).toHaveLength(2);
    await press(w, "Show earlier posts");
    expect(state.earlierPosts).toHaveBeenCalledTimes(1);
  });
});

describe("the channel's @ list (Q-CHAT20 (a))", () => {
  const BEN = "22222222-2222-4222-8222-222222222222";
  const CARA = "cccccccc-3333-4333-8333-33333333cafe";
  const member = (user_id: string, name: string) => ({ user_id, name, member_role: "member", read_seq: 0, last_read_at: null, joined_at: "2026-10-25T14:00:00Z" });
  const teamMember = (user_id: string, name: string) => ({ user_id, name, role: "dispatcher", space_role: "member", joined_at: "2026-10-25T14:00:00Z" });

  it("offers the channel's people, then the team's others as Add to # Loads, and adds one before naming them", async () => {
    state.members = [member(ME, "Ana"), member(BEN, "Ben")];
    state.teamMembers = [teamMember(ME, "Ana"), teamMember(BEN, "Ben"), teamMember(CARA, "Cara Ruiz")];
    const w = await render(`/chat?ch=${LOADS}`);
    expect(state.teamMembersOf).toContain(SPACE);
    const ta = w.find('textarea[aria-label="Post"]');
    await ta.setValue("@");
    (ta.element as HTMLTextAreaElement).setSelectionRange(1, 1);
    await ta.trigger("input");
    // Never yourself; members first; the one not in it says what picking does.
    expect(w.findAll('[role="option"]').map((o) => o.text())).toEqual(["Ben", "Cara RuizAdd to # Loads"]);
    await ta.trigger("keydown", { key: "ArrowDown" });
    await ta.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(state.addMembers).toHaveBeenCalledWith({ threadId: LOADS, userIds: [CARA] });
    expect((ta.element as HTMLTextAreaElement).value).toBe("@Cara Ruiz ");
  });

  it("asks for no team's people for a channel you are not in", async () => {
    await render(`/chat?ch=${YARD}`);
    expect(state.teamMembersOf.filter(Boolean)).toEqual([]);
  });
});

describe("the channel's mute (D-CHAT23)", () => {
  it("is in the header's menu, on General too, with the current level checked", async () => {
    await render(`/chat?ch=${GENERAL}`);
    document.querySelector<HTMLElement>('button[aria-label="Channel actions"]')!.click();
    await flushPromises();
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map((i) => [i.textContent?.trim(), i.getAttribute("aria-checked")])).toEqual([
      ["Notify me of everything", "true"], ["Only when I'm mentioned", "false"], ["Mute", "false"],
    ]);
    items[1]!.click();
    await flushPromises();
    expect(state.setMute).toHaveBeenCalledWith({ threadId: GENERAL, muted: "mentions" });
  });
});
