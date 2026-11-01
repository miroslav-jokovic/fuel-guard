import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatConversationResponse, ChatMessage, ChatPostPage } from "@silvicom/shared";

const api = vi.hoisted(() => ({ routes: new Map<string, unknown>(), asked: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.asked.push(path);
    const data = api.routes.get(path);
    return data === "fail" ? { ok: false, error: { message: "The server is down." } } : { ok: true, data };
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {}, DEV_BYPASS: false }));

import { keepEarlier, prependEarlier, useChatScroll } from "./earlierPages";
import { applySync } from "./chatRealtime";
import { useChatConversationQuery, useChatLoadEarlier } from "./useChat";
import { useChannelPostsQuery, useEarlierPosts, useEarlierReplies, useRepliesQuery } from "./teams/useChatTeams";

/**
 * "Show earlier" (CH6a). What it must get right: an earlier page stays on screen through the 10 s poll
 * that answers with the newest page only; it is let go rather than shown with a hole when more than a
 * page arrived meanwhile; the realtime merge keeps working over it; and loading it leaves the reader
 * where they were instead of jumping to the bottom.
 */
const T = "22222222-2222-4222-8222-222222222222";
const P = "44444444-4444-4444-8444-444444444444";

const msg = (seq: number, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: T, seq, rev: seq,
  sender_user_id: null, sender_name: "Ana", body: `line ${seq}`, created_at: "2026-10-26T12:00:00Z",
  edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null, reactions: [], pinned_at: null, saved: false, ...patch,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const before = (lines: ChatMessage[]) => (lines[0] && lines[0].seq > 1 ? lines[0].seq : null);
const conv = (messages: ChatMessage[]): ChatConversationResponse => ({
  conversation: {
    thread_id: T, kind: "group", subject: "Night dispatch", load_id: null, created_at: "2026-10-26T11:00:00Z",
    last_message_at: "2026-10-26T12:00:00Z", last_seq: messages.at(-1)?.seq ?? 0, rev: messages.at(-1)?.rev ?? 0,
    read_seq: messages.at(-1)?.seq ?? 0, unread: 0, muted: "none", member_role: "member", member_count: 3,
    title_members: [], last_message: null,
  },
  members: [],
  messages,
  before_seq: before(messages),
});
const seqs = (p: { messages?: ChatMessage[]; posts?: ChatMessage[] } | undefined) => (p?.messages ?? p?.posts ?? []).map((m) => m.seq);

describe("keepEarlier", () => {
  it("keeps the earlier lines when the newest page meets them", () => {
    const held = conv(range(1, 8)); // an earlier page (1–4) on top of the newest (5–8)
    const next = keepEarlier("messages", held, conv(range(5, 9)));
    expect(seqs(next)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(next.before_seq).toBeNull();
  });

  it("lets them go when more than a page arrived since, rather than showing a hole", () => {
    const next = keepEarlier("messages", conv(range(1, 8)), conv(range(10, 14)));
    expect(seqs(next)).toEqual([10, 11, 12, 13, 14]);
    expect(next.before_seq).toBe(10);
  });

  it("joins channel posts by position, whose seq skips the replies between them", () => {
    const held: ChatPostPage = { posts: [msg(3), msg(7), msg(12)], before_seq: 3 };
    const next = keepEarlier("posts", held, { posts: [msg(12), msg(20)], before_seq: 12 });
    expect(seqs(next)).toEqual([3, 7, 12, 20]);
    expect(next.before_seq).toBe(3);
  });

  it("takes the answer whole when it already starts the conversation, or nothing was held", () => {
    expect(seqs(keepEarlier("messages", conv(range(3, 6)), conv(range(1, 6))))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seqs(keepEarlier("messages", undefined, conv(range(5, 6))))).toEqual([5, 6]);
  });
});

describe("prependEarlier", () => {
  it("puts the page above on top and takes its cursor", () => {
    const next = prependEarlier("messages", conv(range(5, 8)), { messages: range(1, 4), before_seq: null }, 5)!;
    expect(seqs(next)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(next.before_seq).toBeNull();
  });

  it("refuses when what it was asked for no longer sits there", () => {
    expect(prependEarlier("messages", conv(range(10, 14)), { messages: range(1, 4), before_seq: null }, 5)).toBeNull();
  });
});

function withClient<T>(setup: () => T): { qc: QueryClient; hooks: T } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  let hooks!: T;
  mount(defineComponent({ setup: () => { hooks = setup(); return () => null; } }), {
    global: { plugins: [[VueQueryPlugin, { queryClient: qc }]] },
  });
  return { qc, hooks };
}

describe("a conversation's earlier pages, through the real queries", () => {
  beforeEach(() => {
    api.routes.clear();
    api.asked.length = 0;
  });

  it("survive the poll's refetch of the newest page, and the realtime merge still applies over them", async () => {
    api.routes.set(`/api/chat/${T}`, conv(range(5, 8)));
    api.routes.set(`/api/chat/${T}/messages?before_seq=5`, { messages: range(1, 4), before_seq: null });
    const { hooks } = withClient(() => {
      const id = ref<string | null>(T);
      return { conversation: useChatConversationQuery(id), earlier: useChatLoadEarlier(id) };
    });
    await flushPromises();
    await hooks.earlier.mutateAsync();
    expect(seqs(hooks.conversation.data.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // The poll: the newest page only, one line on.
    api.routes.set(`/api/chat/${T}`, conv(range(6, 9)));
    await hooks.conversation.refetch();
    expect(seqs(hooks.conversation.data.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(hooks.conversation.data.value?.before_seq).toBeNull();

    // What a signal's /sync does to the same entry: still gapless, so it merges.
    const synced = applySync(hooks.conversation.data.value!, { changes: [msg(10)], rev: 10, more: false }, null);
    expect(seqs(synced!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("reports an earlier page that failed, keeps the page it has, and asks nothing at the start", async () => {
    api.routes.set(`/api/chat/${T}`, conv(range(5, 8)));
    api.routes.set(`/api/chat/${T}/messages?before_seq=5`, "fail");
    const { hooks } = withClient(() => {
      const id = ref<string | null>(T);
      return { conversation: useChatConversationQuery(id), earlier: useChatLoadEarlier(id) };
    });
    await flushPromises();
    await hooks.earlier.mutateAsync().catch(() => undefined);
    expect(hooks.earlier.isError.value).toBe(true);
    expect(seqs(hooks.conversation.data.value)).toEqual([5, 6, 7, 8]);

    api.routes.set(`/api/chat/${T}`, conv(range(1, 3)));
    await hooks.conversation.refetch();
    api.asked.length = 0;
    await hooks.earlier.mutateAsync();
    expect(api.asked).toEqual([]);
  });
});

describe("a channel's earlier posts and a post's earlier replies, through the real queries", () => {
  beforeEach(() => api.routes.clear());

  it("page back from the routes CH5b serves, and keep the page through a refetch", async () => {
    const base = `/api/chat/channels/${T}`;
    api.routes.set(`${base}/posts`, { posts: [msg(30), msg(40)], before_seq: 30 });
    api.routes.set(`${base}/posts?before_seq=30`, { posts: [msg(10), msg(20)], before_seq: null });
    api.routes.set(`${base}/posts/${P}/replies`, { posts: [msg(50), msg(51)], before_seq: 50 });
    api.routes.set(`${base}/posts/${P}/replies?before_seq=50`, { posts: [msg(45)], before_seq: null });
    const { hooks } = withClient(() => {
      const ch = ref<string | null>(T);
      const post = ref<string | null>(P);
      return {
        posts: useChannelPostsQuery(ch), earlierPosts: useEarlierPosts(ch),
        replies: useRepliesQuery(ch, post), earlierReplies: useEarlierReplies(ch, post),
      };
    });
    await flushPromises();
    await hooks.earlierPosts.mutateAsync();
    await hooks.earlierReplies.mutateAsync();
    expect(seqs(hooks.posts.data.value)).toEqual([10, 20, 30, 40]);
    expect(seqs(hooks.replies.data.value)).toEqual([45, 50, 51]);

    api.routes.set(`${base}/posts`, { posts: [msg(40), msg(60)], before_seq: 40 });
    await hooks.posts.refetch();
    expect(seqs(hooks.posts.data.value)).toEqual([10, 20, 30, 40, 60]);
  });
});

describe("useChatScroll", () => {
  // jsdom lays nothing out: a list's height here is 100 px per rendered line, and scrollTop is kept as
  // set. The height therefore grows only once the DOM has the new lines, as in a browser.
  const desc = {
    h: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
    t: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
  };
  const top = new WeakMap<object, number>();
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return (this as HTMLElement).childElementCount * 100; } });
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get() { return top.get(this) ?? 0; }, set(v: number) { top.set(this, v); } });
  });
  afterAll(() => {
    if (desc.h) Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc.h);
    else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    if (desc.t) Object.defineProperty(Element.prototype, "scrollTop", desc.t);
  });

  async function list(initial: string[]) {
    const lines = ref(initial);
    const lastOwn = ref(false);
    let scroll!: ReturnType<typeof useChatScroll>;
    const w = mount(defineComponent({
      setup() {
        const scroller = ref<HTMLElement | null>(null);
        scroll = useChatScroll(scroller, () => ({ view: "a", first: lines.value[0], last: lines.value.at(-1), count: lines.value.length, lastOwn: lastOwn.value }));
        return { scroller, lines };
      },
      template: `<div ref="scroller"><p v-for="l in lines" :key="l">{{ l }}</p></div>`,
    }));
    await flushPromises();
    return { lines, lastOwn, el: w.element as HTMLElement, unseen: scroll.unseen, jump: scroll.jump };
  }

  it("opens at the newest line, and follows a new one", async () => {
    const { el, lines } = await list(["m5", "m6"]);
    expect(el.scrollTop).toBe(200);
    lines.value = ["m5", "m6", "m7"];
    await flushPromises();
    expect(el.scrollTop).toBe(300);
  });

  it("keeps the reader's line in place when an earlier page lands above it", async () => {
    const { el, lines } = await list(["m5", "m6", "m7", "m8"]);
    el.scrollTop = 0; // read up to the top, pressed Show earlier
    lines.value = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
    await flushPromises();
    expect(el.scrollTop).toBe(400); // m5 is where it was: 400 px of lines now sit above it
  });

  it("does not move when neither end moved, even when a line between them grew (an edit)", async () => {
    const { el, lines } = await list(["m5", "m6", "m7"]);
    el.scrollTop = 50;
    // An edit that made m6 a line taller: the same ends, 100 px more between them.
    lines.value = ["m5", "m6", "m6 (its second line)", "m7"];
    await flushPromises();
    expect(el.scrollTop).toBe(50);
  });

  it("leaves a reader who is up the log where they are when somebody's line arrives, and counts the lines for them (D-CHATUI17)", async () => {
    const { el, lines, unseen } = await list(["m5", "m6", "m7", "m8"]);
    el.scrollTop = 0; // reading the top, 400 px of lines below
    lines.value = [...lines.value, "m9", "m10"];
    await flushPromises();
    expect(el.scrollTop).toBe(0);
    expect(unseen.value).toBe(2);
    lines.value = [...lines.value, "m11"];
    await flushPromises();
    expect(unseen.value).toBe(3);
  });

  it("follows the reader's own line wherever they are — they sent it, they want to see it land", async () => {
    const { el, lines, lastOwn, unseen } = await list(["m5", "m6", "m7", "m8"]);
    el.scrollTop = 0;
    lastOwn.value = true;
    lines.value = [...lines.value, "mine"];
    await flushPromises();
    expect(el.scrollTop).toBe(500);
    expect(unseen.value).toBe(0);
  });

  it("jump() lands on the newest line and clears the count; reaching the bottom by hand clears it too", async () => {
    const { el, lines, unseen, jump } = await list(["m5", "m6", "m7", "m8"]);
    el.scrollTop = 0;
    lines.value = [...lines.value, "m9"];
    await flushPromises();
    expect(unseen.value).toBe(1);
    jump();
    expect(el.scrollTop).toBe(500);
    expect(unseen.value).toBe(0);

    el.scrollTop = 0;
    lines.value = [...lines.value, "m10"];
    await flushPromises();
    expect(unseen.value).toBe(1);
    el.scrollTop = 600;
    el.dispatchEvent(new Event("scroll"));
    expect(unseen.value).toBe(0);
  });
});
