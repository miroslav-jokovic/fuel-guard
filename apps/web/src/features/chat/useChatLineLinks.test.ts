import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { chatLinkParts, type ChatMessage } from "@silvicom/shared";

/**
 * Load and truck numbers in chat lines, as links (CHAT-REDESIGN-PLAN Q-CHATUI6 (a)). What a person
 * relies on:
 *  · the words the server named are links to that record's page, every occurrence, a mention never;
 *  · the log asks the server once for its live lines, at most 200 a request, never about a removed line
 *    or one with no digit in it, and again only for a line whose words changed;
 *  · a log outside the chat page — the compliance console's — draws no links and asks nothing.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
import ChatBody from "./ChatBody.vue";
import { provideChatLineLinks, useChatLineLinks, useChatLineLinksHere } from "./useChatLineLinks";
import { provideChatNames } from "./chatNames";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LOAD = "66666666-6666-4666-8666-000000000001";
const TRUCK = "77777777-7777-4777-8777-000000000001";
const msg = (n: number, body: string | null, over: Partial<ChatMessage> = {}) =>
  ({ id: id(n), rev: n, body, deleted_at: null, ...over }) as Pick<ChatMessage, "id" | "rev" | "body" | "deleted_at">;

const mounted: VueWrapper[] = [];
afterEach(() => { for (const w of mounted.splice(0)) w.unmount(); apiFetch.mockReset(); });

describe("chatLinkParts", () => {
  it("cuts every occurrence, a reference whole before the number inside it, and leaves the rest as text", () => {
    const parts = chatLinkParts("load 0137581 then 0137581 again, and Truck 506.", [
      { text: "0137581", kind: "load", record_id: LOAD },
      { text: "load 0137581", kind: "load", record_id: LOAD },
      { text: "Truck 506", kind: "vehicle", record_id: TRUCK },
    ]);
    expect(parts).toEqual([
      { link: "load 0137581", kind: "load", record_id: LOAD }, { text: " then " },
      { link: "0137581", kind: "load", record_id: LOAD }, { text: " again, and " },
      { link: "Truck 506", kind: "vehicle", record_id: TRUCK }, { text: "." },
    ]);
  });
  it("links words only where they stand on their own, never the start of a longer number", () => {
    expect(chatLinkParts("unit 50 waits, unit 5 left", [{ text: "unit 5", kind: "vehicle", record_id: TRUCK }])).toEqual([
      { text: "unit 50 waits, " },
      { link: "unit 5", kind: "vehicle", record_id: TRUCK },
      { text: " left" },
    ]);
  });

  it("a line with none of the words is one text part", () => {
    expect(chatLinkParts("nothing here", [{ text: "0137581", kind: "load", record_id: LOAD }])).toEqual([{ text: "nothing here" }]);
  });
});

describe("ChatBody with links", () => {
  it("draws the named words as links to the load's and the truck's pages, and a mention as a mention", () => {
    const ME = "11111111-1111-4111-8111-111111111111";
    const Host = defineComponent({
      setup() {
        provideChatNames(ref([{ user_id: ME, name: "Ana", role: "dispatcher" }]) as never);
        return () => h(ChatBody, { body: `<@${ME}> load 0137581 is on Truck 506`, viewerId: ME, links: [
          { message_id: id(1), text: "load 0137581", kind: "load", record_id: LOAD },
          { message_id: id(1), text: "Truck 506", kind: "vehicle", record_id: TRUCK },
        ] });
      },
    });
    const w = mount(Host, { global: { stubs: { RouterLink: RouterLinkStub } } });
    mounted.push(w);
    const links = w.findAllComponents(RouterLinkStub);
    expect(links.map((l) => [l.text(), l.props("to")])).toEqual([
      ["load 0137581", { name: "load-detail", params: { id: LOAD } }],
      ["Truck 506", { name: "vehicle-detail", params: { id: TRUCK } }],
    ]);
    expect(w.find("[data-chat-mention]").text()).toBe("@Ana");
  });
});

describe("useChatLineLinks", () => {
  /** A log's links: `useChatLineLinks` directly, or `useChatLineLinksHere` under a page that did or did not turn them on. */
  function run(lines: ReturnType<typeof msg>[], how: "direct" | "page-on" | "page-off" = "direct") {
    const list = ref(lines);
    let api: { byLine: { value: Map<string, unknown[]> } } | null = null;
    const Log = defineComponent({ setup() { api = how === "direct" ? useChatLineLinks(list) : useChatLineLinksHere(list); return () => h("div"); } });
    const Page = defineComponent({ setup() { if (how === "page-on") provideChatLineLinks(); return () => h(Log); } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted.push(mount(Page, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } }));
    return { list, api: () => api! };
  }
  const asked = () => apiFetch.mock.calls.map((c) => (c[1] as { body: { message_ids: string[] } }).body.message_ids);

  it("asks once for the live lines with a digit, and hands each line its links", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { links: [{ message_id: id(1), text: "0137581", kind: "load", record_id: LOAD }] }, error: null });
    const { api } = run([msg(1, "approve 0137581"), msg(2, "ok, on it"), msg(3, "truck 506", { deleted_at: "2026-11-02T10:00:00Z" }), msg(4, null)]);
    await flushPromises();
    expect(asked()).toEqual([[id(1)]]);
    expect(api().byLine.value.get(id(1))).toEqual([{ message_id: id(1), text: "0137581", kind: "load", record_id: LOAD }]);
  });

  it("asks in requests of at most 200", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { links: [] }, error: null });
    run(Array.from({ length: 450 }, (_, i) => msg(i + 1, `load ${1000 + i}`)));
    await flushPromises();
    expect(asked().map((ids) => ids.length)).toEqual([200, 200, 50]);
  });

  it("asks again when a line's words change, and not when nothing did", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { links: [] }, error: null });
    const { list } = run([msg(1, "load 0137581")]);
    await flushPromises();
    list.value = [msg(1, "load 0137581")];
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    list.value = [msg(1, "load 0137582", { rev: 9 })];
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("under the chat page a log asks; anywhere else — the compliance console's log — it asks nothing and links nothing", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { links: [{ message_id: id(1), text: "0137581", kind: "load", record_id: LOAD }] }, error: null });
    const on = run([msg(1, "load 0137581")], "page-on");
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(on.api().byLine.value.size).toBe(1);
    apiFetch.mockClear();
    const off = run([msg(1, "load 0137581")], "page-off");
    await flushPromises();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(off.api().byLine.value.size).toBe(0);
  });

});
