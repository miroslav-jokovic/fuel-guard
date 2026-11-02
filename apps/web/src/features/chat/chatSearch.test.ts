import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatSearchLine, ChatSearchResponse } from "@silvicom/shared";

/**
 * Office chat search on the web (OFFICE-CHAT-PLAN CH8). What a person relies on:
 *  · nothing is asked of the server until there are words, and then exactly those words, kept to one
 *    conversation when the search came from its menu;
 *  · each line found says who, where and when, and opens where it lives (a reply in its post's thread);
 *  · "Show earlier" pages back from the last line shown;
 *  · it says when nothing matched, and when the search failed;
 *  · typing in the stage's field hands the new words to the page (which puts them in the address);
 *  · the conversation's and the channel's menus each carry "Search in this …".
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

import ChatSearchStage from "./ChatSearchStage.vue";
import { provideChatNames } from "./chatNames";

const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const CH = "44444444-4444-4444-8444-444444444444";
const POST = "55555555-5555-4555-8555-555555555555";
const id = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;

const line = (n: number, over: Partial<ChatSearchLine> = {}): ChatSearchLine => ({
  id: id(n), thread_id: T1, kind: "group", subject: "Night desk", space_id: null, parent_id: null, seq: n,
  sender_user_id: BEN, sender_name: "Ben Admin", body: `Truck 702 is loaded ${n}`, created_at: "2026-11-02T15:00:00Z", ...over,
});
const ok = (data: ChatSearchResponse) => ({ ok: true, status: 200, data, error: null });
const urls = () => apiFetch.mock.calls.map((c) => String(c[0]));
const params = (url: string) => Object.fromEntries(new URL(url, "http://x").searchParams);

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  document.body.innerHTML = "";
});

function stage(props: { q: string; within?: string | null; withinLabel?: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({
    setup() {
      provideChatNames(ref([]));
      return () => h(ChatSearchStage, {
        q: props.q, within: props.within ?? null, withinLabel: props.withinLabel ?? null, viewerId: ME,
        titleOf: (t: string) => (t === T1 ? "Night desk" : t === CH ? "Ben Admin" : null),
      });
    },
  });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
  mounted.push(w);
  return { w, s: w.findComponent(ChatSearchStage) };
}

describe("the Search stage", () => {
  it("asks nothing while there are no words, says what to type, and puts the caret in the field", async () => {
    const { w } = stage({ q: "   " });
    await flushPromises();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(w.text()).toContain("Type a word, a name or a load number.");
    expect(document.activeElement).toBe(w.find("input").element);
  });

  it("asks for exactly the words, everywhere, and lists each line with who, where and its words", async () => {
    apiFetch.mockResolvedValue(ok({ items: [line(2), line(1)], next: null }));
    const { w } = stage({ q: " truck 702 " });
    await flushPromises();
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toMatch(/^\/api\/chat\/search\?/);
    expect(params(urls()[0]!)).toEqual({ q: "truck 702" });
    const rows = w.findAll("ul[aria-label='Messages found'] li");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Ben Admin in Night desk");
    expect(rows[0]!.text()).toContain("Truck 702 is loaded 2");
    expect(w.text()).toContain("In every conversation you are in");
    expect(w.text()).not.toContain("Search everywhere");
  });

  it("kept to one conversation, asks with it, says so, and offers Search everywhere", async () => {
    apiFetch.mockResolvedValue(ok({ items: [], next: null }));
    const { w, s } = stage({ q: "reefer", within: CH, withinLabel: "# Loads" });
    await flushPromises();
    expect(params(urls()[0]!)).toEqual({ q: "reefer", thread: CH });
    expect(w.text()).toContain("In # Loads");
    expect(w.text()).toContain("No messages match “reefer” in # Loads.");
    await w.findAll("button").find((b) => b.text() === "Search everywhere")!.trigger("click");
    expect(s.emitted("everywhere")).toHaveLength(1);
  });

  it("opens a line where it lives — a conversation's in it, a channel reply in its post's thread — at the line", async () => {
    apiFetch.mockResolvedValue(ok({ items: [line(1), line(2, { thread_id: CH, kind: "channel", subject: "Loads", parent_id: POST })], next: null }));
    const { w, s } = stage({ q: "truck" });
    await flushPromises();
    const rows = w.findAll("ul[aria-label='Messages found'] li button");
    expect(rows[1]!.text()).toContain("Ben Admin in # Loads");
    await rows[0]!.trigger("click");
    await rows[1]!.trigger("click");
    // `line` names the line itself, so the log brings it into view.
    expect(s.emitted("open")).toEqual([[{ c: T1, line: id(1) }], [{ ch: CH, post: POST, line: id(2) }]]);
  });

  it("a direct line the other person sent names them once, not 'Ben Admin in Ben Admin'; one you sent says who it was with", async () => {
    apiFetch.mockResolvedValue(ok({ items: [
      line(1, { kind: "direct", subject: null, thread_id: CH }),
      line(2, { kind: "direct", subject: null, thread_id: CH, sender_user_id: ME, sender_name: "Ana" }),
    ], next: null }));
    const { w } = stage({ q: "truck" });
    await flushPromises();
    // The name line: the sender, then "in …" only when it says something.
    const heads = w.findAll("ul[aria-label='Messages found'] li span.truncate").map((s) => s.text().trim());
    expect(heads).toEqual(["Ben Admin", "Ana in Ben Admin"]);
  });

  it("Show earlier pages back from the last line shown", async () => {
    apiFetch.mockResolvedValueOnce(ok({ items: [line(3), line(2)], next: { before_at: "2026-11-02T14:00:00Z", before_id: id(2) } }));
    apiFetch.mockResolvedValueOnce(ok({ items: [line(1)], next: null }));
    const { w } = stage({ q: "truck" });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Show earlier")!.trigger("click");
    await flushPromises();
    expect(params(urls()[1]!)).toEqual({ q: "truck", before_at: "2026-11-02T14:00:00Z", before_id: id(2) });
    expect(w.findAll("ul[aria-label='Messages found'] li")).toHaveLength(3);
    expect(w.findAll("button").some((b) => b.text() === "Show earlier")).toBe(false);
  });

  it("says when nothing matched, and when the search failed", async () => {
    apiFetch.mockResolvedValueOnce(ok({ items: [], next: null }));
    const a = stage({ q: "banana" });
    await flushPromises();
    expect(a.w.text()).toContain("No messages match “banana”.");
    apiFetch.mockResolvedValueOnce({ ok: false, status: 500, data: null, error: { message: "Could not search the messages." } });
    const b = stage({ q: "pear" });
    await flushPromises();
    expect(b.w.text()).toContain("Could not search the messages.");
  });

  it("hands what is typed in its field to the page", async () => {
    const { w, s } = stage({ q: "" });
    await w.find("input").setValue("detention");
    await new Promise((r) => setTimeout(r, 300));
    expect(s.emitted("update:q")).toEqual([["detention"]]);
  });
});
