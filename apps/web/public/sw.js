/*
 * Silvicom 360 — the service worker (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP2, D-WP4).
 *
 * It does ONE thing: show a chat push and open it when tapped. No fetch handler and no cache — the app is
 * served fresh every time (index.html is no-cache, assets are hashed), and an offline cache would be a second
 * copy of the app that could go stale. Plain JavaScript, served as it is from /sw.js so its scope is the whole
 * site; `src/lib/webPush.ts` registers it, and `serviceWorker.test.ts` runs this file against a fake worker.
 *
 * THE MESSAGE is Declarative Web Push (`chatPushMessage` in @silvicom/shared): `{ web_push: 8030, notification }`.
 * Safari 18.4+ shows it without running this file at all. Chrome, Edge and Firefox fire `push` here, and this
 * shows the same fields. EVERY push must show a notification — Safari revokes the permission of a site whose
 * pushes show nothing, and Chrome shows its own "updated in the background" — so a message this cannot read
 * still shows a plain one.
 */

const FALLBACK_TITLE = "Silvicom 360";
const FALLBACK_BODY = "You have a new message.";

self.addEventListener("install", () => {
  // A new worker takes over at once: it holds no cache that a running page could disagree with.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readMessage(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

/** Only this site's own pages: a message naming anywhere else opens the chat instead. */
function sameSite(url) {
  try {
    const u = new URL(url, self.registration.scope);
    return u.origin === self.location.origin ? u.href : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const m = readMessage(event);
  const n = m && m.web_push === 8030 && m.notification && typeof m.notification === "object" ? m.notification : {};
  const tag = typeof n.tag === "string" && n.tag ? n.tag : undefined;
  const options = {
    body: typeof n.body === "string" ? n.body : FALLBACK_BODY,
    icon: typeof n.icon === "string" ? n.icon : "/icons/icon-192.png",
    badge: typeof n.badge === "string" ? n.badge : "/icons/badge-96.png",
    lang: typeof n.lang === "string" ? n.lang : "en-US",
    dir: n.dir === "ltr" || n.dir === "rtl" ? n.dir : "auto",
    tag,
    // One notification per conversation that buzzes again for each line; `renotify` without a tag throws.
    renotify: tag !== undefined && n.renotify !== false,
    silent: n.silent === true,
    timestamp: typeof n.timestamp === "number" ? n.timestamp : Date.now(),
    data: { navigate: sameSite(n.navigate) || sameSite("/chat"), ...(n.data && typeof n.data === "object" ? n.data : {}) },
  };
  const title = typeof n.title === "string" && n.title ? n.title : FALLBACK_TITLE;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = sameSite(event.notification.data && event.notification.data.navigate) || sameSite("/chat");
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((c) => {
      try { return new URL(c.url).origin === self.location.origin; } catch { return false; }
    });
    if (open) {
      // The app is already open: bring it forward and let its router go there, keeping what is on screen
      // (an unsent draft) instead of reloading the page. `webPush.ts` listens for this message.
      await open.focus();
      open.postMessage({ type: "silvicom:navigate", url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The browser replaced the subscription. The worker holds no sign-in, so it cannot tell the server; it
  // subscribes again with the same key, and the next page load registers the new endpoint (`webPush.ts`).
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    if (!old || !old.options || !old.options.applicationServerKey) return;
    await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey });
  })());
});
