import { ref } from "vue";
import type { Router } from "vue-router";
import type { WebPushStateResponse, WebPushTestResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * This browser's chat notifications — Web Push (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP2, D-WP1, D-WP5).
 *
 * A browser turned on here is one row on the server (one push endpoint = one browser on one device), so
 * "every device I am signed in on" is simply every browser where the person pressed Turn on. The service
 * worker that shows the notifications is `public/sw.js`; the API that sends them is `/api/chat/push`.
 *
 * In `lib`, not in `features/chat`, because the session store needs it: signing out must stop THIS device
 * before the token that can say so is gone (`signOutThisDevice`).
 *
 * WHAT A DEVICE CAN DO (D-WP5, research §2 of the plan):
 *   · Android browsers, desktop browsers: everything, from an ordinary tab.
 *   · iPhone/iPad in a Safari tab: nothing — no `PushManager` until the site is on the Home Screen and opened
 *     from there (iOS 16.4+). `pushSupport()` says `ios-install` so the control can say how.
 *
 * WHOSE IT IS: the choice is stored per browser WITH the person who made it (`STORAGE_KEY`). A subscription
 * found here under somebody else's choice is let go — a shared PC must not keep ringing for the person who
 * used it before (the server moves an endpoint to whoever registers it last, 0599, D-WP1).
 */

const STORAGE_KEY = "fg.chat.push";
const SW_URL = "/sw.js";

export type PushSupport = "available" | "ios-install" | "unsupported";

interface StoredChoice { userId: string; endpoint: string }

function readChoice(): StoredChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    return v && typeof v === "object" && typeof (v as StoredChoice).userId === "string" && typeof (v as StoredChoice).endpoint === "string"
      ? (v as StoredChoice) : null;
  } catch {
    return null; // Safari private mode throws on localStorage
  }
}
function writeChoice(v: StoredChoice | null): void {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* the subscription still holds; the next load re-registers it */ }
}

/** An iPhone or iPad — including an iPad that reports itself as a Mac. */
export function isIosDevice(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** Opened from the Home Screen (iOS) or installed (Android, desktop). */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  if (capable) return "available";
  return isIosDevice() && !isStandalone() ? "ios-install" : "unsupported";
}

/** "Chrome on Android" — so a person can tell their devices apart. Never used to decide anything. */
export function deviceLabel(ua: string): string {
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPod/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "this device";
  return `${browser} on ${os}`;
}

/** The server's base64url public key as the bytes `pushManager.subscribe` takes. */
export function applicationServerKey(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

// ── State, one per tab: the control and the shell read the same refs ───────────────────────────────
export const pushServer = ref<WebPushStateResponse | null>(null);
/** This browser is registered for the signed-in person. */
export const pushOnHere = ref(false);
/** Who `loadPushState` last ran for — the person a press of Turn on registers this browser to. */
let signedInUser: string | null = null;
export const pushPermission = ref<NotificationPermission | "unsupported">(
  typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
);

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

async function loadServer(): Promise<WebPushStateResponse | null> {
  const res = await apiFetch<WebPushStateResponse>("/api/chat/push");
  pushServer.value = res.ok && res.data ? res.data : null;
  return pushServer.value;
}

async function register(sub: PushSubscription, userId: string): Promise<boolean> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
  const res = await apiFetch("/api/chat/push/subscription", {
    method: "PUT",
    body: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      origin: window.location.origin,
      device_label: deviceLabel(navigator.userAgent),
    },
  });
  if (!res.ok) return false;
  writeChoice({ userId, endpoint: json.endpoint });
  return true;
}

async function subscribe(reg: ServiceWorkerRegistration, key: Uint8Array): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's pair was rotated) cannot receive: start again.
  if (existing && sameKey(existing.options.applicationServerKey, key)) return existing;
  if (existing) await existing.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

/**
 * Turn on, from a press. The permission prompt comes FIRST: Safari shows it only while the press is still
 * being handled, and an `await` on the network before it would lose that. `loadPushState` has already
 * fetched the server's key when the control was drawn.
 */
export async function turnOnPush(): Promise<"on" | "denied" | "failed"> {
  const userId = signedInUser;
  if (pushSupport() !== "available" || !userId) return "failed";
  const permission = await Notification.requestPermission();
  pushPermission.value = permission;
  if (permission !== "granted") return "denied";
  const server = pushServer.value ?? (await loadServer());
  if (!server?.available || !server.public_key) return "failed";
  try {
    const sub = await subscribe(await registration(), applicationServerKey(server.public_key));
    pushOnHere.value = await register(sub, userId);
    return pushOnHere.value ? "on" : "failed";
  } catch {
    return "failed";
  }
}

async function letGo(reason: "turned_off" | "signed_out"): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiFetch("/api/chat/push/subscription", { method: "DELETE", body: { endpoint: sub.endpoint, reason } });
    await sub.unsubscribe();
  }
  writeChoice(null);
  pushOnHere.value = false;
}

export async function turnOffPush(): Promise<void> {
  if (pushSupport() !== "available") return;
  await letGo("turned_off").catch(() => { pushOnHere.value = false; });
}

export async function sendTestPush(): Promise<WebPushTestResponse | null> {
  const res = await apiFetch<WebPushTestResponse>("/api/chat/push/test", { method: "POST" });
  return res.ok && res.data ? res.data : null;
}

/**
 * Every signed-in page load where chat is open to the person: learn what the server can do, and re-register a
 * live subscription — its endpoint may have rotated (`sw.js` re-subscribes on `pushsubscriptionchange`) and the
 * server's `last_seen_at` says the device is still in use. Never asks for permission.
 */
export async function loadPushState(userId: string): Promise<void> {
  if (pushSupport() !== "available") return;
  signedInUser = userId;
  pushPermission.value = Notification.permission;
  const server = await loadServer();
  const choice = readChoice();
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!choice || choice.userId !== userId) {
    // Somebody else's subscription, or none chosen here: this person has not turned it on in this browser.
    if (sub && choice && choice.userId !== userId) await sub.unsubscribe().catch(() => {});
    if (choice && choice.userId !== userId) writeChoice(null);
    pushOnHere.value = false;
    return;
  }
  if (Notification.permission !== "granted" || !server?.available || !server.public_key) {
    pushOnHere.value = false;
    return;
  }
  try {
    const live = await subscribe(reg ?? (await registration()), applicationServerKey(server.public_key));
    pushOnHere.value = await register(live, userId);
  } catch {
    pushOnHere.value = false;
  }
}

/** Sign-out: this device stops, while the token can still say so. Bounded — a sign-out never waits on it long. */
export async function signOutThisDevice(): Promise<void> {
  if (pushSupport() !== "available" || !readChoice()) return;
  await Promise.race([
    letGo("signed_out").catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  writeChoice(null);
  pushOnHere.value = false;
  signedInUser = null;
}

/** A tapped notification in an open app: go there with the router, keeping what is on screen (`sw.js`). */
export function listenForNotificationTaps(router: Router): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const d = event.data as { type?: unknown; url?: unknown } | null;
    if (!d || d.type !== "silvicom:navigate" || typeof d.url !== "string") return;
    try {
      const u = new URL(d.url);
      if (u.origin !== window.location.origin) return;
      void router.push(u.pathname + u.search + u.hash);
    } catch { /* not a URL: nothing to open */ }
  });
}
