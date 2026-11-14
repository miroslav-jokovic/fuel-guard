/*
 * Silvicom 360 — the service worker (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP2, D-WP4).
 *
 * It shows a chat push and opens it when tapped, and it answers a page load that has no network with the
 * "no connection" page (see THE ONE CACHE below). It holds no copy of the app — that is served fresh every
 * time (index.html is no-cache, assets are hashed), and a cached app would be a second copy that could go stale. Plain JavaScript, served as it is from /sw.js so its scope is the whole
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

/*
 * THE ONE CACHE (INSTALLED-APP-PLAN.md D-IA2): the "no connection" page and its picture, nothing of the app.
 * A page navigation that gets no answer from the network shows it instead of the browser's own error — which,
 * in an installed window with no address bar, is a dead end. Everything else — every API call, every asset,
 * every navigation that does get an answer, an error answer included — goes to the network untouched.
 */
const OFFLINE_CACHE = "silvicom-offline-v1";
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_FILES = [OFFLINE_PAGE, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  // A new worker takes over at once: it holds no copy of the app that a running page could disagree with.
  self.skipWaiting();
  // Fetched fresh at every install. A failure here must not stop the worker installing — notifications
  // matter more than the offline page — so it is swallowed and the browser's own error page stays.
  event.waitUntil((async () => {
    try {
      const cache = await self.caches.open(OFFLINE_CACHE);
      await cache.addAll(OFFLINE_FILES.map((url) => new self.Request(url, { cache: "reload" })));
    } catch { /* no offline page this time */ }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await self.caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("silvicom-offline-") && n !== OFFLINE_CACHE).map((n) => self.caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Not ours: leaving without `respondWith` lets the browser fetch exactly as if this handler did not exist.
  if (request.mode !== "navigate") {
    // The offline page's own picture, when there is no network to get it from.
    if (request.method === "GET" && OFFLINE_FILES.includes(new URL(request.url).pathname) && new URL(request.url).pathname !== OFFLINE_PAGE) {
      event.respondWith(self.fetch(request).catch(async () => (await self.caches.match(request, { ignoreSearch: true })) || Response.error()));
    }
    return;
  }
  event.respondWith(self.fetch(request).catch(async () => {
    const page = await self.caches.match(OFFLINE_PAGE);
    // No cached page (its install fetch failed): the failure the browser would have shown anyway.
    return page || Response.error();
  }));
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
