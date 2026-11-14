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
  const cached = new Map<string, string>();
  const cacheNames = ["silvicom-offline-v0", "silvicom-offline-v1", "somebody-elses"];
  const net = { down: false };
  const setAppBadge = vi.fn(async (_n: number) => {});
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
    navigator: { setAppBadge },
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
    // The one cache (INSTALLED-APP-PLAN D-IA2) and the network, both the test's to control.
    caches: {
      open: vi.fn(async (name: string) => ({ addAll: vi.fn(async (reqs: Array<{ url: string }>) => { if (net.down) throw new Error("offline"); for (const r of reqs) cached.set(r.url, `${name}:${r.url}`); }) })),
      match: vi.fn(async (req: string | { url: string }) => cached.get(typeof req === "string" ? req : new URL(req.url).pathname)),
      keys: vi.fn(async () => cacheNames),
      delete: vi.fn(async (n: string) => { cacheNames.splice(cacheNames.indexOf(n), 1); return true; }),
    },
    Request: class { url: string; constructor(url: string) { this.url = url; } },
    fetch: vi.fn(async (req: { url: string }) => { if (net.down) throw new TypeError("Failed to fetch"); return `network:${req.url}`; }),
  };
  runInNewContext(SW, { self, URL, Date, console, Promise, Response: { error: () => "network-error" } });
  async function fire(type: string, event: Record<string, unknown>) {
    let waited: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => { waited = p; } });
    await waited;
  }
  /** A `fetch` event: what the worker answered with, or `undefined` when it left the request to the browser. */
  async function fetchOf(request: { url: string; mode: string; method?: string }) {
    let answer: Promise<unknown> | undefined;
    listeners.fetch!({ request: { method: "GET", ...request }, respondWith: (p: Promise<unknown>) => { answer = p; } });
    return answer === undefined ? undefined : await answer;
  }
  return { fire, fetchOf, shown, opened, self, net, cacheNames, setAppBadge };
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

describe("no connection (INSTALLED-APP-PLAN D-IA2)", () => {
  const PAGE = { url: `${ORIGIN}/drivers`, mode: "navigate" };

  it("a page load with a network is the network's answer, untouched", async () => {
    const w = worker();
    await w.fire("install", {});
    expect(await w.fetchOf(PAGE)).toBe(`network:${PAGE.url}`);
  });

  it("a page load with no network shows the no-connection page cached at install", async () => {
    const w = worker();
    await w.fire("install", {});
    w.net.down = true;
    expect(await w.fetchOf(PAGE)).toBe("silvicom-offline-v1:/offline.html");
  });

  it("never answers an API call or an asset — offline they fail as they always did", async () => {
    const w = worker();
    await w.fire("install", {});
    w.net.down = true;
    expect(await w.fetchOf({ url: `${ORIGIN}/api/chat`, mode: "cors" })).toBeUndefined();
    expect(await w.fetchOf({ url: `${ORIGIN}/assets/index-abc.js`, mode: "no-cors" })).toBeUndefined();
    expect(await w.fetchOf({ url: `${ORIGIN}/api/chat/lines`, mode: "cors", method: "POST" })).toBeUndefined();
  });

  it("installs even when the no-connection page cannot be fetched, and then fails as the browser would", async () => {
    const w = worker();
    w.net.down = true;
    await w.fire("install", {});
    expect(w.self.skipWaiting).toHaveBeenCalled();
    expect(await w.fetchOf(PAGE)).toBe("network-error");
  });

  it("on activation drops its own older caches and nobody else's", async () => {
    const w = worker();
    await w.fire("activate", {});
    expect(w.cacheNames).toEqual(["silvicom-offline-v1", "somebody-elses"]);
  });
});

describe("the icon's number in a push (INSTALLED-APP-PLAN IA-U1b)", () => {
  const push = (unread: number | null) => pushOf(chatPushMessage({
    origin: ORIGIN, title: "Ana", body: "hi", path: `/chat?c=${T}`, threadId: T, messageId: "m1", at: new Date("2026-11-14T15:00:00Z"), unread,
  }));

  it("sets the icon to the count the server sent, and still shows the notification", async () => {
    const w = worker();
    await w.fire("push", push(4));
    expect(w.setAppBadge).toHaveBeenCalledWith(4);
    expect(w.shown).toHaveLength(1);
  });

  it("leaves the icon alone when the push carries no count, zero, or something that is not a count", async () => {
    const w = worker();
    await w.fire("push", push(null));
    await w.fire("push", push(0));
    const odd = chatPushMessage({ origin: ORIGIN, title: "Ana", body: "hi", path: "/chat", threadId: T, messageId: "m1", at: new Date() });
    await w.fire("push", pushOf({ ...odd, notification: { ...odd.notification, app_badge: "-3" } }));
    await w.fire("push", pushOf({ ...odd, notification: { ...odd.notification, app_badge: 7 } }));
    await w.fire("push", pushOf({ ...odd, notification: { ...odd.notification, app_badge: "2.5" } }));
    expect(w.setAppBadge).not.toHaveBeenCalled();
    expect(w.shown).toHaveLength(5);
  });
});
