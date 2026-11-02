import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type Component } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { CHAT_CATCHUP_DAILY_CAP, type ChatConversationResponse } from "@silvicom/shared";

/**
 * "Catch me up" (OFFICE-CHAT-PLAN CH12) as the person meets it:
 *  · offered in a conversation's and a channel's menu only where the page turned it on (ChatPage turns
 *    it on for a carrier with `chat_ai`, ChatPage.test.ts), and nowhere else;
 *  · each opening asks once — never on mount while closed — and the summary says it is AI's, from how
 *    many lines, and that nothing was marked read; what is left is the server's count;
 *  · nothing unread says "up to date"; the day's cap used says so with the cap; a failure says why
 *    and asks again on Retry.
 */
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("./transport", async () => ({ chatLinkState: (await import("vue")).ref("off") }));

import ChatCatchupDialog from "./ChatCatchupDialog.vue";
import ChatConversationStage from "./ChatConversationStage.vue";
import ChatChannelPane from "./teams/ChatChannelPane.vue";
import { provideChatCatchup } from "./useChatCatchup";

const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  document.body.innerHTML = "";
  apiFetch.mockReset();
});
const ok = (data: unknown) => ({ ok: true, status: 200, data, error: null });
const refused = (status: number, message: string) => ({ ok: false, status, data: null, error: { message } });

/** Mounts `child` under a page that provides the switch as `on`, with a query client. */
function withPage(child: () => ReturnType<typeof h>, on: boolean | null) {
  const Host = defineComponent({
    setup() {
      if (on !== null) provideChatCatchup(ref(on));
      return child;
    },
  });
  const w = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] }, attachTo: document.body });
  mounted.push(w);
  return w;
}
const dialog = (open = true) => withPage(() => h(ChatCatchupDialog, { threadId: T, open }), null);
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("ChatCatchupDialog", () => {
  it("asks once on opening and shows the summary as AI's, from how many lines, with the server's count left", async () => {
    apiFetch.mockResolvedValue(ok({ summary: "Ben moved load 0137581 to Truck 506.", lines: 2, left: 6 }));
    dialog();
    await vi.waitFor(() => expect(document.querySelector("[data-catchup-summary]")?.textContent).toBe("Ben moved load 0137581 to Truck 506."));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(`/api/chat/${T}/catchup`, { method: "POST" });
    expect(document.querySelector("[data-catchup-note]")?.textContent).toContain("Written by AI from 2 unread messages");
    expect(document.querySelector("[data-catchup-note]")?.textContent).toContain("Nothing was marked read");
    expect(document.querySelector("[data-catchup-left]")?.textContent).toBe(`6 of ${CHAT_CATCHUP_DAILY_CAP} catch-ups left today.`);
  });

  it("asks nothing while closed, and asks again each time it opens", async () => {
    apiFetch.mockResolvedValue(ok({ summary: "One line.", lines: 1, left: 5 }));
    const open = ref(false);
    withPage(() => h(ChatCatchupDialog, { threadId: T, open: open.value }), null);
    await flushPromises();
    expect(apiFetch).not.toHaveBeenCalled();
    open.value = true;
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    open.value = false;
    await flushPromises();
    open.value = true;
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(document.querySelector("[data-catchup-note]")?.textContent).toContain("from 1 unread message.");
  });

  it("with nothing unread, says up to date and writes no AI note", async () => {
    apiFetch.mockResolvedValue(ok({ summary: null, lines: 0, left: 7 }));
    dialog();
    await vi.waitFor(() => expect(document.querySelector("[data-catchup-empty]")).not.toBeNull());
    expect(document.querySelector("[data-catchup-note]")).toBeNull();
    expect(document.querySelector("[data-catchup-left]")?.textContent).toContain("7 of");
  });

  it("with the day's catch-ups used, says so with the cap and when they come back", async () => {
    apiFetch.mockResolvedValue(refused(429, "You have used today's catch-ups"));
    dialog();
    await vi.waitFor(() => expect(document.querySelector("[data-catchup-limit]")).not.toBeNull());
    expect(document.querySelector("[data-catchup-limit]")?.textContent).toContain(`today's ${CHAT_CATCHUP_DAILY_CAP} catch-ups`);
    expect(document.querySelector("[data-catchup-limit]")?.textContent).toContain("24 hours");
  });

  it("a failure says why, and Retry asks again", async () => {
    apiFetch.mockResolvedValueOnce(refused(503, "AI catch-up is not set up on this server"));
    dialog();
    await vi.waitFor(() => expect(text()).toContain("AI catch-up is not set up on this server"));
    apiFetch.mockResolvedValueOnce(ok({ summary: "Back.", lines: 1, left: 4 }));
    button("Retry")!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-catchup-summary]")?.textContent).toBe("Back."));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

const conversation: ChatConversationResponse = {
  conversation: {
    thread_id: T, kind: "direct", subject: null, load_id: null, created_at: "2026-11-02T10:00:00Z", last_message_at: "2026-11-02T11:00:00Z",
    last_seq: 0, rev: 0, read_seq: 0, unread: 0, muted: "none", member_role: "member", member_count: 2,
    title_members: [{ user_id: BEN, name: "Ben Admin" }], last_message: null,
  },
  members: [
    { user_id: ME, name: "Ana", member_role: "member", read_seq: 0, last_read_at: null, joined_at: "2026-11-02T10:00:00Z" },
    { user_id: BEN, name: "Ben Admin", member_role: "member", read_seq: 0, last_read_at: null, joined_at: "2026-11-02T10:00:00Z" },
  ],
  messages: [],
  before_seq: null,
};
const channel = {
  thread_id: T, name: "Loads", visibility: "public", general: false, joined: true,
  last_message_at: "2026-11-02T11:00:00Z", last_seq: 0, read_seq: 0, unread: 0, muted: "none",
};
const stages: Array<[string, string, () => ReturnType<typeof h>]> = [
  ["a conversation", "Conversation actions", () => h(ChatConversationStage as Component, { data: conversation, viewerId: ME, pending: [], sending: false })],
  ["a channel", "Channel actions", () => h(ChatChannelPane as Component, {
    channel, teamName: "Dispatch", page: { posts: [], before_seq: null }, viewerId: ME, viewerName: "Ana", pending: [], openPostId: null,
  })],
];

describe.each(stages)("Catch me up in %s's menu", (_, menu, stage) => {
  const openMenu = async (w: VueWrapper) => {
    await w.find(`button[aria-label="${menu}"]`).trigger("click");
    await flushPromises();
  };

  it("is offered where the page turned it on, and opening it asks about this conversation", async () => {
    apiFetch.mockResolvedValue(ok({ summary: "Summary.", lines: 3, left: 2 }));
    const w = withPage(stage, true);
    await openMenu(w);
    button("Catch me up")!.click();
    await vi.waitFor(() => expect(document.querySelector("[data-catchup-summary]")?.textContent).toBe("Summary."));
    expect(apiFetch).toHaveBeenCalledWith(`/api/chat/${T}/catchup`, { method: "POST" });
  });

  it("is not offered where the page turned it off, or under no page at all, and nothing is asked", async () => {
    for (const on of [false, null]) {
      const w = withPage(stage, on);
      await openMenu(w);
      expect(button("Catch me up")).toBeUndefined();
      w.unmount();
      mounted.splice(mounted.indexOf(w), 1);
      document.body.innerHTML = "";
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
