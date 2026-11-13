import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * This browser's chat notifications (CHAT-WEB-PUSH-PLAN WP2, D-WP1, D-WP5), against fake browser parts:
 * what each kind of device is offered; Turn on asks the browser FIRST (Safari forgets the press across a
 * network wait), then registers this browser for the signed-in person; a subscription made with an old key is
 * replaced; one left by another person is let go and never re-registered under the new one; signing out stops
 * this device; and a tapped notification moves the open app by its router, only within this site.
 */
const calls: Array<{ path: string; method: string; body?: unknown }> = [];
/** What the server answers this browser's PUT: its row id, or — set per test — a refusal. */
let putAnswer: { ok: boolean; status: number; data?: unknown; error?: { code: string; message: string } };
const order: string[] = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init: { method?: string; body?: unknown } = {}) => {
    order.push(`api ${init.method ?? "GET"} ${path}`);
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/api/chat/push") return { ok: true, status: 200, data: { available: true, public_key: KEY } };
    if (path === "/api/chat/push/test") return { ok: true, status: 200, data: { devices: 1, sent: 1 } };
    if (path === "/api/chat/push/subscription" && init.method === "PUT") return putAnswer;
    return { ok: true, status: 200, data: {} };
  }),
}));

const KEY = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-browser";
const ROW = "99999999-9999-4999-8999-999999999999";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function fakeSub(key: Uint8Array) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "B" + "a".repeat(86), auth: "c".repeat(22) } }),
    unsubscribe: vi.fn(async () => true),
  };
}
type Sub = ReturnType<typeof fakeSub>;

let current: Sub | null;
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let swListeners: Array<(e: MessageEvent) => void>;
let shown: Array<{ tag: string; close: ReturnType<typeof vi.fn> }>;

function device(ua: string, opts: { push?: boolean; standalone?: boolean; permission?: NotificationPermission } = {}) {
  const push = opts.push ?? true;
  current = null;
  pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (o: { applicationServerKey: Uint8Array }) => (current = fakeSub(o.applicationServerKey))),
  };
  shown = [];
  const reg = {
    pushManager,
    getNotifications: vi.fn(async (o: { tag?: string } = {}) => shown.filter((n) => !o.tag || n.tag === o.tag)),
  };
  swListeners = [];
  vi.stubGlobal("navigator", {
    userAgent: ua,
    maxTouchPoints: 5,
    standalone: opts.standalone ?? false,
    ...(push ? {
      serviceWorker: {
        register: vi.fn(async () => { order.push("register"); return reg; }),
        ready: Promise.resolve(reg),
        getRegistration: vi.fn(async () => reg),
        addEventListener: (_: string, fn: (e: MessageEvent) => void) => swListeners.push(fn),
      },
    } : {}),
  });
  if (push) {
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", {
      permission: opts.permission ?? "default",
      requestPermission: vi.fn(async () => { order.push("permission"); return opts.permission === "denied" ? "denied" : "granted"; }),
    });
  } else {
    vi.stubGlobal("PushManager", undefined);
    // @ts-expect-error — a browser without notifications has no such global
    delete globalThis.Notification;
    // @ts-expect-error — and no PushManager
    delete globalThis.PushManager;
  }
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  window.matchMedia = vi.fn(() => ({ matches: opts.standalone ?? false })) as unknown as typeof window.matchMedia;
}

async function lib() {
  vi.resetModules();
  return import("./webPush");
}

// The repo's jsdom has no `localStorage` (useColorScheme.test.ts says why), so this suite installs one.
function installStorage() {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

beforeEach(() => {
  calls.length = 0;
  order.length = 0;
  putAnswer = { ok: true, status: 200, data: { id: ROW } };
  installStorage();
});
afterEach(() => vi.unstubAllGlobals());

describe("what a device is offered", () => {
  it("an Android browser can take push from an ordinary tab", async () => {
    device(ANDROID);
    expect((await lib()).pushSupport()).toBe("available");
  });

  it("an iPhone in a Safari tab is told to add the site to the Home Screen; one already there that still cannot is just unsupported", async () => {
    device(IPHONE, { push: false });
    expect((await lib()).pushSupport()).toBe("ios-install");
    device(IPHONE, { push: false, standalone: true });
    expect((await lib()).pushSupport()).toBe("unsupported");
  });

  it("names a device the way a person would tell theirs apart", async () => {
    const { deviceLabel } = await lib();
    expect(deviceLabel(ANDROID)).toBe("Chrome on Android");
    expect(deviceLabel(IPHONE)).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge on Windows");
  });

  it("turns the server's key into the bytes the browser subscribes with", async () => {
    const { applicationServerKey } = await lib();
    const bytes = applicationServerKey(KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4); // an uncompressed P-256 point
  });
});

describe("turning on", () => {
  it("asks the browser before anything waits on the network, then registers this browser for the signed-in person", async () => {
    device(ANDROID);
    const w = await lib();
    await w.loadPushState(ANA);
    order.length = 0;
    expect(await w.turnOnPush()).toBe("on");
    expect(order[0]).toBe("permission");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/chat/push/subscription");
    expect(put.body).toMatchObject({ endpoint: ENDPOINT, origin: window.location.origin, device_label: "Chrome on Android" });
    expect(w.pushOnHere.value).toBe(true);
    expect(JSON.parse(localStorage.getItem("fg.chat.push")!)).toEqual({ userId: ANA, endpoint: ENDPOINT, id: ROW });
    expect(put.body).not.toHaveProperty("refresh");
  });

  it("a refusal registers nothing", async () => {
    device(ANDROID, { permission: "denied" });
    const w = await lib();
    await w.loadPushState(ANA);
    expect(await w.turnOnPush()).toBe("denied");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("replaces a subscription made with a key the server no longer has", async () => {
    device(ANDROID);
    const w = await lib();
    const stale = fakeSub(new Uint8Array([4, 9, 9]));
    current = stale;
    await w.loadPushState(ANA);
    await w.turnOnPush();
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });
});

describe("on every page load", () => {
  it("re-registers the person's own live subscription, without asking anything", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    current = fakeSub(w.applicationServerKey(KEY));
    localStorage.setItem("fg.chat.push", JSON.stringify({ userId: ANA, endpoint: ENDPOINT }));
    await w.loadPushState(ANA);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ refresh: true });
    expect(w.pushOnHere.value).toBe(true);
    expect((Notification.requestPermission as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("lets go of a subscription another person turned on in this browser, and never registers it to the new one", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    const theirs = fakeSub(w.applicationServerKey(KEY));
    current = theirs;
    localStorage.setItem("fg.chat.push", JSON.stringify({ userId: BEN, endpoint: ENDPOINT }));
    await w.loadPushState(ANA);
    expect(theirs.unsubscribe).toHaveBeenCalled();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(localStorage.getItem("fg.chat.push")).toBeNull();
    expect(w.pushOnHere.value).toBe(false);
  });
});

describe("a device removed from another device's list (D-WP10)", () => {
  it("lets go here on the next page load, instead of coming back", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    const sub = fakeSub(w.applicationServerKey(KEY));
    current = sub;
    localStorage.setItem("fg.chat.push", JSON.stringify({ userId: ANA, endpoint: ENDPOINT, id: ROW }));
    putAnswer = { ok: false, status: 409, error: { code: "device_removed", message: "removed" } };
    await w.loadPushState(ANA);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem("fg.chat.push")).toBeNull();
    expect(w.pushOnHere.value).toBe(false);
  });

  it("removing THIS device from the list is turning it off here; another device is removed by its id", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    current = fakeSub(w.applicationServerKey(KEY));
    localStorage.setItem("fg.chat.push", JSON.stringify({ userId: ANA, endpoint: ENDPOINT, id: ROW }));
    await w.loadPushState(ANA);
    expect(w.thisDeviceId()).toBe(ROW);
    calls.length = 0;
    expect(await w.removePushDevice("d0000000-0000-4000-8000-000000000002")).toBe(true);
    expect(calls).toEqual([{ path: "/api/chat/push/devices/d0000000-0000-4000-8000-000000000002", method: "DELETE", body: undefined }]);
    calls.length = 0;
    expect(await w.removePushDevice(ROW)).toBe(true);
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ path: "/api/chat/push/subscription", body: { reason: "turned_off" } });
    expect(w.pushOnHere.value).toBe(false);
  });
});

describe("a conversation read on this device (D-WP11)", () => {
  it("closes this device's notifications for that conversation, and no other's", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    const mine = { tag: "chat:t1", close: vi.fn() };
    const other = { tag: "chat:t2", close: vi.fn() };
    shown.push(mine, other);
    await w.clearChatNotifications("t1");
    expect(mine.close).toHaveBeenCalled();
    expect(other.close).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without a service worker", async () => {
    device(IPHONE, { push: false });
    const w = await lib();
    await expect(w.clearChatNotifications("t1")).resolves.toBeUndefined();
  });
});

describe("signing out and turning off", () => {
  it("signing out stops this device on the server, then in the browser", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    const sub = fakeSub(w.applicationServerKey(KEY));
    current = sub;
    localStorage.setItem("fg.chat.push", JSON.stringify({ userId: ANA, endpoint: ENDPOINT }));
    await w.signOutThisDevice();
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ path: "/api/chat/push/subscription", body: { endpoint: ENDPOINT, reason: "signed_out" } });
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem("fg.chat.push")).toBeNull();
  });

  it("turning off says so with its own reason", async () => {
    device(ANDROID, { permission: "granted" });
    const w = await lib();
    current = fakeSub(w.applicationServerKey(KEY));
    await w.turnOffPush();
    expect(calls.find((c) => c.method === "DELETE")?.body).toMatchObject({ reason: "turned_off" });
    expect(w.pushOnHere.value).toBe(false);
  });

  it("a browser that never turned it on signs out without a request", async () => {
    device(ANDROID);
    const w = await lib();
    await w.signOutThisDevice();
    expect(calls).toHaveLength(0);
  });
});

describe("a tapped notification in an open app", () => {
  it("goes there through the router, and only within this site", async () => {
    device(ANDROID);
    const w = await lib();
    const router = { push: vi.fn(async () => {}) };
    w.listenForNotificationTaps(router as never);
    const send = (data: unknown) => swListeners.forEach((fn) => fn({ data } as MessageEvent));
    send({ type: "silvicom:navigate", url: `${window.location.origin}/chat?c=abc` });
    send({ type: "silvicom:navigate", url: "https://phish.example/chat" });
    send({ type: "something-else", url: `${window.location.origin}/x` });
    expect(router.push.mock.calls).toEqual([["/chat?c=abc"]]);
  });
});
