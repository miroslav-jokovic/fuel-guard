# Driver App Visual 2026: a native shell, the carrier's brand, one look per screen

**Status:** PLAN, written 2026-11-20. Nothing is built. The steps run in order (V0 → V9), one PR each.
**Owner ruling that frames this plan (2026-11-20):** do the visual update first and build it. The features (the
McLeod API Kit driver surface) get their own plan and build afterwards.
**Read with:** `redesign-2026/DRIVER-APP-2026-ANALYSIS.md` (trends, rebuild vs rewrite, store
readiness, skills) and `apps/driver/DESIGN.md` (the contract this plan rewrites in V2).

---

## 0. Ground truth (measured on `origin/main` 1ba3d45af, 2026-11-20, not recalled)

- **Stack.** Expo SDK 57 (`expo ^57.0.11`), React Native 0.86.2, React 19.2.3, Expo Router 57, NativeWind 4
  over Tailwind 3.4, Reanimated 4.5. npm `expo@latest` is **58.0.26**, and `sdk-57` is 57.0.33.
- **Size.** 27 route files under `app/`. About 18.9k lines across `app/`, `src/` and the native capture module. 32 test files.
- **Tabs.** `app/(tabs)/_layout.tsx` uses `<Tabs>` with a fully custom JS `TabBar` (`src/components/TabBar.tsx`, 247
  lines, plus `tabBarModel.ts`). The tab set is **Home · Loads · Documents · More** (D-DB14, owner 2026-09-07). Score
  and Navigate are hidden routes. Tab motion is `animation: 'none'` (owner 2026-09-07).
- **Theme.** `src/theme/theme.roles.json` has **50 roles × 4 themes** (light, dark, highContrastLight,
  highContrastDark). The light canvas is cream `243 239 232`, and brand is charcoal-navy `31 36 51`, which is **not** the
  carrier's navy `#0A2144`. Action is apricot `242 178 103` and accent is lavender.
- **Type.** A single typeface, Lexend 400–700 (D-DB3), with an 11-variant scale in `src/theme/tokens.ts`. Fixed point sizes.
  `AppText` allows font scaling, and three badge/tab call sites turn it off.
- **Icons.** HugeIcons SVG through `Icon`. Material Symbols fonts are already bundled in `assets/fonts/`, and
  `materialSymbols.generated.ts` exists.
- **Primitives.** 37 files in `src/components/`. Today has its own pieces under `src/screens/today/`.
- **Gates that already guard this code:** `lint:tokens`, `lint:theme` and `lint:design`
  (`scripts/check-driver-*.mjs`) in `apps/driver`.
- **None of the last three visual passes reached a phone.** GitHub has held the driver workflows as
  "possibly malicious" since 2026-08-22 (memory: driver-release-lanes-need-approval). This plan's device
  check (V9) therefore runs on local dev-client builds, and the store/OTA path is a separate owner action.
- **Native availability for SDK 57:** `expo-router/unstable-native-tabs` (the stable import path is SDK 58+),
  `@expo/ui` 57.0.26, `expo-widgets` 57.0.28 (iOS widgets + Live Activities, Android widgets),
  `expo-glass-effect` 57.0.5. Each of these adds native code, so **each is a runtime-version bump**
  (`runtime-version.json`, D-S5).
- **The repo is PUBLIC** (`miroslav-jokovic/fuel-guard`). The reference screenshots
  (`redesign-2026/REFERENCE-GALLERY.html` plus `refs/`, 59 App Store images, 6 MB) are third-party marketing art and
  **stay out of git**. The ten apps are named by App Store id in §1.1, and the gallery is rebuilt locally from
  Apple's lookup API.

## 1. The visual world (proposed decisions D-DV1–D-DV14; each becomes final when the owner rules on V1's mock)

### 1.1 References (owner: "great examples", 2026-11-20)

For each app, one thing to take from it:

| App | App Store id | Idea to take |
|---|---|---|
| Flighty | 1358823008 | The current load as one live status: big times and a "tight" warning only when it is true |
| Uber Driver | 1131342792 | "Remaining steps" with ONE recommended next step |
| Linear | 1645587184 | Dark as its own design, a floating native tab bar, swipe-to-act rows |
| Things 3 | 904237743 | Today grouped by time block, rows without card chrome |
| Copilot Money | 1447330651 | One number with its context, plus a review queue with Approve/Dismiss |
| Tesla | 582007913 | The vehicle as the interface (later, for DVIR) |
| Strava | 426826309 | One saturated brand colour on near-black, the route as a strip and not a full map |
| Revolut | 932493382 | A real photograph as the hero, with four round actions under it |
| CARROT Weather | 961390574 | Glass only on controls floating over a map |
| Airbnb | 401626263 | Depth on controls, photos doing the work |

The gallery lists what *not* to take from each app as well (emoji, "Welcome back, Name", pastel gradients, feeds).

### 1.2 Decisions

- **D-DV1 · Native chrome, custom content.** The tab bar, stack headers, sheets, menus, pickers and switches are the
  operating system's own:
  - Expo Router NativeTabs and the native stack;
  - `@expo/ui` for BottomSheet, Picker, Switch and Menu.

  On iOS 26 they render as Liquid Glass, and on Android 16 as Material 3 Expressive, with no code of ours drawing either.
  Our design lives in the *content*: type, colour, the load status, the rows.

  *Why:* every custom-drawn shell has been redrawn four times (DS2, B0, D-DB11's notch, D-DB15). A native one is
  correct on day one and stays correct when the OS changes again. It also deletes `TabBar.tsx` plus `tabBarModel.ts`, 388 lines, and
  their 13-test file.
- **D-DV2 · Glass only on the system's chrome.** We never put `GlassView` on content, and never fake glass on Android.
  The one place we add our own glass is floating map controls (CARROT), and that is iOS 26 only, with a solid fallback.
- **D-DV3 · The carrier's colours, not ours.** Ink and brand become the carrier navy `#0A2144`, measured from the wordmark.
  The "live / on the road now" colour becomes the carrier cyan `#00B2E3`, taken from the trailer decal. Cream, apricot and lavender
  retire.
- **D-DV4 · Dark-first.** Dark is the designed state, because drivers use the app before dawn and at night. Light is its daylight
  twin. The system setting chooses by default, and Settings → Theme stays.
- **D-DV5 · Colour has jobs, never decoration.** The roles are:
  - Cyan means *live*: the current load, the active stop, "sent".
  - Amber means *you must act*: the single primary action and time-critical state.
  - Red means *safety or compliance stop*.
  - Green means *done / compliant*.

  Nothing else is coloured. That rules out tinted icon discs per row meaning (it retires D-DB6's lavender/tile-grey discs)
  and section colours.
- **D-DV6 · One signature per screen**, after D-DB7, re-pointed:
  - Today: the current load as a Flighty-style status block.
  - Loads: the next appointment in numerals.
  - Stop: a route strip.
  - Documents: a review queue.
  - More: none.
- **D-DV7 · No cards around rows.** Lists are rows on the canvas, grouped by space (Things). A raised surface is
  used only for the one signature block and for sheets. This retires the "every object is the same bordered card" finding (critique
  P0-4).
- **D-DV8 · Two type roles.** Text is set in the platform face (SF Pro / Roboto), so Dynamic Type and the OS's native
  rendering work. Figures and screen titles use a brand display face (Q-DV1). Tabular numerals apply wherever two
  numbers can align. This retires D-DB3's single typeface, which is the banned "one family for everything" tell.
- **D-DV9 · Sizes scale.** Every text role follows Dynamic Type / Android font scale up to the accessibility
  sizes. Layouts reflow, and nothing truncates a time, unit number or stop name. `allowFontScaling={false}` stays only on
  the tab badge.
- **D-DV10 · Glove targets.** The primary action is ≥ 56 pt tall in the bottom third of the screen. Rows are ≥ 56 pt and other
  targets ≥ 48 pt, above the 44/48 platform minimums.
- **D-DV11 · Icons are the platform's.** SF Symbols on iOS and Material Symbols on Android. Both are what NativeTabs
  takes natively, and Material Symbols are already bundled. HugeIcons retire.
- **D-DV12 · Motion only says something happened.** Haptic plus a single short fade or slide confirms a scan, a send or a
  completed stop. There is no tab motion (owner 2026-09-07 stands), no bounce and no decorative animation, and Reduce Motion is
  honoured.
- **D-DV13 · Honest figures only.** D-DB8 stands: there is no ETA or "4.8 mi" while no routing service is reachable. "Appointment
  in 3 h 10 m" counts down to a real appointment time and is allowed. A "Tight" warning appears only when the rule behind it
  is written and tested (V5).
- **D-DV14 · Banned devices** (the carrier brand skill plus draftbit's mobile tells list): purple/indigo gradients,
  glass on content, glow, gradient text, emoji icons, "Welcome back, Name", pills used as decoration, hairline dividers between
  everything, tracked small-caps kicker labels, a FAB, a five-tab bar, and white rounded-card stacks.

## 2. The token contract (values; V2 writes them, `lint:theme` checks contrast)

Role **names** do not change. All 50 stay, so every screen picks up the new look through the tokens before any
screen is touched. Only values change. The core values are below, with contrast measured 2026-11-20 against the stated
background (WCAG ratio, 4.5 needed for text):

| Role | Dark ("Night cab") | Light ("Day steel") |
|---|---|---|
| canvas | `#070D1A` | `#EEF2F7` |
| surface | `#0F1A2E` | `#FFFFFF` |
| surface-raised | `#16243C` | `#FFFFFF` |
| edge | `#233452` | `#D3DAE4` |
| ink | `#E8EDF5` (14.8 on surface) | `#0A2144` (14.2 on canvas) |
| ink-secondary | `#A9B4C6` (8.3) | `#3D4E6B` (7.5) |
| ink-muted | `#7F8BA0` (5.1) | `#5D6B82` (4.8) |
| brand / hero | `#0A2144` | `#0A2144` |
| live (cyan) fill | `#00B2E3`, navy text on it (6.5) | `#00B2E3`, navy text on it (6.5) |
| live as text | `#00B2E3` (7.0) | `#006E8E` (5.2) |
| action (amber) | `#FFB020`, `#1A1200` text (10.2) | `#FFB020`, `#0A2144` text (8.7) |
| action as text | `#FFB020` (9.5) | `#9A5B00` (4.8) |
| danger | `#FF6B6B` (6.3) | `#C8323A` (4.7; white on it 5.3) |
| success | `#3DD68C` (9.3) | `#1F7A4D` (4.7) |

Mapping onto the existing roles:
- `operation-current` → live
- `operation-next` → ink-secondary
- `operation-complete` → success
- `operation-blocked` → danger
- `sync-*` → ink-muted / action / danger
- `accent*` and `info` → live

V2 derives `highContrast*` by the existing generator rule (≥ 7:1 for text) and **lands no value the gate has not
measured**.

## 3. Facts this plan is bound by

- **The owner's standing rulings that this plan keeps:**
  - tab set Home · Loads · Documents · More (D-DB14);
  - no tab motion;
  - the "top five plus me" leaderboard (D-DB18).

  The tab set is IA, not visuals. Changing it belongs to the feature plan.
- **D-DB8 / D-DV13:** no routing service, so no ETA.
- **The capture flow's screens are part of the scanner programme.** V7 restyles them through tokens and primitives only. The
  quality gate, provider seam and `nativeScanOutcome` logic are not touched.
- **Every native addition bumps `runtime-version.json`** and needs a new dev client, because an OTA cannot deliver it.
- **The carrier brand skill (`.claude/skills/silvicom-brand`) was written for ads.** Its "never orange, green or mustard" rule
  conflicts with an app's safety states (Q-DV2).

## 4. Execution protocol

- **One PR per step, branched from `origin/main`.** The progress log is one file per entry in
  `docs/plans/drivers-app/visual-2026-progress/` (parallel chats work this repo).
- **Before writing UI**, read `apps/driver/DESIGN.md` (V2's version) and run the Expo `expo-design-system` and
  `expo-native-ui` skills.
- **After each screen step**, two isolated `impeccable` critiques of simulator screenshots, light and dark, plus the banned list in
  D-DV14. A banned device present is a fail.
- **The owner sees a screenshot of every screen step** before it merges. This is the 2026-09-07 lesson: four rounds were
  rejected on looks that no gate could judge.
- **Gates:** `pnpm --filter @silvicom/driver typecheck test lint lint:tokens lint:theme lint:design`, plus the root gates.

## 5. Steps

### V0 · This plan (docs only)
The plan plus `redesign-2026/DRIVER-APP-2026-ANALYSIS.md`. No screenshots in git.

### V1 · Mock before code: the owner picks the look (no app code)
An HTML phone canvas with **Today, Loads, Load detail + Stop, Documents and More**, in **dark and light**, built from §2's
values and the real data shapes (`todayModel`, `useLoads`). It shows two type options for Q-DV1 and two hero options for Q-DV3. The
owner rules on Q-DV1–Q-DV5 on this mock, and D-DV1–14 become final with any changes recorded as new decision lines.
**Done when:** the owner names the variant. Nothing in `apps/driver` changes.

### V2 · Foundation: tokens, type, contract, gates
- New `theme.roles.json` values (4 themes).
- The type roles of D-DV8, with the chosen display face loaded through `expo-font` and the platform face for text.
- Scaling per D-DV9.
- Rewrite `DESIGN.md` with Direction B's sections superseded by dated lines and not deleted.
- `check-driver-design.mjs` learns D-DV14's bans: glass outside the allowed files, emoji in JSX text, gradients.

**Done when:** every screen renders in the new colours with no layout change, all gates pass, and screenshots are taken of all 27 routes in both
themes for comparison.

### V3 · Native shell (native change, runtime bump)
- `NativeTabs` (`expo-router/unstable-native-tabs` on SDK 57) replaces `<Tabs>` + `TabBar`.
- The four triggers use SF Symbol and Material Symbol icons, the `href: null` hiding keeps the entitlement gating
  (`tab.loads`, `hazmat.capture`), and a badge on Documents shows the review count.
- Native stack headers with large titles where a screen has a title.
- Delete `TabBar.tsx`, `tabBarModel.ts` and their tests.

**Done when:** a tab switch has no animation, and the hidden routes (`/score`, `/navigate`) still resolve. Check this on an iOS 26 sim (glass) and an
Android 16 emulator (M3).

### V4 · Primitives
- `Button` (amber primary / navy-on-light secondary / text).
- `ListRow` without disc chrome: the leading glyph is platform-tinted by state only.
- `Section` (space, no rules), the signature `StatusBlock`, `@expo/ui` `BottomSheet` replacing `ChoiceSheet`/`ConfirmSheet`,
  native `Switch`, native segmented `Picker`.
- Retire `Card`'s generic use, `HeroBackdrop`'s SVG wash and `Badge` as decoration.

**Done when:** the gallery route (`app/gallery.tsx`) shows every primitive in both themes and at the largest text size.

### V5 · Today
- The current load as a `StatusBlock` (Flighty): stop name, the appointment window in display numerals, and "Appointment in 3 h 10 m".
- A "Tight" warning only by a written, tested rule (Q-DV4).
- Under it, ONE recommended next step (Uber), then the day as time blocks (Things).
- Score summary and leaderboard rows keep their data; only their look changes.

**Done when:** every state that `todayModel` produces renders correctly: off duty, no load, between stops, at stop, late,
offline.

### V6 · Loads, Load detail, Stop
- The Loads list shows the next appointment in numerals.
- Load detail shows the stops as a vertical timeline without cards.
- Stop shows a route strip (Strava): MapLibre at a fixed height with floating controls (D-DV2), the actions in the bottom third, and the Scan BOL
  action ≥ 56 pt.

### V7 · Documents and the capture screens
Documents becomes a review queue (Copilot): "the office asked for a re-shot BOL" first, then verdicts. The capture
screens are restyled through primitives only (§3).

### V8 · More, Settings, Messages, Notifications, Duty, Auth
- Messages and Notifications use Linear-style rows with swipe-to-act, where the action already exists. Settings is grouped native rows
  (`@expo/ui` List).
- Sign-in is restyled, and its auth logic is untouched.

### V9 · Glance surfaces and device gate (native change, runtime bump)
- `expo-widgets` adds an iOS **Live Activity** (current stop plus the appointment countdown), started and ended from the
  existing duty/load state.
- A lock-screen `accessoryRectangular` widget. Android gets its home-screen widget through the same library (Q-DV5).
- Then the device gate: one iPhone and one Android phone, in a cab in daylight and at night, with gloves.
- The new store screenshots are taken from the device.

## 6. Open questions (each has a recommendation; the owner rules on V1's mock)

- **Q-DV1 · Display face for figures and titles.**
  - (a) Big Shoulders Display, the carrier's ad face (brand continuity, condensed figures fit times).
  - (b) Keep Lexend for figures only.
  - (c) Platform face throughout.

  **Recommend (a)** for figures and screen titles, *if* V1 confirms it has tabular figures. Otherwise use (b).
- **Q-DV2 · Do the brand skill's colour bans apply to app status colours?**
  - (a) Status colours are functional, outside the brand rule, and used only as state.
  - (b) Strictly two colours plus white.

  **Recommend (a).** Red, green and amber are safety signals a driver needs, and ads never show state. Record it in the
  brand skill as a scoped exception.
- **Q-DV3 · Today's hero.**
  - (a) A flat navy field.
  - (b) A real photograph of the driver's own truck type from the 2026-01 fleet shoot, with the figure over it (Revolut).

  **Recommend (a) for V5**, with (b) on the mock to look at. A photo costs contrast in daylight.
- **Q-DV4 · The "Tight" rule.** What makes an appointment tight without an ETA? Candidate: the driver has not departed the previous
  stop by `appointment − (planned leg minutes)`, and the planned leg minutes come from McLeod. **Recommend:** defer to the
  feature plan, and ship V5 without "Tight" rather than with an invented rule.
- **Q-DV5 · Live Activity in this visual plan or the feature plan?** **Recommend this plan (V9)**: it shows data the
  app already has, and nothing new is fetched. On Android, use the home-screen widget now and Android 16 Live Updates later.
- **Q-DV6 · SDK 58 first?** NativeTabs is stable in 58, and V3 is a native bump anyway. **Recommend:** upgrade to SDK 58 as
  V3's first commit only if `expo-doctor` is clean on the day. Otherwise stay on 57 with `unstable-native-tabs` (the same API).

### 6.1 Rulings (owner, 2026-11-20: "proceed as recommended for open questions")

- **Q-DV1 → (a), as amended by D-DV15.** Big Shoulders Display sets screen titles and the one hero figure
  per screen. Every other figure is set in the platform face with tabular digits.
- **Q-DV2 → (a).** Red, amber and green are functional status colours and sit outside the brand's
  two-colours-plus-white rule. They are used only as state. V2 records the scoped exception in
  `.claude/skills/silvicom-brand/SKILL.md`.
- **Q-DV3 → (a).** V5 uses the flat navy hero. The carrier-photo variant stays on the V1 mock for comparison.
- **Q-DV4 → deferred to the feature plan.** V5 ships with no "Tight" warning.
- **Q-DV5 → in this plan (V9).** iOS gets a Live Activity and a lock-screen widget; Android gets a home-screen widget.
- **Q-DV6 → SDK 58 is V3's first commit, if `expo-doctor` is clean on the day.** Otherwise V3 stays on 57 with
  `unstable-native-tabs`.

- **D-DV15 · Measured, 2026-11-20: neither display face has tabular digits.** fontTools reads the font tables:
  - `BigShouldersDisplay[wght].ttf` (google/fonts) has no `tnum` feature, and its digit advances run from 316 to 618.
  - `Lexend_600SemiBold.ttf` has no `tnum` either, with digit advances from 542 to 653.

  So D-DB3's "numerals are tabular wherever two numbers can sit in a column" was never true in Lexend. The
  `tabular` prop on `AppText` asks for a feature the font does not have. SF Pro and Roboto both have `tnum`.

  The rule is therefore: **a figure that aligns with another figure (list times, scores, ranks, dates) uses the
  platform face with `fontVariant: ['tabular-nums']`. Big Shoulders is used only for a figure that stands alone (the
  hero window, a count).**

- **D-DV16 · Built as a system, not a restyle (owner, 2026-11-20: "make sure that we do this properly with system so
  later we can add things in same visual way").** Every layer may use only the layer above it:
  - **Colour** has two tiers. `PALETTE` is what a colour is, and `ROLES` is what it does, both in
    `apps/driver/scripts/gen-driver-roles.mjs`. They generate `theme.roles.json`, which generates `global.css`, and tests
    fail on any hand edit.
  - **Type** has one door: `textStyle()` in `src/theme/typography.ts`, reached through `AppText`'s `variant` and
    `weight`. Tailwind carries no font family or size.
  - **Patterns.** The V1 mock's patterns are a named table in `apps/driver/DESIGN.md`, saying which step makes each
    one a primitive.
  - **Gates.** `lint:tokens`, `lint:design` and `test` refuse every way around these layers.
- **Owner approval of the V1 mock, 2026-11-20:** "I approve this design and colors and visual pattern."

- **D-DV17 · V3 needed no native build (measured 2026-11-20).** `NativeTabs` on SDK 57 is `react-native-screens`' native
  bottom tabs, and 4.26.2 is already compiled into the installed dev client. The iOS 26.3 simulator drew Apple's Liquid
  Glass tab bar from a JavaScript-only change, so `runtime-version.json` stays at 1.2.0 and §0's "each is a runtime-version
  bump" was wrong for this step. `@expo/ui`, `expo-widgets` and `expo-glass-effect` (V4, V9) are still native additions.
- **D-DV18 · Screen titles stay in the content, in Big Shoulders.** The approved mock sets every tab title in the
  carrier's display face. A native large-title header would set it in SF Pro, so V3 does not adopt native headers on tab
  screens. Pushed screens adopt the native stack header (back chevron, title) when their own step rebuilds them
  (V6–V8), not before, so no screen is rewritten twice.
- **D-DV19 · SDK 58 is its own step, not V3's first commit (Q-DV6's fallback).** SDK 58 moves React Native 0.86 → 0.88
  and React 19.2 → 19.3, plus the native modules behind them (MapLibre, Sentry, the capture module's Kotlin and
  Swift). V3 proved nothing visual needs it. It becomes **V3b**: one PR, `expo-doctor` clean, a native-android CI run and
  a fresh dev client.

- **D-DV20 · Today (V5), 2026-11-20.**
  - **The block's figure is the time without its day period.** On a 12-hour phone "PM" set in Big Shoulders
    at 64pt was as loud as the time, so the period joins the smaller suffix ("12:48" + "PM – 2:48 PM"). The
    phone's own clock format still decides 12 or 24 hours.
  - **A closed window is amber on the navy**, through a new role `on-hero-act`. It is the only late state the
    block reports; "Tight" stays deferred (Q-DV4).
  - **"Arrived" is a real action.** It queues the stop screen's own `arrived` update through the outbox. Only
    finishing a stop opens the stop screen, because a missing photo needs D21's reason there.
  - **The duty strip retires.** Its greeting and avatar were D-DV14 devices. Its facts moved to where they
    are used: "Off duty · Unit …" in the pre-shift block, and the rig row (with Change and End shift) in
    "Rest of the day".

- **D-DV21 · Loads, Load detail and Stop (V6), 2026-11-20.**
  - **Loads is grouped by time, not status.** The four chips over a navy hero are gone; offers come first
    (somebody is waiting on them), then Now, Next, Delivered this week, Earlier. A row's trailing figure is
    the time alone, with the day in the note under it: "Sun 3:59 PM" as one figure pushed the route onto two
    lines.
  - **The Stop screen's primary follows the stop.** "Mark arrived" while it is pending, "Complete stop" once
    arrived, never both in amber. The mock's "Scan BOL" primary is not the stop's action today (BOL photos are
    rows on the same screen), so it is not drawn.
  - **Navigate hands the trip to the phone's maps app** (Apple Maps / Google Maps, by coordinates or the
    address). The app still computes no route and shows no ETA (D-DV13).
  - **The map's floating back button is solid**, D-DV2's named fallback, until `expo-glass-effect` (a native
    addition) is installed.
  - **"Stop n of m" on the Stop screen is the stop's own place in the run.** It counted finished stops, so a
    delivery opened before its pickup said "stop 1 of 2".

- **D-DV22 · Documents (V7), 2026-11-20.**
  - **Documents is a review queue of what the office still needs**, not only the hazmat hub. The missing stop
    photos are read from the loads payload Today and Loads already hold; nothing new is fetched.
  - **Only the load being driven owes photos.** Counting accepted loads too made "14 photos missing" on a
    morning with one stop left. The next open stop's photos say "Take", later stops "Later", and a finished
    stop's gap is a record with no action (Q-DV7).
  - **The Documents tab carries the same count as a badge**, from the same model, so the two cannot disagree.
    Red, as the mock draws it: the system writes the number in white, which amber could not carry.
  - **One amber action.** While photos are owed, "Capture BOL" steps down to the outline button.
  - **The verdict and capture screens are restyled through primitives only** (plan §3). The scanner, the
    quality decision and the staging are untouched.

- **D-DV23 · More, Settings, Messages, Notifications, Duty, Score, Auth (V8), 2026-11-20.**
  - **Icons are Material Symbols glyphs from the bundled font**, on both platforms. HugeIcons and its name
    map are deleted: the map drew `schedule` as an hourglass, both radio buttons alike and `pin_drop` as an
    envelope. All 112 codepoints equal Google's published list and both fonts carry every one (measured;
    `apps/driver/tests/icon-font.test.ts` reads the font's cmap). SF Symbols on iOS need `expo-symbols`,
    a native module, and wait for V3b or V9 with `@expo/ui` and `expo-glass-effect`.
  - **More is grouped rows with live values** (mock screen 8): no avatar, no cards, no discs. Duty stays on
    Today only (D-DB17); the mock's End shift and Change truck rows are not added.
  - **Score is a status block**: the week's grade as the figure, the rank beside it, the change in its colour,
    the eight-week line inside the navy.
  - **A screen whose fetch failed says so and nothing else.** Score said "No score yet" and Notifications
    "Nothing yet" under a failed request; both now show only the error and Retry.
  - **Sign-in already followed the system** (D-DB15's navy mark, display title, one amber action). Its
    remaining tinted disc on the pending and wrong-app screens becomes a bare glyph.

- **Q-DV7 · A photo for a stop that is already finished.** The mock's screen 3 offers "Add" for a seal photo
  missing from a completed pickup. The app cannot do that: `driver_complete_stop` (migration 0141) refuses
  any change to a completed stop, and a repeat of the same status returns before it inserts photos. V5 shows
  the gap honestly instead, as an amber row under "Done today" naming the missing photo, with no action.
  - (a) Leave it as a record; the office chases it.
  - (b) A server path that attaches a late photo to a finished stop (an RPC plus an outbox kind), then "Add".

  **Recommend (b), in the feature plan.** A late seal or BOL photo is exactly what the office asks drivers
  for, and today the only way to send it is outside the app.

## 7. Progress log

One file per entry in `docs/plans/drivers-app/visual-2026-progress/YYYY-MM-DD-HHMM-<step>.md`.
