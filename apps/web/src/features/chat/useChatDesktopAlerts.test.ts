import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatConversation } from "@silvicom/shared";

/**
 * CH6d in a tab, with the browser's Notification faked: Turn on asks the browser and remembers the
 * answer; a ringing line is an alert with its words; clicking it opens the line; and nothing rings
 * while the person has not turned alerts on.
 */
const apiFetch = vi.hoisted(() => vi.fn(async (path: string) => ({
  ok: true,
  data: path.includes("/unread") ? { unread: 0 } : path.includes("/people") ? { people: [] } : { items: [], next: null, unread: 0 },
})));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "11111111-1111-4111-8111-111111111111" }) }));

const BEN = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async () => FakeNotification.permission = "granted");
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.shown.push(this); }
}

const conv = (seq: number): ChatConversation => ({
  thread_id: T, kind: "direct", subject: null, load_id: null, created_at: "2026-10-30T09:00:00Z",
  last_message_at: "2026-10-30T09:00:00Z", last_seq: seq, rev: seq, read_seq: seq - 1, unread: 1, muted: "none",
  member_role: "member", member_count: 2, title_members: [{ user_id: BEN, name: "Ben Admin" }],
  last_message: { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, sender_user_id: BEN, sender_name: "Ben Admin", body: `line ${seq}`, created_at: "2026-10-30T09:00:00Z", deleted: false },
});

async function setup() {
  vi.resetModules(); // the module holds the tab's one choice; each test starts from a fresh tab
  const { useChatDesktopAlerts, useChatDesktopAlertsChoice } = await import("./useChatDesktopAlerts");
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/dashboard");
  const inbox = ref<ChatConversation[] | undefined>([conv(3)]);
  let control!: ReturnType<typeof useChatDesktopAlertsChoice>;
  const Host = defineComponent({
    setup() {
      useChatDesktopAlerts(ref(true), inbox);
      control = useChatDesktopAlertsChoice();
      return () => h("div");
    },
  });
  const w = mount(Host, { global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  return { w, router, inbox, control: () => control };
}

/** The repo's jsdom has no `localStorage` (AssistantLauncher.test.ts installs one the same way). */
function installStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

beforeEach(() => {
  installStorage();
  FakeNotification.permission = "default";
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("desktop alerts in a tab", () => {
  it("rings for nothing until the person turns them on", async () => {
    const { w, inbox } = await setup();
    inbox.value = [conv(4)];
    await nextTick();
    expect(FakeNotification.shown).toEqual([]);
    w.unmount();
  });

  it("asks the browser on Turn on, remembers the answer in this browser, and then rings for a new line", async () => {
    const { w, inbox, control } = await setup();
    await control().turnOn();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("fg.chat.desktop-alerts")).toBe("on");
    await flushPromises();
    inbox.value = [conv(4)];
    await nextTick();
    expect(FakeNotification.shown.map((n) => [n.title, n.options.body, n.options.tag])).toEqual([["Ben Admin", "line 4", `chat:${T}`]]);
    // The same line again — a refetch that changed nothing else — does not ring twice.
    inbox.value = [conv(4)];
    await nextTick();
    expect(FakeNotification.shown).toHaveLength(1);
    w.unmount();
  });

  it("opens the line where it lives when the alert is clicked", async () => {
    const { w, inbox, control, router } = await setup();
    await control().turnOn();
    await flushPromises();
    inbox.value = [conv(4)];
    await nextTick();
    FakeNotification.shown[0]!.onclick!();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(`/chat?c=${T}`);
    w.unmount();
  });

  it("stores Off when the browser refuses, and Not now as Off without asking", async () => {
    FakeNotification.requestPermission.mockImplementationOnce(async () => FakeNotification.permission = "denied");
    const { w, control } = await setup();
    await control().turnOn();
    expect(localStorage.getItem("fg.chat.desktop-alerts")).toBe("off");
    expect(control().on.value).toBe(false);
    w.unmount();
    const again = await setup();
    again.control().turnOff();
    expect(localStorage.getItem("fg.chat.desktop-alerts")).toBe("off");
    again.w.unmount();
  });
});
