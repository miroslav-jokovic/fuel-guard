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
| D-IA6 | `Permissions-Policy` from one table (`apps/api/src/permissionsPolicy.ts`): camera, screen wake lock and clipboard-write to this origin only — the three the app calls — and microphone, geolocation, screen capture, payment, USB, serial, Bluetooth, HID and MIDI off. A feature the list does not name keeps the browser's default. Mounted inside `securityMiddleware`, so no server can send helmet's headers without it |

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
| Q-IA9 | Which address should `security.txt` name for vulnerability reports? | An existing mailbox the owner reads | Needs the address; nothing is published until then |

## 5a. Security audit, 2026-11-15

Read-only, against production and the code on `main`; not a penetration test. What held: every API route tried
without a sign-in answered 401; the publishable key read no rows from six tables; the web bundle carries no
secret; no source maps are served; a foreign origin gets no CORS permission; no `eval`, and the only `v-html`
is in-repo placard art.

| ID | Finding | Measured | Fix | State |
|---|---|---|---|---|
| A1 | Public sign-up is ON in the production Supabase project | `GET /auth/v1/settings` → `disable_signup: false`; the app never calls `signUp` (accounts come from `admin.createUser` in `inviteRedemption.ts` and `driverCredentials.ts`) | Dashboard → Authentication → "Allow new users to sign up" off. An account made that way has no company and the API refuses it (`middleware/auth.ts`), so no data was found within its reach — but it is a valid login nobody invited | **Owner's switch** |
| A2 | No second factor | §1 | IA-S1 | Q-IA1 |
| A3 | No idle limit, no session age limit | §1 | IA-S2 | Q-IA2 |
| A4 | 119 published advisories (3 critical, 69 high) across the workspace; nothing in CI looks | `pnpm audit --prod`, 2026-11-15 | IA10–IA12 below | Being built |
| A5 | The page's CSP allows `https://fleetguardapi-production.up.railway.app`, a host that now answers 404 | The response header on `360.silvicominc.com`; it comes from the api service's `VITE_API_URL` setting (`securityMiddleware`), not from code, and the production bundle never calls that host | Remove or correct that setting in Parameter Store and redeploy. Claude has no AWS credentials on this machine and is refused Parameter Store writes, so the name of the parameter is not confirmed from here | **Owner's command** |
| A6 | No `Permissions-Policy` header | Response headers | D-IA6 | **Built** |
| A7 | No `/.well-known/security.txt` | 404 | Needs the address reports should go to | Q-IA9 |

**Not verifiable from outside:** the hosted project's password minimum and leaked-password check (the checked-in
`supabase/config.toml` says 6 characters and is local-development config; the app itself enforces 12 —
`PASSWORD_MIN_LENGTH`). Same dashboard page as A1.

**The advisories that reach what the office runs** (the driver app's are build tooling and ship through its own
release lanes):

| Where | Library | Worst | Note |
|---|---|---|---|
| web | `maplibre-gl` 5.24.0 | critical — sanitiser bypass | Fixed in 6.4.1, a major version. Popups are built with `setDOMContent`, never `setHTML`, which limits exposure; not every path traced |
| admin-api | `proxy-addr`, `body-parser`, `ip-address`, `qs`, `zod` | critical — address spoofing under Express's proxy trust | In-range updates |
| api | `sharp`; under `soap`: `axios`, `@xmldom/xmldom`, `follow-redirects`; under `exceljs`: `brace-expansion`, `uuid` | high — mostly denial of service by crafted input | `sharp` and the Excel reader take uploaded files: first |
| admin | `vue` (`@vue/server-renderer`), `postcss`, `nanoid`, `source-map-js`, `vite` | high | Build-time or unused at runtime (no server rendering here) |

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
| IA10 | D-IA6 `Permissions-Policy`; this audit written into the plan | — |
| IA11 | In-range and patch upgrades for api, admin-api, admin, web; a nightly advisory check that fails on a new critical or high one reaching an office app | IA10 |
| IA12 | `maplibre-gl` 6, checked on the live map in a browser | IA11 |

## 7. Progress log

- 2026-11-14: plan written from the measurements in §1. IA1 built.
- 2026-11-14: IA1 checked in Chromium at phone size on the built app: the service worker caches the no-connection page and its picture, a page load with the network cut shows it (dark scheme, picture drawn), **Try again** returns to the page once the network is back; the title-bar tag is one tag holding the canvas. Not checked on a real device: the icon number (Chromium headless has no icon) and the title bar itself.
- 2026-11-14: IA2 built (IA-U1b): `deliverChatPush` asks each recipient's own inbox total with `chatInbox` — the sidebar badge's function — after the hold and sends it as `notification.app_badge`; the service worker sets the icon from it where the browser hands it the push. A total that cannot be read sends the push without a number. Five deliberate breaks each fail a test (the sender's total instead of the recipient's, an unreadable inbox failing the push, a non-integer taken as a count, a number accepted where a string is specified, zero sent as a badge). Cost: one `chat_inbox` call per recipient per push. Not seen on a real icon.
- 2026-11-15: security audit (§5a). Owner: "make these updates with the proposed and recommended solutions; our goal is for this to work as well and as securely as possible." **Claude's reading, to be corrected if wrong:** that rules the questions that had a recommendation as recommended — Q-IA1 (b) second factor required for admins and owners, TOTP first; Q-IA2 (a) idle limit 12 h; Q-IA3 (b) admins may end anybody's sessions in their company; Q-IA4 (a) lock-screen privacy per person. Q-IA5 (which identity provider), Q-IA6 (a screenshot), Q-IA7–Q-IA9 still need a fact only the owner has. A1, A5 and the idle limit are switches in dashboards Claude cannot reach. IA10 built.
- 2026-11-15: IA10 merged and on staging (`permissions-policy` in the response). **A5 was larger than the audit saw from outside.** With the owner's AWS sign-in the settings could be read (region `us-west-2`): besides `/silvicom/production/web/VITE_API_URL`, BOTH production `ALLOWED_ORIGINS` (api and web) still listed `https://fleetguardweb-production.up.railway.app`. Both Railway production hosts answer "Application not found" — claimable names. The owner ran the write (Claude is refused Parameter Store writes): all three are now `https://360.silvicominc.com`, the value GitHub's `PRODUCTION_VITE_API_URL` has built the bundle with since 2026-10-27; version 1 of each holds the old value. In force from the next production deploy. Staging's settings have the same kind of leftovers, but its Railway hosts still answer, so nothing there is claimable; `/silvicom/staging/web/*` looks unread (staging serves the app from the api service) — its own step.
- 2026-11-15: IA11 first round: `pnpm-workspace.yaml` `overrides` pin the patched release of nine indirect libraries within their current major line (`proxy-addr`, `body-parser`, `qs`, `ip-address`, `axios`, `follow-redirects`, `@xmldom/xmldom`, `brace-expansion` 1 and 2) and `sharp` moves to 0.35.5: `pnpm audit --prod` 119 → 54 (critical 3 → 2, high 69 → 26). A plain `pnpm update` of the same names rewrote 1,500 lockfile lines and closed two, so it was undone. Left, each its own step: `maplibre-gl` 6 (IA12), `zod` 4.6 (every package pins 4.4.3), `vue`/`vite` in the console, `uuid` under `exceljs` (fixed only in a major the reader does not ask for), and the driver app's build tooling.
- 2026-11-15: owner: "go" — the reading of the four rulings above stands (Q-IA1 b, Q-IA2 a at 12 h, Q-IA3 b, Q-IA4 a).
- 2026-11-15: IA12 built: `maplibre-gl` 5.24.0 → 6.18.0, closing the critical sanitiser advisory (fixed in 6.4.1). What 6 changed that touched this app: no default export (`import * as maplibregl`); `styleimagemissing` only reports now, so the place icons go through `setMissingStyleImageResolver` (`mapIcons.ts`); and the worker is loaded by address instead of inlined. **That last one would have shipped a dead map**: the first build had no worker file in `dist/assets`, every unit test passed (they fake maplibre), and the map would have drawn nothing in production only. Fixed with `setWorkerUrl` on a `?url` import, and pinned by a new browser test, `e2e-apply/liveMap.spec.ts`, which runs the built map under the server's real CSP and fails for that build (worker answers 404). ⚠ Not seen: real HERE tiles, the vector basemap, place icons and truck markers — the test's tiles are a stub. A person's look at the map on staging is owed before release.

- 2026-11-15: IA11's second half built: `scripts/check-advisories.mjs`, run nightly at 10:23 UTC by `.github/workflows/advisories.yml` and on any PR touching the lockfile, the workspace overrides or the check (`pnpm check:advisories`). **The entry above was wrong about where the leftovers are, and the check is built on why.** `pnpm audit` names ONE dependency path per vulnerable version, not one per package that installs it: it listed zod 4.4.3 under `apps__admin-api` alone and vue's server renderer under `apps__admin` alone, and both are in the web app's tree — as are `postcss`, `nanoid`, `source-map-js` and `vite`. So "in the console" was the report's first path, not a measurement. The check takes only the vulnerable (library, version) pairs from the audit and reads where each is installed from `pnpm ls --prod` per office package. Today: 7 high advisories reach the office app, 0 critical — zod in all four packages, the other six in web and admin. All seven are accepted in `scripts/advisory-baseline.json`, per package, each with its reason; the list may only shrink, because an entry that no longer describes anything fails the run. Every one has a fix inside the range already asked for, so the baseline is a queue, not a waiver: zod 4.6 next (its own PR), then vue 3.5.42 / vite 8.1.6 and the three under the template compiler. Not judged: the driver app (own release lanes), moderate and low (6 today, counted in the output). The workflow is not behind the required `build` check — an advisory published in the morning must not block an unrelated merge in the afternoon — so a red nightly run reaches the owner as GitHub's failed-workflow email and nothing else.
- 2026-11-15: the advisory check merged (#2427); its first run on a PR passed in 35 s. zod 4.4.3 → 4.6.7 in all nine `package.json` files that pin it, closing GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6: array, set and map size bounds are checked before the members are parsed) for web, api, admin and admin-api; the lockfile moves zod and nothing else, and the baseline loses its zod line in the same change, as the check demands (it failed with `STALE baseline entry` until the line went). Read in zod's release notes between the two versions, for what this code calls: `z.toJSONSchema` now writes a record's numeric keys as strings (4.5.3) — it builds the model tool schemas in `lib/anthropic.ts` and `document-reading/model/wireSchema.ts`; `z.string().url()` rejects through `URL.canParse` (4.6.4) — every URL setting in `env*.ts`; `fromJSONSchema` enforces more keywords (4.6.0) — not called anywhere here. The driver app carries the same pin and moves with it; its second copy, zod 3.25.76 under Expo's tooling, is not ours to move. Six high advisories are left in the baseline, all under vue and vite.
- 2026-11-15: IA3 (IA-S4, lock-screen privacy), schema half: migration 0614 adds `notification_preferences.hide_push_text` (false for everybody) and two service-role functions — `chat_push_text_hidden_for(org, people[])`, which answers the people in a list who hide, and `chat_push_hide_text(org, person, hide)`, which sets it. One row per person beside the pause and the nightly window, each leaving the other untouched. `chat_push_targets` is NOT redefined: hiding changes what a push says, never who gets one. Matrix `supabase/tests/chat-push-text-hidden.test.mjs`, 24 cases; eleven deliberate breaks of the migration each failed at least one (reader ignoring the organisation, the suspension, the list or the switch; setter skipping membership, reading null as off, never updating, wiping the pause; either function granted to a browser; the default turned on). Nothing reads it yet — the route, the control beside Do not disturb and the reworded push are the next merge. **Two wordings settled there, written here so they can be overruled first:** a hidden push says "New message from Ana" and nothing else — no line, and no conversation name either, because a group's name is typed by people and can say as much as a line; and the switch covers the in-tab desktop alert as well as the phone, since Windows and macOS show those on a locked screen too.
- 2026-11-15: IA3, code half, after 0614 merged (#2432) and `migrate-staging` applied it (staging `/api/version`: applied 0614). `GET`/`PUT /api/chat/push/privacy` (`routes/chatPushPrivacy.ts`); the control **Message text in notifications: shown / hidden** in the chat rail under Do not disturb (`ChatPushPrivacy.vue`); and one wording, `chatAlertWords` in `@silvicom/shared`, used by the phone's push and the in-tab alert alike. **D-IA7:** hidden, an alert is "New message from Ana" with an empty body — the sender stays (an alert that does not say who has to be opened every time), the conversation's name goes with the line. **D-IA8:** when who hides cannot be read, the text is hidden — in the delivery for that message's recipients, in a tab until the server has answered — and the alert is still sent; hiding wrongly costs one vaguer alert. The first build of the delivery got this wrong in a way only its test showed: the chat `rpc` helper throws on an error it has no words for, so an unreadable setting would have stopped the push for everybody. Thirteen deliberate breaks each failed a test; one of them found a missing test (the route answering what was asked instead of what was stored). ⚠ Not seen on a device: staging's company has no Messages module, so a locked phone showing "New message from …" can only be looked at on production after the release.
