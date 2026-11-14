# Installed app — security and app experience

**Status:** plan + first batch, 2026-11-14. Follows `CHAT-WEB-PUSH-PLAN.md` (WP1–WP7), which made the office app
installable, taught it Web Push, an install offer, per-platform icons and pull-to-refresh.

**The ask (owner, 2026-11-14):** after installing the app on every device but Windows — "based on real world
examples and enterprise-grade best practices, what can we improve on this application, regarding security and
UI/UX (not the content, the application itself)", then: "update our plan with these and build them without any
assumptions."

So every row below states what was MEASURED, and anything that could not be measured from the repo or from
production is an open question in §5 with its candidates — not a guess with a default.

## 1. What the installed app is (measured 2026-11-14)

| Fact | Where |
|---|---|
| The installed app is the web SPA in a standalone window: `display: standalone`, `start_url: /`, no offline copy | `apps/web/public/manifest.webmanifest`, `public/sw.js` (no `fetch` handler, no cache) |
| Production answers with a strict CSP (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'self'`), HSTS one year with subdomains, `nosniff`, `Referrer-Policy: no-referrer`, COOP and CORP `same-origin` | `curl -sI https://360.silvicominc.com/` |
| Sign-in is Supabase email + password. **The office app has no second factor**: no `mfa`, `totp`, `aal2`, passkey or SSO call anywhere in `apps/web/src` or `apps/api/src` | `git grep` for those words, non-test files: no hit |
| **The platform console already has one**: TOTP through Supabase Auth, the API checking `aal2` | `apps/admin/src/pages/MfaPage.vue`, `apps/admin/src/lib/jwt.ts` |
| A sensitive act re-asks the password (step-up) | `apps/api/src/routes/authStepUp.ts`, `apps/web/src/components/StepUpPrompt.vue` |
| Access token lives 1 hour; refresh tokens rotate. **No idle limit and no maximum session age**: `[auth.sessions]` `timebox` and `inactivity_timeout` are commented out | `supabase/config.toml` 165–174, 272–276 |
| Sign-out is local to the device (`scope: "local"`); nothing lists a person's sessions or ends another device's | `apps/web/src/stores/session.ts`, `apps/web/src/lib/api.ts` |
| A person can list and remove their NOTIFICATION devices — that stops pushes, it does not sign the device out | `CHAT-WEB-PUSH-PLAN` D-WP10 |
| A push shows the sender and the first 80 characters of the line on the lock screen | `CHAT_ALERT_TEXT_MAX`, `packages/shared/src/chatPushContract.ts` |
| The sidebar's chat count is `unread_total` of the inbox query, muted conversations excluded | `apps/web/src/composables/useNavCounts.ts`, `apps/api/src/modules/messaging/chat.ts:116` |
| One `theme-color` (`#18274d`) for both colour schemes; the app itself has light, dark and system | `apps/web/index.html`, `useColorScheme.ts` |
| No `viewport-fit`; `env(safe-area-inset-*)` is read in `ShopLayout`, `SectionTabBar` and `WalkActions` only | `git grep safe-area-inset` |
| The manifest has no `shortcuts`, `screenshots`, `launch_handler` or `handle_links` | `manifest.webmanifest` |

## 2. Security

| ID | What | Why | State |
|---|---|---|---|
| IA-S1 | A second factor for the office app, reusing the console's Supabase TOTP path; passkeys after | A stolen password is the likeliest way in; §1 shows none exists | **Needs Q-IA1** |
| IA-S2 | A session ends after a time without use | An installed app on an unlocked phone stays signed in indefinitely (§1: no idle limit) | **Needs Q-IA2** |
| IA-S3 | "Signed-in devices": list a person's sessions, end one, end all others | Today a lost phone can only be handled by changing the password | **Needs Q-IA3** (design below is settled; the ruling is who may end whose) |
| IA-S4 | Lock-screen privacy: a push that says "New message from Ana" with no text | 80 characters of a line are readable on a locked phone (§1) | **Needs Q-IA4** |
| IA-S5 | Company sign-in (SSO) with the carrier's Microsoft or Google | One switch to remove a leaver | **Needs Q-IA5** |

**IA-S3, how it would work.** Supabase keeps one row per session in `auth.sessions` (user agent, IP, created,
refreshed). A service-role SQL function returns the caller's rows — never tokens — and another deletes one; the
API routes sit beside `/api/chat/push/devices`. "Sign out everywhere else" needs no schema at all:
`supabase.auth.signOut({ scope: "others" })`. A new function and its reader ship in two merges.

## 3. App experience

| ID | What | State |
|---|---|---|
| IA-U1a | Unread chat count on the app icon while the app is open (`navigator.setAppBadge`), the sidebar's own number | **Built, this PR** |
| IA-U1b | The count carried BY the push, so the icon is right while the app is closed: `notification.app_badge`, a string, which Safari applies by itself (WebKit, "Meet Declarative Web Push" — the W3C Push API draft read 2026-11-14 does not list the member, so it is WebKit's); on Chromium the service worker sets it from the same field | Planned — the API must compute each recipient's unread total at send time; `chat_push_targets` does not return it |
| IA-U2 | A "no connection" screen in place of the browser's error page | **Built, this PR** (D-IA2) |
| IA-U3 | The phone's notch and home bar | **Needs Q-IA6** — cannot be measured without a real iPhone |
| IA-U4 | The title bar follows the app's colour scheme | **Built, this PR** (D-IA3) |
| IA-U5 | Long-press shortcuts on the icon | **Built for Chat, this PR**; more need Q-IA7 |
| IA-U6 | Screenshots and a description in Android's install dialog | **Needs Q-IA8** |
| IA-U7 | A notification or shortcut reuses the window already open instead of opening a second | **Built, this PR** (D-IA4); links from other apps opening the installed app: not built, see D-IA4 |
| IA-U8 | "Mark as read" on the notification | Planned — the service worker holds no sign-in (`sw.js`), so the push must carry a single-use token the API accepts for that one conversation; its own design step |

**Deliberately not planned.** A full offline mode (a second copy of fleet and driver data on every device: stale
answers and a larger loss when a phone is lost) and an app-store listing (store review and per-platform builds
for a team reached by a link).

## 4. Decisions

| ID | Decision |
|---|---|
| D-IA1 | The icon's number is the sidebar's chat number (`unread_total`, muted conversations excluded) and nothing else — one definition, so the icon and the sidebar cannot disagree. Cleared at sign-out. Set only where the browser has the Badging API; elsewhere nothing happens |
| D-IA2 | The service worker gains a `fetch` handler for ONE case: a page navigation that fails for lack of a network answers with `/offline.html`, cached at install. Nothing else is cached or intercepted — API calls, assets and every successful navigation go to the network exactly as before, so `sw.js`'s rule ("no second copy of the app that could go stale") still holds. The page offers Retry and retries by itself when the device reports a connection |
| D-IA3 | `theme-color` is the app's canvas in the scheme the person chose — read at runtime from what `<html>`'s background resolved to (`--canvas`), converted to sRGB, never restated, so an installed window's title bar continues the page. `index.html` keeps a static pair by `prefers-color-scheme` (`#f7f7f8` / `#121214`, the token's two sides measured in Chromium) for the moment before the app runs. The manifest's own `theme_color` stays the brand navy: it colours the splash screen and the task switcher, where there is no page to continue |
| D-IA4 | `launch_handler: { client_mode: ["navigate-existing", "auto"] }` — a notification or link reuses the open window instead of opening a second one. Chromium only; other browsers ignore it. ⚠ "A link in an email opens the installed app" is NOT built: the manifest member proposed for it (`handle_links`) could not be confirmed as shipped from here, and an unverified manifest field is a guess. Chrome on a PC already offers "open in app" for an installed site by itself |
| D-IA5 | One shortcut, **Chat**: the one page every installer of this app can be assumed to want (it is what the install offer promises). Others wait for Q-IA7 because a shortcut is the same for every person and role |

## 5. Open questions (the owner's rulings)

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-IA1 | Second factor: for whom, and how strict? | (a) optional, each person turns it on; (b) required for admins and owners, optional for the rest; (c) required for everyone | **(b)**, with an authenticator app (TOTP) first because the console's path already exists; passkeys as a second step |
| Q-IA2 | Idle sign-out: after how long, and where? | (a) Supabase's own inactivity timeout — server-enforced, one value for every device, set in the dashboard's Auth → Sessions page, Pro plan and up (Supabase docs, "User sessions", read 2026-11-14). It is checked when a session next refreshes, so the real limit is the timeout plus the 1-hour token life; (b) the same plus a shorter limit on phones only, enforced in the app; (c) none. Durations to choose from: 8 h, 12 h, 24 h, 7 days | **(a) at 12 h**: a dispatcher's PC survives a shift's quiet stretch, a phone left in a truck is signed out by morning. ⚠ A dispatcher signed out mid-shift is the cost of going shorter |
| Q-IA3 | Signed-in devices: may an admin end another person's sessions, or only each person their own? | (a) own only; (b) own, plus admins for anybody in their company | **(b)** — offboarding is the case that matters |
| Q-IA4 | Lock-screen privacy: who decides? | (a) each person, a switch beside Do not disturb; (b) the company, for everybody; (c) both, the company's setting winning | **(a)** first (no company settings column to add), (c) if a carrier asks |
| Q-IA5 | SSO: which identity provider does the office use, and is every user in it? | Microsoft 365 / Google Workspace / none | Needs the fact before any work; Supabase SAML SSO is a paid add-on to confirm |
| Q-IA6 | Does content sit under the notch or the home bar in the installed app on an iPhone? | — | A screenshot of the top and the bottom of any page in the installed app answers it. Without `viewport-fit=cover` iOS may already keep the page inside the safe area, in which case there is nothing to fix |
| Q-IA7 | Which other pages get an icon shortcut (up to three more)? | Dispatch board, Live map, Drivers, Loads… | The owner's pick; a person without access to one lands on the app's own "no access" page |
| Q-IA8 | Install-dialog screenshots: of which pages, with whose data? | (a) staging with test data; (b) composed images | **(a)**, once staging has presentable data |

## 6. Work queue

| ID | What | Depends on |
|---|---|---|
| IA1 | This plan; IA-U1a, IA-U2, IA-U4, IA-U5 (Chat), IA-U7 — web only, no migration | — |
| IA2 | IA-U1b: unread total in the push, `app_badge`, service worker sets it | IA1 |
| IA3 | IA-S4 lock-screen privacy | Q-IA4 |
| IA4 | IA-S2 idle sign-out | Q-IA2 |
| IA5 | IA-S3 signed-in devices (function, then routes + dialog) | Q-IA3 |
| IA6 | IA-S1 second factor | Q-IA1 |
| IA7 | IA-U3 safe areas | Q-IA6 |
| IA8 | IA-U8 mark as read from the notification | IA2 |
| IA9 | IA-S5 SSO | Q-IA5 |

## 7. Progress log

- 2026-11-14: plan written from the measurements in §1. IA1 built.
- 2026-11-14: IA1 checked in Chromium at phone size on the built app: the service worker caches the no-connection page and its picture, a page load with the network cut shows it (dark scheme, picture drawn), **Try again** returns to the page once the network is back; the title-bar tag is one tag holding the canvas. Not checked on a real device: the icon number (Chromium headless has no icon) and the title bar itself.
