import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { ChatMessage } from "@silvicom/shared";

/**
 * A search result opens its conversation AT the line it found (CH8, `?line=`). What a person relies on:
 *  · the line is brought into view, focused, and ringed until they move to another line;
 *  · a line older than the loaded pages is reached by loading the pages above, one at a time, never two
 *    at once, never after a failure, and at most twenty — then it says so in words;
 *  · a refetch never pulls them back to it once they have moved on.
 */
vi.mock("./transport", async () => {
  const { ref: r } = await import("vue");
  return { chatLinkState: r("live") };
});
import ChatMessageList from "./ChatMessageList.vue";
import { FOCUS_WALK_MAX_PAGES, useChatFocusWalk } from "./chatFocusWalk";
import type { MergedLine } from "./useChat";

const ME = "11111111-1111-4111-8111-111111111111";
const T = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (n: number): ChatMessage => ({
  id: id(n), thread_id: T, seq: n, rev: n, sender_user_id: ME, sender_name: "Ana", body: `line ${n}`,
  created_at: `2026-11-02T1${n % 10}:00:00Z`, edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null,
  reactions: [], pinned_at: null, saved: false, attachments: [],
});
const lines = (from: number, to: number): MergedLine[] => Array.from({ length: to - from + 1 }, (_, i) => ({ kind: "server", message: msg(from + i) }) as MergedLine);

const mounted: VueWrapper[] = [];
afterEach(() => { for (const w of mounted.splice(0)) w.unmount(); document.body.innerHTML = ""; });
function log(over: Record<string, unknown>) {
  const w = mount(ChatMessageList, {
    attachTo: document.body,
    props: { lines: lines(5, 9), viewerId: ME, viewerName: "Ana", label: "Night desk", viewKey: T, firstUnreadSeq: null, beforeSeq: 5,
      earlierLoading: false, earlierFailed: false, noun: "messages", emptyText: "None", ...over },
  });
  mounted.push(w);
  return w;
}

describe("the log brings the found line into view", () => {
  it("focuses and rings the line, and nothing else", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const w = log({ focusId: id(7) });
    await flushPromises();
    const row = document.getElementById(`chat-line-${id(7)}`)!;
    expect(document.activeElement).toBe(row);
    expect(row.hasAttribute("data-chat-found")).toBe(true);
    expect(document.querySelectorAll("[data-chat-found]")).toHaveLength(1);
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    expect(w.emitted("focus-missing")).toBeUndefined();
  });

  it("drops the ring when the reader moves to another line, and a refetch does not pull them back", async () => {
    const w = log({ focusId: id(7) });
    await flushPromises();
    document.getElementById(`chat-line-${id(8)}`)!.focus();
    await nextTick();
    expect(document.querySelectorAll("[data-chat-found]")).toHaveLength(0);
    await w.setProps({ lines: [...lines(5, 9), ...lines(10, 10)] });
    await flushPromises();
    expect(document.activeElement).toBe(document.getElementById(`chat-line-${id(8)}`));
  });

  it("asks for the page above while the line is not among its lines, and focuses it once it arrives", async () => {
    const w = log({ focusId: id(2) });
    await flushPromises();
    expect(w.emitted("focus-missing")).toHaveLength(1);
    await w.setProps({ lines: lines(1, 9) });
    await flushPromises();
    expect(document.activeElement).toBe(document.getElementById(`chat-line-${id(2)}`));
  });
});

describe("useChatFocusWalk", () => {
  const walk = (over: { beforeSeq?: number | null; loading?: boolean; failed?: boolean } = {}) => {
    const focus = ref<string | null>(id(1));
    const state = { beforeSeq: ref(over.beforeSeq === undefined ? 50 : over.beforeSeq), loading: ref(over.loading ?? false), failed: ref(over.failed ?? false) };
    const load = vi.fn();
    return { focus, state, load, w: useChatFocusWalk(focus, state, load) };
  };

  it("loads one page above per miss", () => {
    const { w, load } = walk();
    w.onMissing(); w.onMissing();
    expect(load).toHaveBeenCalledTimes(2);
    expect(w.lost.value).toBe(false);
  });

  it("never while a page is on its way", () => {
    const { w, load } = walk({ loading: true });
    w.onMissing();
    expect(load).not.toHaveBeenCalled();
    expect(w.lost.value).toBe(false);
  });

  it("stops and says so at the start of the conversation, after a failure, and after twenty pages", async () => {
    const atStart = walk({ beforeSeq: null });
    atStart.w.onMissing();
    expect(atStart.load).not.toHaveBeenCalled();
    expect(atStart.w.lost.value).toBe(true);
    const failed = walk({ failed: true });
    failed.w.onMissing();
    expect(failed.w.lost.value).toBe(true);
    const far = walk();
    for (let i = 0; i < FOCUS_WALK_MAX_PAGES + 1; i++) far.w.onMissing();
    expect(far.load).toHaveBeenCalledTimes(FOCUS_WALK_MAX_PAGES);
    expect(far.w.lost.value).toBe(true);
    // A new search result starts the count again.
    far.focus.value = id(2);
    await nextTick();
    expect(far.w.lost.value).toBe(false);
    far.w.onMissing();
    expect(far.load).toHaveBeenCalledTimes(FOCUS_WALK_MAX_PAGES + 1);
  });
});
