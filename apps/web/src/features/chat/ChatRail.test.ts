import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { ChatConversation, ChatTeam } from "@silvicom/shared";
import ChatRail from "./ChatRail.vue";

/**
 * The one rail (CHAT-REDESIGN-PLAN D-CHATUI2, D-CHATUI3, D-CHATUI5): conversations and every team's
 * channels in one list, unread bold with its count, the channels to join folded, muted ones folded at
 * the bottom, a team's acts in its kebab, New in one menu, and a search that filters the lot by name.
 */
const BEN = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const T2 = "44444444-4444-4444-8444-444444444444";
const SPACE = "55555555-5555-4555-8555-555555555555";
const GENERAL = "66666666-6666-4666-8666-666666666666";
const LOADS = "77777777-7777-4777-8777-777777777777";
const YARD = "99999999-9999-4999-8999-999999999999";

const conversation = (over: Partial<ChatConversation>): ChatConversation => ({
  thread_id: T1, kind: "direct", subject: null, load_id: null, created_at: "2026-10-25T14:00:00Z", last_message_at: "2026-10-25T15:00:00Z",
  last_seq: 4, rev: 4, read_seq: 4, unread: 0, muted: "none", member_role: "member", member_count: 2,
  title_members: [{ user_id: BEN, name: "Ben Admin" }],
  last_message: { id: "m", seq: 4, sender_user_id: BEN, sender_name: "Ben Admin", body: "gate code 4411", created_at: "2026-10-25T15:00:00Z", deleted: false },
  ...over,
});
const channel = (over: Partial<ChatTeam["channels"][number]>): ChatTeam["channels"][number] => ({
  thread_id: GENERAL, name: "General", visibility: "public", general: true, joined: true,
  last_message_at: "2026-10-25T15:00:00Z", last_seq: 4, read_seq: 4, unread: 0, muted: "none", ...over,
});
const team = (over: Partial<ChatTeam> = {}): ChatTeam => ({
  space_id: SPACE, name: "Dispatch", description: null, space_role: "member", member_count: 3, created_at: "2026-10-25T14:00:00Z",
  channels: [
    channel({}),
    channel({ thread_id: LOADS, name: "Loads", general: false, last_seq: 9, read_seq: 6, unread: 3 }),
    channel({ thread_id: YARD, name: "Yard", general: false, joined: false, read_seq: null, unread: 0, muted: null }),
  ],
  ...over,
});

const mounted: VueWrapper[] = [];
function render(over: Partial<InstanceType<typeof ChatRail>["$props"]> = {}) {
  const w = mount(ChatRail, {
    attachTo: document.body,
    props: {
      conversations: [conversation({}), conversation({ thread_id: T2, kind: "group", subject: "Night dispatch", unread: 2, last_seq: 6, read_seq: 4 })],
      teams: [team()],
      canManage: false,
      selectedId: null,
      inboxLoading: false, inboxError: null, inboxRetrying: false,
      teamsLoading: false, teamsError: null, teamsRetrying: false,
      ...over,
    },
  });
  mounted.push(w);
  return w;
}
/** The search field emits after a zero debounce — a timer, not a microtask. */
const tick = () => new Promise((r) => setTimeout(r, 1));
const buttons = (w: VueWrapper, text: string) => w.findAll("button").filter((b) => b.text().trim() === text);
// A described menu item (KebabMenuItem) is named by its label line; a plain kebab item by its text.
const bodyButtons = (text: string) =>
  [...document.body.querySelectorAll("button")].filter((b) => (b.querySelector("[data-kebab-label]") ?? b).textContent?.trim() === text);

// Unmount before the body is cleared: a kebab's menu is teleported there, and Vue trips over a
// teleported node that has already gone.
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  document.body.innerHTML = "";
});

describe("ChatRail", () => {
  it("lists conversations and the channels you are in, in one list, with unread bold and counted", () => {
    const w = render();
    expect(w.text()).toContain("Ben Admin");
    expect(w.text()).toContain("Night dispatch");
    expect(w.text()).toContain("Loads");
    expect(w.find('[aria-label="2 unread"]').exists()).toBe(true);
    expect(w.find('[aria-label="3 unread"]').exists()).toBe(true);
    const night = w.findAll("button").find((b) => b.text().includes("Night dispatch"))!;
    expect(night.find(".font-semibold").text()).toBe("Night dispatch");
  });

  it("opens a conversation or a channel by its id, and marks the open one", async () => {
    const w = render({ selectedId: LOADS });
    await w.findAll("button").find((b) => b.text().includes("Ben Admin"))!.trigger("click");
    expect(w.emitted("open-conversation")).toEqual([[T1]]);
    const loads = w.find('button[aria-label="# Loads"]');
    expect(loads.attributes("aria-current")).toBe("true");
    await loads.trigger("click");
    expect(w.emitted("open-channel")).toEqual([[LOADS]]);
  });

  it("folds the channels to join under a button that says how many, and joins one from there", async () => {
    const w = render();
    expect(w.text()).not.toContain("Yard");
    await buttons(w, "Show 1 more channel")[0]!.trigger("click");
    expect(w.text()).toContain("Yard");
    expect(buttons(w, "Show fewer")).toHaveLength(1);
    await w.find('button[aria-label="Join # Yard"]').trigger("click");
    expect(w.emitted("join")).toEqual([[YARD]]);
  });

  it("keeps a muted conversation at the bottom, folded, with its count but no bold", async () => {
    const w = render({ conversations: [conversation({ muted: "all", unread: 5, last_seq: 9 })] });
    expect(w.text()).not.toContain("Ben Admin");
    expect(w.text()).toContain("Muted");
    await w.findAll("button").find((b) => b.text().startsWith("Muted"))!.trigger("click");
    expect(w.text()).toContain("Ben Admin");
    expect(w.find('[aria-label="5 unread"]').classes()).not.toContain("bg-brand-accent-strong");
  });

  it("puts New conversation, New team for a holder of Chat teams, and New channel in each team in one menu", async () => {
    const w = render();
    await w.find('button[aria-label="New"]').trigger("click");
    await flushPromises();
    expect(bodyButtons("New conversation")).toHaveLength(1);
    expect(bodyButtons("New team")).toHaveLength(0);
    expect(bodyButtons("New channel in Dispatch")).toHaveLength(1);
    bodyButtons("New conversation")[0]!.click();
    expect(w.emitted("new-conversation")).toHaveLength(1);

    w.unmount();
    const w2 = render({ canManage: true });
    await w2.find('button[aria-label="New"]').trigger("click");
    await flushPromises();
    expect(bodyButtons("New team")).toHaveLength(1);
  });

  it("gives a team's acts to its kebab — Add people to its owner only", async () => {
    const w = render();
    await w.find('button[aria-label="Dispatch actions"]').trigger("click");
    await flushPromises();
    expect(bodyButtons("New channel")).toHaveLength(1);
    expect(bodyButtons("Leave team")).toHaveLength(1);
    expect(bodyButtons("Add people")).toHaveLength(0);
    bodyButtons("Leave team")[0]!.click();
    expect(w.emitted("leave-team")?.[0]?.[0]).toMatchObject({ space_id: SPACE });

    w.unmount();
    const w2 = render({ teams: [team({ space_role: "owner" })] });
    await w2.find('button[aria-label="Dispatch actions"]').trigger("click");
    await flushPromises();
    expect(bodyButtons("Add people")).toHaveLength(1);
  });

  it("searches every section by name, shows a channel to join unfolded, and says when nothing matches", async () => {
    const w = render();
    await w.find("input").setValue("yard");
    await tick();
    expect(w.text()).toContain("Yard");
    expect(w.text()).not.toContain("Ben Admin");
    expect(w.text()).not.toContain("Chats");
    await w.find("input").setValue("zzz");
    await tick();
    expect(w.text()).toContain("Nothing in chat is called that.");
  });

  it("tells an empty inbox how to begin, and a person with no team who can add them", () => {
    const w = render({ conversations: [], teams: [] });
    expect(w.text()).toContain("No conversations yet. Start one with New.");
    expect(w.text()).toContain("Somebody in a team can add you.");
    expect(render({ conversations: [], teams: [], canManage: true }).text()).toContain("No teams yet. Make one with New.");
  });

  it("puts the caret in the search on focusSearch() — what / on the page does (D-CHATUI16)", () => {
    const w = render();
    (w.vm as unknown as { focusSearch(): void }).focusSearch();
    expect(document.activeElement).toBe(w.find("input").element);
  });

  it("steps J and K along what it shows — Chats, then each team's channels — from the first when nothing is open, stopping at the ends", async () => {
    const w = render({ selectedId: T2 });
    const vm = w.vm as unknown as { step(delta: 1 | -1): void };
    vm.step(1);
    expect(w.emitted("open-channel")).toEqual([[GENERAL]]);
    vm.step(-1);
    expect(w.emitted("open-conversation")).toEqual([[T1]]);
    await w.setProps({ selectedId: LOADS }); // the last item shown: Yard is not joined
    vm.step(1);
    expect(w.emitted("open-channel")).toEqual([[GENERAL]]);
    await w.setProps({ selectedId: null });
    vm.step(1);
    expect(w.emitted("open-conversation")).toEqual([[T1], [T1]]);
  });
});
