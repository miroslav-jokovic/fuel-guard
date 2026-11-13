import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { chatPushMessage } from "@silvicom/shared";

/**
 * `public/sw.js` — the service worker (CHAT-WEB-PUSH-PLAN WP2, D-WP4), run as it ships against a fake worker
 * global. What a person relies on: a chat push shows the title, text and tag the server wrote; ANY push shows
 * something (a silent push gets Safari to revoke the permission); a tap opens the conversation — in the open app
 * through its router, or in a new window — and never a page on another site.
 */
// From the package root, as vectorBasemap.test.ts reads `public/` (jsdom gives `import.meta.url` no file scheme).
const SW = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://360.silvicominc.com";
const T = "33333333-3333-4333-8333-333333333333";

type Listener = (event: Record<string, unknown>) => void;

function worker(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }> = []) {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    registration: {
      scope: `${ORIGIN}/`,
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); }),
      pushManager: { subscribe: vi.fn(async () => ({})) },
    },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => { opened.push(url); }),
    },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
  };
  runInNewContext(SW, { self, URL, Date, console });
  async function fire(type: string, event: Record<string, unknown>) {
    let waited: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => { waited = p; } });
    await waited;
  }
  return { fire, shown, opened, self };
}

const pushOf = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

describe("a push", () => {
  it("shows the chat line as the server wrote it: title, text, one notification per conversation that buzzes again", async () => {
    const w = worker();
    const m = chatPushMessage({
      origin: ORIGIN, title: "Ana Petrović in # Loads", body: "can you take 4417?", path: `/chat?ch=${T}`,
      threadId: T, messageId: "m1", at: new Date("2026-11-13T15:00:00Z"),
    });
    await w.fire("push", pushOf(m));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe("Ana Petrović in # Loads");
    expect(w.shown[0]!.options).toMatchObject({
      body: "can you take 4417?", tag: `chat:${T}`, renotify: true, silent: false,
      icon: `${ORIGIN}/icons/icon-192.png`, data: { navigate: `${ORIGIN}/chat?ch=${T}`, thread_id: T },
    });
  });

  it("still shows something for a message it cannot read — a push that shows nothing loses the permission", async () => {
    const w = worker();
    await w.fire("push", { data: { json: () => { throw new SyntaxError("not json"); } } });
    await w.fire("push", { data: null });
    await w.fire("push", pushOf({ hello: "world" }));
    expect(w.shown.map((s) => s.title)).toEqual(["Silvicom 360", "Silvicom 360", "Silvicom 360"]);
    // No tag means no renotify: Chrome throws on renotify without a tag, and the notification would be lost.
    expect(w.shown.every((s) => s.options.renotify === false)).toBe(true);
  });

  it("never carries a link to another site, whatever the message says", async () => {
    const w = worker();
    await w.fire("push", pushOf({ web_push: 8030, notification: { title: "x", navigate: "https://phish.example/login" } }));
    expect(w.shown[0]!.options.data).toMatchObject({ navigate: `${ORIGIN}/chat` });
  });
});

describe("a tap", () => {
  const tap = (navigate: unknown) => ({ notification: { close: vi.fn(), data: { navigate } } });

  it("brings the open app forward and hands its router the conversation, keeping what is on screen", async () => {
    const win = { url: `${ORIGIN}/dispatch`, focus: vi.fn(async () => {}), postMessage: vi.fn() };
    const w = worker([win]);
    await w.fire("notificationclick", tap(`${ORIGIN}/chat?c=${T}`));
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({ type: "silvicom:navigate", url: `${ORIGIN}/chat?c=${T}` });
    expect(w.opened).toEqual([]);
  });

  it("opens a window at the conversation when the app is not open", async () => {
    const w = worker([{ url: "https://other.example/", focus: vi.fn(), postMessage: vi.fn() }]);
    await w.fire("notificationclick", tap(`${ORIGIN}/chat?c=${T}`));
    expect(w.opened).toEqual([`${ORIGIN}/chat?c=${T}`]);
  });

  it("opens the chat, not another site, when the stored link points away", async () => {
    const w = worker();
    await w.fire("notificationclick", tap("https://phish.example/"));
    expect(w.opened).toEqual([`${ORIGIN}/chat`]);
  });
});

describe("a replaced subscription", () => {
  it("subscribes again with the same key, so the next page load can register it", async () => {
    const w = worker();
    const key = new Uint8Array([4, 1, 2]).buffer;
    await w.fire("pushsubscriptionchange", { oldSubscription: { options: { applicationServerKey: key } } });
    expect(w.self.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
  });
});
