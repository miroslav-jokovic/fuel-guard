import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ChatComposer from "./ChatComposer.vue";
import { provideChatMentions, type MentionCandidate } from "./chatNames";

/**
 * The composer's `@` list (CH6b-2, D-CHAT22, Q-CHAT20 (a)). What a writer relies on: typing `@` and a
 * few letters offers the people this conversation may name; picking one writes their name and sends
 * their token; while the list is open its keys are its own, so Enter picks rather than sends; and a
 * person not in the channel yet is added before they are named — or not named at all when that is refused.
 */
const BEN = "bbbbbbbb-2222-4222-8222-22222222beef";
const CARA = "cccccccc-3333-4333-8333-33333333cafe";
const AARON = "eeeeeeee-5555-4555-8555-55555555face";

function render(candidates: MentionCandidate[], add: (id: string) => Promise<boolean> = async () => true) {
  const Host = defineComponent({
    setup() {
      provideChatMentions({ candidates: ref(candidates), addLabel: ref("Add to # Loads"), add });
      return () => h(ChatComposer, { threadKey: "t1" });
    },
  });
  return mount(Host, { attachTo: document.body });
}

/**
 * One input event, as a browser sends one per key: the field's value and caret are set, then the event.
 * (`setValue` plus a second event once hid a stale read — the list read the model before v-model had
 * written it, and a pick in the browser came out "@@Dana Whitfield".)
 */
async function type(w: ReturnType<typeof render>, text: string) {
  const ta = w.find("textarea");
  const el = ta.element as HTMLTextAreaElement;
  el.value = text;
  el.setSelectionRange(text.length, text.length);
  await ta.trigger("input");
  return ta;
}
const options = (w: ReturnType<typeof render>) => w.findAll('[role="option"]').map((o) => o.text());
const sent = (w: ReturnType<typeof render>) => w.findComponent(ChatComposer).emitted("send")?.map((e) => e[0]);

const people: MentionCandidate[] = [
  { user_id: BEN, name: "Ben Admin", member: true },
  { user_id: CARA, name: "Cara Ruiz", member: false },
  { user_id: AARON, name: "Aaron Vance", member: false },
];

describe("ChatComposer's @ list", () => {
  it("offers the people whose name has a word starting with what follows the @, members first", async () => {
    const w = render(people);
    await type(w, "hi @");
    // Aaron sorts before Ben by name; Ben is in the conversation, so Ben comes first.
    expect(options(w)).toEqual(["Ben Admin", "Aaron VanceAdd to # Loads", "Cara RuizAdd to # Loads"]);
    await type(w, "hi @ru");
    expect(options(w)).toEqual(["Cara RuizAdd to # Loads"]);
    await type(w, "hi @zz");
    expect(w.find('[role="listbox"]').exists()).toBe(false);
  });

  it("Enter picks rather than sends; the field reads the name and the line carries the token", async () => {
    const w = render(people);
    const ta = await type(w, "hi @be");
    await ta.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect((ta.element as HTMLTextAreaElement).value).toBe("hi @Ben Admin ");
    expect(sent(w)).toBeUndefined();
    await ta.trigger("keydown", { key: "Enter" });
    expect(sent(w)).toEqual([`hi <@${BEN}>`]);
  });

  it("walks the list with the arrows, and Up is the list's, not the way into the log", async () => {
    const w = render(people);
    const ta = await type(w, "@");
    await ta.trigger("keydown", { key: "ArrowDown" });
    expect(w.find('[aria-selected="true"]').text()).toContain("Aaron Vance");
    await ta.trigger("keydown", { key: "ArrowUp" });
    expect(w.find('[aria-selected="true"]').text()).toContain("Ben Admin");
    expect(w.findComponent(ChatComposer).emitted("up")).toBeUndefined();
  });

  it("adds a person who is not in the channel before naming them", async () => {
    const add = vi.fn(async () => true);
    const w = render(people, add);
    const ta = await type(w, "@ca");
    await ta.trigger("keydown", { key: "Tab" });
    await flushPromises();
    expect(add).toHaveBeenCalledWith(CARA);
    expect((ta.element as HTMLTextAreaElement).value).toBe("@Cara Ruiz ");
  });

  it("names nobody when the add is refused, and leaves what was typed", async () => {
    const w = render(people, async () => false);
    const ta = await type(w, "@ca");
    await ta.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect((ta.element as HTMLTextAreaElement).value).toBe("@ca");
  });

  it("Esc closes the list and nothing around it", async () => {
    const w = render(people);
    const outer = vi.fn();
    w.element.addEventListener("keydown", outer);
    const ta = await type(w, "@be");
    await ta.trigger("keydown", { key: "Escape" });
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    expect(outer).not.toHaveBeenCalled();
  });

  it("sends a plain @ as the character it is when nobody can be named", async () => {
    const w = render([]);
    const ta = await type(w, "@ben ok");
    await ta.trigger("keydown", { key: "Enter" });
    expect(sent(w)).toEqual(["@ben ok"]);
  });
});
