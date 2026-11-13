# Office chat on the phone — Web Push for a browser login (CH10, 2026-11-13)

OFFICE-CHAT-PLAN.md listed CH10 "Web Push" behind Q-CHAT4 (ruled 2026-10-23: (a) in-tab alerts first, (b)
Web Push as CH10). The owner asked on 2026-11-13: *"when users receive a message in chat, notify them on the
device where they are logged in, or every device they are logged in on — on the native phone; the only issue
is that users are logged in in the browser and not in a dedicated application."* This is that item's plan.

## 1. What exists today (measured 2026-11-13, main at 9ae8c3e)

| Fact | Where |
|---|---|
| Desktop alerts while a tab is open (CH6d): a browser `Notification` from the page, decided by `chatDesktopAlerts.ts` (Q-CHAT18 (a)), per browser in `localStorage`. **Nothing reaches a closed tab, and nothing reaches an iPhone at all** — Safari in a tab has no `Notification`, so the control renders nothing there | `apps/web/src/features/chat/useChatDesktopAlerts.ts`, `ChatDesktopAlertsControl.vue` |
| The web app has **no service worker and no manifest** | `apps/web/public/`, `index.html` |
| Phone push exists for the DRIVER app only: Expo tokens in `device_push_tokens`, delivered once a minute from `notification_events` | `notify.ts` `deliverPending`, `notificationPush.ts` |
| A chat line rings the bell only for a mention or a reply (D-CHAT7, D-CHAT23); who is told is SQL (`chat_notify_targets`, 0521) | `chatNotify.ts` |
| Hosting is AWS (Railway production retired 2026-10-28, AWS-MIGRATION-PLAN): one EC2 server per environment, Docker Compose + Caddy. Production: the app at `360.silvicominc.com`, where Caddy sends `/api/*` to the `api` replicas (D-AWS17, same origin). Staging: `staging-api.360.silvicominc.com` serves app and API (`staging.360` has no DNS record). Settings: Parameter Store `/silvicom/<env>/<service>/`, read at deploy | `infra/server/Caddyfile`, `fetch-settings.sh`, `staging.env`, `production.env` |
| A deploy drains: SIGTERM waits up to 35 s for tracked work — compose passes `DRAIN_SECONDS=45` as `stop_grace_period` and as the variable `lib/shutdown.ts` reads (its Railway-era name) | `infra/server/compose.yml`, `lib/shutdown.ts` |
| Production use: 14 office memberships (7 admin, 3 dispatcher, 4 others), 5 direct conversations, 8 lines ever, 2 in the last 7 days | `supabase db query --linked`, 2026-11-13 |

**A defect this work depends on.** `ChatPage.vue` and `ChatChannelStage.vue` mark a conversation read whenever
its data loads — including when a realtime signal refetches it in a HIDDEN tab. So a PC left on /chat reads
every line as it arrives, the sender sees "Seen" for a line nobody saw, and any "is it still unread?" test
(this plan's §3.3) would wrongly hold back the phone. Fixed here: read only while the page is visible, and
on becoming visible (D-WP6).

## 2. What browsers allow (research 2026-11-13; sources in §7)

| Device | From an ordinary browser tab? | Condition |
|---|---|---|
| Android — Chrome, Samsung Internet, Firefox, Edge | **Yes**, into the system tray, browser closed or not | Permission granted after a tap |
| iPhone / iPad — iOS 16.4+ | **No.** In a Safari tab `Notification` and `PushManager` do not exist | The site is added to the Home Screen and opened from that icon. iOS 26 opens every Home Screen site as a web app by default ("zero requirements for installability") |
| Desktop — Chrome, Edge, Firefox, Safari | Yes | Arrives while the browser application runs |

Rules every design must meet:
1. **Every push must show a notification.** Safari revokes the permission after pushes that show nothing; Chrome
   requires `userVisibleOnly: true`. So the SERVER decides whether to push — a phone cannot quietly drop one.
2. **Permission only from a tap**, and a denial is near-permanent.
3. **Chrome auto-revokes** notification permission for sites with high volume and low engagement (since Oct 2025);
   installed web apps are exempt.
4. **Declarative Web Push** (iOS/iPadOS 18.4, macOS 15.5): a JSON payload `{"web_push": 8030, "notification":
   {title, navigate, …}}` that Safari shows with no script. Chrome/Firefox ignore the format and fire the service
   worker's `push` event, which shows the same fields. One payload serves both.
5. Payloads are end-to-end encrypted (RFC 8291) to the browser's key: Apple's, Google's and Mozilla's relays carry
   ciphertext. Max ~4 KB.
6. The iPhone Home Screen app has its own storage, so the person signs in once more inside it.

## 3. Design

### 3.1 One subscription per browser per device (D-WP1)

`web_push_subscriptions`: one row per push endpoint (a browser profile on a device), holding the person, the
organisation it was turned on in, the two public keys, the page origin it was made from, a device label (user
agent), `last_seen_at` / `last_success_at` / `last_failure`, and `revoked_at` + reason. "Every device I'm logged
in on" = every live row of that person in that organisation. **The endpoint is unique**: if a second person turns
it on in the same browser, the row moves to them (`web_push_subscribe`), so a shared PC never carries two people's
messages.

A row stops receiving when: the person turns it off (that device only), signs out on that device (that device
only), is removed or suspended in the organisation (delivery joins `memberships`; offboarding also revokes through
`revoke_push_tokens`, extended), or the push service answers 404/410 (the browser dropped it).

### 3.2 What rings — the desktop alerts' rule, in SQL (D-WP2)

`chat_push_targets(org, message, mentioned)` returns who a line is pushed to and why, with the rule Q-CHAT18 (a)
ruled for CH6d — one rule, so a mute means the same on the PC, the bell and the phone:
- a line in a **direct or group** conversation, to every other participant who has not muted it;
- in a **channel**, only a mention of you or a reply to a post you wrote or replied to (0521's
  `chat_notify_targets`, read, not restated);
- muted `mentions`: a mention only; muted `all`: nothing; never the author, never somebody who left, never a
  suspended or removed member, never a driver conversation;
- an edit pushes only to the people it newly names (`mentioned`), as the bell does (D-CHAT22).

### 3.3 When — held 15 seconds, then only if still unread (D-WP3)

The phone must not buzz for a line its owner is reading on the PC. The server cannot see a screen, but it can see
the read boundary: an open, visible conversation marks the line read within seconds (realtime signal → refetch →
`POST /read`). So the push is **held 15 s and sent only to whoever still has not read past the line**
(`thread_participants.read_seq < seq`; for an edit's new mention, Activity's read instant instead). The same test
covers "already read it on another device". 15 s is the margin over the slow path measured in Q-CHAT14 (6.2 s for a
burst of 40 `/sync` calls). The hold runs in the API process that wrote the line, registered with `trackJob`, so a
deploy's drain (35 s) lets it finish; a crash loses at most that 15 s of pushes, never a line — the inbox and the
bell still hold it.

### 3.4 What it says and where it opens (D-WP4)

Q-CHAT18 (a), the desktop alert's own words: title "Ana" (direct), "Ana in Night desk" (group), "Ana in # Loads"
(channel); body the first 80 characters, mentions as `@Name`. The title and text builders move from the web into
`@silvicom/shared` so the two cannot drift. `tag: chat:<conversation>` + `renotify` (a conversation is one
notification that buzzes again), Web Push `Topic` = the conversation (a phone that was offline gets the latest, not
a pile), `Urgency: high`, `TTL` 1 hour (a chat line older than that is the inbox's job). It opens
`<origin>/chat?c=<id>` (or `?ch=` / `?ch=&post=` for a channel), on the origin the device subscribed from.

### 3.5 One control per device (D-WP5)

The rail's foot becomes "Notifications on this device":
- push available → **Turn on** (asks permission, subscribes, registers the device), then "On for this device ·
  Send a test · Turn off";
- iPhone/iPad in a Safari tab → the three steps: Share → Add to Home Screen → open Silvicom from the Home Screen,
  sign in, turn on;
- push unsupported but `Notification` present → CH6d's desktop alerts, as today.

With push on, the in-tab desktop alerts stand down on that browser, or the PC would show each line twice.
Every page load re-registers a live subscription (endpoint rotation, last-seen) — only for the person who turned it
on there (`localStorage` keyed by user); a subscription found under another person's choice is removed.

### 3.6 Security

- **The endpoint is a URL the client gives the server to POST to.** Accepted only as `https://` on the push
  services' hosts: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`
  — anything else is refused (no SSRF through the subscription).
- The origin must be one of `ALLOWED_ORIGINS`.
- VAPID keys are server variables: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`.
  Unset → push is off and the web shows only the desktop alerts. **Changing the key pair invalidates every
  subscription** (push services refuse a different key; rows are revoked on 403/404/410 and people turn it on again).
- Table: RLS on, no client policies; functions service-role only.
- **No library: `node:crypto`** (`apps/api/src/modules/messaging/webPush.ts`, D-WP8). The plan first chose
  `web-push` 3.6.7 (Jan 2024; 4.0.0 was a week old). Adding it re-resolved unrelated peers across the workspace
  lockfile (eslint's parser onto TypeScript 6, a second expo-router snapshot) — and a clean `main` regenerates
  with no change, so the churn was the dependency's. RFC 8291 encryption and RFC 8292 VAPID are ~100 lines on
  `node:crypto`, and RFC 8291's own worked example pins the encryption byte for byte (`webPush.test.ts`; the RFC's
  printed `Content-Length: 145` is erratum 5230 — its values make 144).

### 3.7 Not in this item

Bell categories (fuel alerts, DQ expiries…) as phone pushes — Q-WP3. Driver conversations (`/messages`) — drivers
have the Expo app, and production has 0 driver threads. App badge counts on the Home Screen icon.

## 4. Decisions

| ID | Decision |
|---|---|
| D-WP1 | One row per push endpoint; endpoint unique; rebinds to the latest person who turned it on |
| D-WP2 | Who is pushed is `chat_push_targets` (SQL), Q-CHAT18 (a)'s rule; channel half reads `chat_notify_targets` |
| D-WP3 | Held 15 s in the writing process, then pushed only to whoever has not read past the line |
| D-WP4 | Desktop alert's words (moved to shared), tag + renotify per conversation, Topic, TTL 1 h, Urgency high |
| D-WP5 | One device control; push replaces in-tab alerts on that browser; iPhone in Safari gets the Home Screen steps |
| D-WP6 | A conversation is marked read only while the page is visible (fixes §1's defect) |
| D-WP7 | Endpoints restricted to the four push services; origin restricted to `ALLOWED_ORIGINS` |
| D-WP8 | Web Push built on `node:crypto`, tested against RFC 8291's worked example; no `web-push` dependency |
| D-WP9 | A device not opened for 90 days (`last_seen_at`, refreshed by every page load) is revoked `unused` at the moment it would be pushed — no scheduler; revoked, never deleted; opening the app there again turns it back on (0602) |
| D-WP10 | "Your devices" lists the caller's live devices (never an endpoint or key); Remove revokes one as `removed`, which a page load on that device does NOT revive (409 `device_removed`, the browser lets go) — only a press of Turn on there does |
| D-WP11 | Reading a conversation on a device closes that device's notifications for it (`chatPushTag`, one definition for the push and the clear) |
| D-WP12 | `GET /api/version` publishes `webPush` (each live device's latest answer in 24 h) and folds it into `ok`; `platform-health.mjs` pages on `key_rejected` — more devices refused 401/403 than still delivered |

## 5. Work queue

| ID | What | Depends on |
|---|---|---|
| WP1 | Migration 0599: `web_push_subscriptions`; `web_push_subscribe` / `web_push_unsubscribe`; `chat_push_targets`; `revoke_push_tokens` also revokes web subscriptions. PGlite matrix `chat-web-push.test.mjs` (40 checks; six deliberate breaks of the migration each fail one) | — |
| WP2 | API: env, `webPush.ts` (send, classify failures), `chatPush.ts` (hold, targets, fan-out, record), routes `/api/chat/push` (key, subscribe, unsubscribe, test); web: `sw.js`, manifest + icons, `lib/webPush.ts`, the device control, sign-out removes this device, read-only-when-visible; shared contract + wording | WP1 on staging |
| WP4 | Migration 0602 (`unused`, `removed`); `GET /api/chat/push/devices`, `DELETE /api/chat/push/devices/:id`, the refresh rule (D-WP10); delivery and the test retire unused devices (D-WP9); "Your devices" dialog in the rail; clear on read (D-WP11); `webPush` health + the monitor's page (D-WP12) | WP2 |
| WP3 | VAPID keys in Parameter Store `/silvicom/staging/api/` and `/silvicom/production/api/` (a pair each), staging redeployed, then the device walk (§6); production loads its pair with the release that first carries WP2 | WP2 |

## 6. How to check it on staging

1. Android phone, Chrome: open staging, sign in, Chat → Turn on → Allow → Send a test: a notification in the tray.
2. Close Chrome. From a PC, another person sends a direct line: the phone shows "Name" + the text within ~15 s; tap
   opens that conversation.
3. Same with the conversation open and visible on the PC as the recipient: the phone stays silent.
4. iPhone: Safari shows the Home Screen steps; after adding and signing in inside the icon, steps 1–2 again.
5. Sign out on the phone: the next line does not arrive there.

## 7. Open questions

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-WP1 | Hold before pushing | (a) 15 s, then only if unread; (b) no hold — every device buzzes at once, including while reading on the PC; (c) push only when no tab of the person is open (needs presence, CH9) | **(a)**, built as recommended on the owner's "build it" (2026-11-13); (c) when CH9 lands |
| Q-WP2 | Text on a lock screen | (a) Q-CHAT18 (a)'s 80 characters, as on the PC; (b) no text on the phone ("New message from Ana") | **(a)**, built: the person's own device, and iOS/Android let the person hide previews system-wide. (b) is one flag if an office asks |
| Q-WP3 | Bell categories (fuel alerts, DQ expiries…) as phone pushes too? | (a) Not now — chat only; (b) per category, opt-in per person | **(a)**; the subscription table is channel-neutral, so (b) is a delivery loop and a settings row |
| Q-WP4 | Should a push respect the person's quiet hours and muted bell categories? Today only chat's own mutes apply (`chat_push_targets`). **Measured 2026-11-13: production has 0 `notification_preferences` rows** — nobody has quiet hours or a muted category, so any answer changes nothing for anyone today. ⚠ The bell's rule is ONE function, `notification_allowed` (0089), and its FIRST question is the org's `notifications` module: "follow the bell exactly" would silence chat pushes for any carrier that bought Messages but not Notifications | (a) exactly the bell's rule, `notification_allowed` as is; (b) the person's half of it — their quiet hours (critical never suppressed) and their mute of the chat categories — without the module question, which `messages` already answers for chat; (c) leave as is until somebody sets quiet hours | **(b)**, as one new SQL function both `notification_allowed` and `chat_push_targets` call, so the rule is not restated (a migration: drop and recreate `chat_push_targets`, its shape unchanged). Owner to rule |
| Q-WP5 | Clear a notification on the OTHER devices once a conversation is read anywhere? | (a) Not possible reliably on the web — a push that only clears must still show a notification (§2 rule 1; Safari revokes the permission otherwise); (b) a silent "clear" push on Android only | **(a), a known limit**: a device's notification clears when it is tapped, dismissed, replaced by the next line of that conversation (same tag), or when the conversation is read on that device (D-WP11) |

## 8. Sources (2026-11-13)

- WebKit, "Meet Declarative Web Push" — https://webkit.org/blog/16535/meet-declarative-web-push/
- WebKit, Safari 18.4 — https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- WebKit, Safari 26.0 (Home Screen web apps by default) — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- W3C Push API, declarative push message — https://w3c.github.io/push-api/
- Google, automatic notification-permission revocation — https://blog.google/chromium/automatic-notification-permission/
- Pushpad, notifications with the browser closed — https://pushpad.xyz/blog/can-you-display-notifications-when-the-browser-is-closed

## 9. Progress log

- 2026-11-13: plan written from the measurements in §1 and the research in §2; WP1 built.
- 2026-11-13: WP1 opened as PR (migration 0599). WP2 built on top: shared contract and wording
  (`chatPushContract.ts`), transport (`webPush.ts`), delivery (`chatPush.ts`, held 15 s), routes `/api/chat/push`,
  `sw.js` + manifest + icons, `lib/webPush.ts`, the rail control, sign-out stops the device, read only while
  visible (D-WP6). Each of six deliberate breaks (read while hidden, sw opening another site, gone not revoked,
  origin unchecked, another person's subscription kept, a lax push host) turns a test red.
- 2026-11-13: WP2 merged. Its deployment notes first named Railway services; corrected for AWS (Parameter Store, `api` service only, redeploy to load) after the owner pointed out Railway production was retired on 2026-10-28.
- 2026-11-13: staging check, signed in as the test dispatcher: `GET /api/chat/push` answers **403 `module_disabled`** — the staging org has no Messages module, so chat itself (and the device walk, §6) cannot run there until it is granted (admin console entitlement, or the owner's SQL with its audit row).
- 2026-11-13: WP4 built: migration 0602, the device list and Remove, the refresh rule, unused devices retired at delivery, clear on read, `webPush` health on `/api/version` paged by `platform-health.mjs` on `key_rejected`. Q-WP4 (quiet hours) and Q-WP5 (other devices) written up; Q-WP4 waits on the owner.
