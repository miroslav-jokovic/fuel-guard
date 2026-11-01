import { describe, expect, it } from "vitest";
import { defineComponent, h, ref, type Component } from "vue";
import { mount } from "@vue/test-utils";
import type { ChatDirectoryEntry, ChatMessage } from "@silvicom/shared";
import ChatMessageRow from "./ChatMessageRow.vue";
import ChatRail from "./ChatRail.vue";
import { provideChatNames } from "./chatNames";

/**
 * A mention on screen (D-CHAT22): the token is the record, the chip is how it reads. A reader sees the
 * person's name — their own as the stronger chip — never an id; and editing a line that names somebody
 * shows the name and saves the token, so an edit that does not touch the mention keeps it.
 */
const ME = "aaaaaaaa-1111-4111-8111-11111111abcd";
const BEN = "bbbbbbbb-2222-4222-8222-22222222beef";
const GONE = "dddddddd-4444-4444-8444-44444444dead";

const people: ChatDirectoryEntry[] = [
  { user_id: ME, name: "Ana", role: "dispatcher" },
  { user_id: BEN, name: "Ben Admin", role: "admin" },
];
const line = (body: string, sender = ME): ChatMessage => ({
  id: "00000000-0000-4000-8000-000000000001", thread_id: "33333333-3333-4333-8333-333333333333", seq: 1, rev: 1,
  sender_user_id: sender, sender_name: "Ana", body, created_at: "2026-10-27T15:00:00Z", edited_at: null, deleted_at: null,
  parent_id: null, reply_count: 0, last_reply_at: null, reactions: [], pinned_at: null, saved: false, attachments: [],
});

function withNames(component: Component, props: Record<string, unknown>) {
  const Host = defineComponent({
    setup() {
      provideChatNames(ref(people));
      return () => h(component, props);
    },
  });
  return mount(Host, { attachTo: document.body });
}

describe("a mention in a line", () => {
  it("reads as the person's name, the reader's own as the stronger chip, and an unknown one as @someone", () => {
    const w = withNames(ChatMessageRow, { message: line(`<@${BEN}> and <@${ME}>, ask <@${GONE}>`), viewerId: ME, first: true });
    const chips = w.findAll("[data-chat-mention]");
    expect(chips.map((c) => c.text())).toEqual(["@Ben Admin", "@Ana", "@someone"]);
    expect(chips[1]!.classes()).toContain("bg-brand-accent-strong");
    expect(chips[0]!.classes()).not.toContain("bg-brand-accent-strong");
    expect(w.text()).not.toContain(BEN);
  });

  it("is edited as its name and saved as its token", async () => {
    const w = withNames(ChatMessageRow, { message: line(`<@${BEN}> see this`), viewerId: ME, first: true });
    await w.find('button[aria-label="Edit"]').trigger("click");
    const ta = w.find('textarea[aria-label="Edit message"]');
    expect((ta.element as HTMLTextAreaElement).value).toBe("@Ben Admin see this");
    await ta.setValue("@Ben Admin see this now");
    await ta.trigger("keydown", { key: "Enter" });
    expect(w.findComponent(ChatMessageRow).emitted("edit")?.[0]).toEqual([line("").id, `<@${BEN}> see this now`]);
  });
});

describe("a mention in the rail's preview", () => {
  it("reads as the person's name", () => {
    const w = withNames(ChatRail, {
      conversations: [{
        thread_id: "33333333-3333-4333-8333-333333333333", kind: "direct", subject: null, load_id: null,
        created_at: "2026-10-27T14:00:00Z", last_message_at: "2026-10-27T15:00:00Z", last_seq: 1, rev: 1, read_seq: 1, unread: 0,
        muted: "none", member_role: "member", member_count: 2, title_members: [{ user_id: BEN, name: "Ben Admin" }],
        last_message: { id: "m", seq: 1, sender_user_id: BEN, sender_name: "Ben Admin", body: `<@${ME}> gate code?`, created_at: "2026-10-27T15:00:00Z", deleted: false },
      }],
      teams: [], canManage: false, selectedId: null,
      inboxLoading: false, inboxError: null, inboxRetrying: false, teamsLoading: false, teamsError: null, teamsRetrying: false,
    });
    expect(w.text()).toContain("@Ana gate code?");
    w.unmount();
  });
});
