# Driver App Direction B — "Night cab over a day sheet"

> Status: **§5 (B0–B7) is BUILT and merged, 2026-09-07, PRs #642–#649. The owner device gate in B7
> is OPEN and is the only thing left in §5 — see `DRIVER-APP-DIRECTION-B-AUDIT.md`.
> §6 (P0–P8 production readiness) has not started; P1 gates the first store build and P4 the first
> submission.**
>
> Owner surface: `apps/driver`
>
> Created: 2026-09-07 · Supersedes the visual world of Design System 2.0 (`DRIVER-APP-DESIGN-SYSTEM-2*.md`);
> keeps every behavioural rule of it.
>
> Visual reference: the approved canvas, page **B · Reference direction**
> https://claude.ai/code/artifact/52a5fee3-fd57-4cd8-9bbd-57b3f1449e09 — five phone artboards (Today,
> Loads, Stop, Score, greige alternate). Every value on those artboards is written down in §2 so the
> canvas is a picture of this document, not a source of truth beside it.

---

## 0. Ground truth (verified 2026-09-07 on `main` at 1d84cfd, not recalled)

- The driver app passes all four of its own gates (`lint`, `lint:tokens`, `lint:design`, `typecheck`)
  and CI runs them by name in `.github/workflows/ci.yml:85-87`. The 2026-09-07 critique
  (`.impeccable/critique/2026-09-07T16-01-03Z__apps-driver.md`, score 23/40) found the token layer
  disciplined and the composition generic. This plan replaces the visual world **and** fixes the
  composition; it does not touch API contracts, feature flags, outbox semantics, capture logic, or
  route ownership.
- `src/theme/theme.roles.json` is the single colour source: 4 themes × 33 roles, RGB triplets.
  `scripts/check-driver-theme.mjs` requires the same role NAMES in all four themes and an identical
  mirror inside the `/* theme:<name>:start|end */` markers of `global.css`. The mirror is currently
  maintained **by hand** (no generator exists; the file header says "generated" but nothing generates
  it). `src/theme/colors.ts` derives NativeWind variables and a `roleColors` object for native APIs
  from the same JSON. Root `scripts/check-token-schema.mjs` pins 14 role names shared with the web
  (`canvas`, `surface`, `surface-subtle`, `surface-muted`, `surface-inverse`, `ink`, `ink-secondary`,
  `ink-muted`, `ink-subtle`, `ink-disabled`, `ink-inverse`, `edge-subtle`, `edge`, `edge-strong`).
  **Names are pinned; values are not.** Adding roles is allowed by every gate.
- `tests/theme-colors.test.ts` is the contrast arbiter: for every theme, `ink` ≥ 7:1 and
  `ink-secondary|muted|subtle` ≥ 4.5:1 on seven content surfaces (`canvas`, `surface`,
  `surface-subtle`, `surface-muted`, `surface-raised`, `surface-selected`, `brand-subtle`); every
  status/operation/sync role and `brand` ≥ 4.5:1 as **text** on those surfaces; `brand-fg` ≥ 4.5 on
  `brand` and `brand-pressed`; `ink-inverse` ≥ 7 on `surface-inverse` and ≥ 4.5 on `danger`.
- `scripts/check-driver-design.mjs` bans: the font names Inter/Arial/Helvetica/Open Sans/Poppins,
  `font-sans`, raw `<Text`, `Alert.alert`, imports from `@/theme/ramps` or `@react-navigation/`,
  arbitrary brackets on `rounded|border|shadow|space|gap|p*|m*`, `shadow-sm..2xl` classes, `text-[`,
  and `gap|p|m-1.5|2.5`. It does **not** ban `h-[`, `min-h-[`, `w-[`, `min-w-[`, `max-w-[` (29 such
  values exist today). `scripts/check-driver-tokens.mjs` bans hex/`rgb(` and Tailwind palette
  classes outside `src/theme`, and inline `style={{ …color… }}` where `color` is lowercase and
  preceded by a non-letter (so `shadowColor` and `backgroundColor` are caught, `borderColor` too).
- Fonts load in `app/_layout.tsx:162-169` via `useFonts` from `@expo-google-fonts/hanken-grotesk`
  (0.4.3). `@expo-google-fonts/lexend` **0.4.3 exists on npm** (checked `npm view`, 2026-09-07);
  its export names follow the package convention `Lexend_400Regular`, `Lexend_500Medium`,
  `Lexend_600SemiBold`, `Lexend_700Bold`. Both families are SIL OFL 1.1.
- Typography scale is `src/theme/tokens.ts` `typography` (10 roles) mirrored as Tailwind `fontSize`
  names in `tailwind.config.js`; `AppText` maps variant → `font-*` + `text-*` classes.
- Radii: `tokens.ts` `radius = { control: 10, container: 12, operational: 16, full: 999 }` and
  Tailwind `borderRadius: { md: 8, lg: 10, xl: 12, '2xl': 16 }`. Every card is `rounded-xl`, every
  control `rounded-lg`, the operational card `rounded-2xl`.
- `Screen` (`src/components/Screen.tsx`) owns the safe area through `src/theme/safeArea.ts`
  (`screenTopPadding`, `screenBottomPadding`, both unit-tested in `tests/screen-padding.test.ts`).
  `ThemeProvider` sets `<StatusBar style={isDark ? 'light' : 'dark'} />` once for the app.
- The tab bar is a custom JS `TabBar` (`src/components/TabBar.tsx`) drawing HugeIcons; the PNGs
  under `assets/tab-icons/` and `scripts/gen-tab-icons.mjs` are referenced by nothing else (grep
  2026-09-07) — dead assets.
- Maps: `@maplibre/maplibre-react-native` 11.3.6 is installed and `src/features/nav/NavMap.tsx`
  renders it against free, no-account OpenFreeMap styles (`src/lib/env.ts`
  `DEFAULT_MAP_STYLE_LIGHT|DARK`, overridable by `EXPO_PUBLIC_MAP_STYLE_URL(_DARK)`), with
  `attribution` on. Stops carry `lat`/`lon` (`loadStopSchema`, nullable). There is **no** route or
  ETA service reachable from the app (NP1 of the navigation programme, unbuilt).
- Charts: `react-native-svg` 15.15.4 is installed; `Sparkline.tsx` uses it.
- Motion: `react-native-reanimated` 4.5.1 and `react-native-gesture-handler` 2.32 are installed;
  `GestureHandlerRootView` already wraps the app. Every animation site reads `reduceMotion` from
  `useTheme()`.
- Data the redesign draws on, all already fetched by the screens that will show it:
  - Duty: `dutyView()` → `equipmentLabel`, `startedAt`, `hasTrailer`, `session.segments[].vehicle_unit
    | trailer_unit`; `shiftDurationLabel(startedAt)` in `src/features/duty/dutyFormat.ts`;
    `readLastEquipment()` → `{ vehicleId, trailerId }`; `useEquipment()` → rosters with `unit_number`,
    `make`, `model`, `in_use_by`, `is_default`.
  - Loads: `bucketLoads()`; `loadBucket()` puts `offered` **and** `accepted` in `upcoming`; `nextStop()`,
    `stopProgress()`, `missingPhotoSlots()`, `equipmentRequiresTrailer()`; `useAcceptance().copy`
    gives `primary`/`secondary`/`reasons`/`unassignsOnDecline` per driver type; stops carry
    `address_line`, `city`, `state`, `appointment_start|end`, `arrived_at`, `notes`, `required_photos`,
    `photos`.
  - Score: `buildScoreView()` → `weekLabel`, `score`, `rankLabel`, `isWinner`, `trend`, `tiles[]`
    (with `spark`, `trend`), `coaching`, `ineligibleNote`; `homeScoreSummary()` → `scoreValue`,
    `scoreSpark`, `scoreTrend`, `rankValue`, `rankUnit`; `MeScoreResponse.weeks` (≤ 8, newest first)
    with `week_final`; `weights` has one weight per component.
  - Messages: threads with `last_message.sender_name`, `last_message_at`, `unread`, `load_ref`;
    `threadTitle()`, `messagePreview()`, `sortThreads()`.
  - Notifications: events with `category`, `severity` (`info|warning|critical`), `read_at`,
    `deep_link` → `resolveDeepLink()`.
  - Sync: `useSyncState()` → `pending`, `needsAttention`, `running`, `lastSyncAt`, `lastError`.
  - Hazmat: `useHazmatChecks()` rows with `status`, `latest_outcome`, `created_at`.
- Another session is mid-flight on the scanner programme in this same working tree (uncommitted
  changes to `app/hazmat/capture.tsx`, `src/capture/*`, `src/features/hazmat/hazmatCaptureModel.ts`
  on 2026-09-07). **This plan does not edit those files** (§4 rule 7).

---

## 1. The visual world (decisions — each is final; a change is a new decision line, dated)

- **D-DB1 · Layered structure.** A dark navy **hero** region owns the top of Today, Loads, Score and
  Stop; a light **sheet** with 28pt top corners rides over it and carries list work. Screens without
  a hero (More, Settings, check-in, end-shift, messages, notifications, hazmat, auth, load detail)
  are sheet-only. Dark appearance keeps the same layering with a deeper hero and a navy sheet.
- **D-DB2 · Colour strategy: Committed.** Navy carries the hero (30–40% of a hero screen). **Safety
  amber is the only action colour** on the hero; on the sheet the primary action is a navy pill and
  amber is the accent for time-critical state. Lavender is the soft secondary for informational
  state (offered, upcoming, messages). Green, red, orange and brown remain status-only and never
  decorate.
- **D-DB3 · One typeface.** Lexend, weights 400/500/600/700, replaces both the platform UI face and
  Hanken Grotesk everywhere. Numerals are tabular wherever two numbers can sit in a column.
- **D-DB4 · Radius scale.** 12 (inputs, small tiles), 16 (tiles, thumbnails, day chips), 24 (cards),
  28 (sheet and tab-shell top corners), pill (buttons, chips, icon discs). No other radius.
- **D-DB5 · Depth.** Cards on the sheet carry one soft offset shadow (`0 10 / blur 20 / 12%` of the
  hero navy). Hero cards carry a 1px translucent edge and no shadow. Nothing else casts a shadow.
  Class-based shadows stay banned; the one shadow is a style object from `src/theme/elevation.ts`.
- **D-DB6 · Rows.** Every list row leads with a 44pt circular icon disc tinted by the row's meaning
  (lavender = message, amber = sync/attention, green = complete, red = blocked, tile-grey = neutral).
  Chevrons are shown only on rows that open something.
- **D-DB7 · Signature moments, one per screen.** Today: the current load as a hero card with the
  appointment window in numerals. Loads: a stacked deck for offered loads with Accept/Decline on the
  card. Score: an eight-week trend line with a callout. Stop: a map hero with the stop pinned.
- **D-DB8 · Not adopted from the references.** Photos or avatars of people, the ring chart, fake
  status-bar chrome, grey captions on navy below 4.5:1, gradient buttons, a filter control with no
  filter behind it, an ETA or remaining-distance figure (no routing service exists — §7 Q-DB3).
- **D-DB9 · Everything behavioural from Design System 2.0 holds:** 4pt quantum; 44/48/56pt targets;
  status = text + icon + tone; offline is a normal state; skeletons only without cached data; no
  native alerts; no card inside a card except a captured-document preview; Dynamic Type stacks
  rather than truncates; Reduce Motion, Bold Text, high contrast honoured through `ThemeProvider`.

---

## 2. The token contract (exact values — B0 writes these verbatim)

### 2.1 Colour roles — `src/theme/theme.roles.json`

Keep all 33 existing role names (the web gate pins 14 of them). **Re-value** them and **add 16**
roles. Values are given as hex here; the file takes `"R G B"` triplets (mechanical conversion; the
generator in B0.3 prints both so a mismatch is impossible).

Hand-checked pairs for the light theme (the test re-checks all of them): `ink-subtle` on
`brand-subtle` = 4.54, `ink-subtle` on `canvas` = 4.53, `action-ink` on `canvas` = 4.92, `success`
on `surface` = 6.56, `brand-fg` on `brand-pressed` = 11.5. Dark theme: `ink-subtle` on
`surface-raised` = 4.66, `brand`(amber) on `surface` = 7.0, `brand-fg` on `brand-pressed` = 6.07.

| Role | light | dark | highContrastLight | highContrastDark | Job |
|---|---|---|---|---|---|
| canvas | `#EAF0F6` | `#0E1A2B` | `#FFFFFF` | `#000000` | the sheet |
| surface | `#FFFFFF` | `#172A42` | `#FFFFFF` | `#0A1422` | cards, rows |
| surface-subtle | `#F5F8FB` | `#12233A` | `#F5F8FB` | `#000000` | |
| surface-muted | `#F2F5F9` | `#1F3552` | `#EEF2F7` | `#14243A` | tiles inside cards, day chips |
| surface-raised | `#FFFFFF` | `#1F3552` | `#FFFFFF` | `#1A2D4A` | sheets, overlays |
| surface-selected | `#F0EEFC` | `#262B52` | `#E4E1FA` | `#2F3670` | pressed/selected rows (= accent-soft) |
| surface-inverse | `#14263F` | `#F4F7FA` | `#0B1830` | `#FFFFFF` | |
| ink | `#14263F` | `#F4F7FA` | `#000000` | `#FFFFFF` | |
| ink-secondary | `#3E4F66` | `#C9D4E2` | `#1A2638` | `#EEF2F7` | |
| ink-muted | `#55677E` | `#A8B7CA` | `#2E3E55` | `#D3DCE7` | |
| ink-subtle | `#5E6E86` | `#8FA0B6` | `#3E4F66` | `#B7C4D6` | |
| ink-disabled | `#98A6B8` | `#5B6B80` | `#55677E` | `#7A8BA2` | |
| ink-inverse | `#FFFFFF` | `#0E1A2B` | `#FFFFFF` | `#000000` | |
| edge-subtle | `#DCE4EE` | `#22364F` | `#8A9AB0` | `#55677E` | row separators |
| edge | `#C5D0DE` | `#2F4560` | `#55677E` | `#8A9AB0` | |
| edge-strong | `#8A9AB0` | `#4C6280` | `#1A2638` | `#D3DCE7` | |
| edge-focus | `#A64E08` | `#F4A340` | `#7A3A06` | `#FFCB85` | focus ring |
| brand | `#14263F` | `#F4A340` | `#0B1830` | `#FFCB85` | **sheet primary action fill + link/selected text** (light: navy; dark: amber) |
| brand-pressed | `#1F3A5C` | `#E3912E` | `#000000` | `#FFE0B3` | |
| brand-subtle | `#F0EEFC` | `#262B52` | `#E4E1FA` | `#2F3670` | |
| brand-fg | `#FFFFFF` | `#14263F` | `#FFFFFF` | `#000000` | text on brand |
| danger | `#B91C1C` | `#FC8181` | `#7F0000` | `#FFB3B3` | |
| warning | `#92400E` | `#FDBA74` | `#5C2E00` | `#FFD59A` | |
| caution | `#C2410C` | `#FB923C` | `#7A2A00` | `#FFBE8A` | |
| success | `#1C6B47` | `#6FD39B` | `#0B4A2E` | `#9AE8BD` | |
| info | `#4B44A8` | `#C3BEF5` | `#332C86` | `#DCD9FA` | = accent-ink |
| operation-current | `#A64E08` | `#F6B25E` | `#7A3A06` | `#FFCB85` | = action-ink |
| operation-next | `#4B44A8` | `#C3BEF5` | `#332C86` | `#DCD9FA` | offered / upcoming |
| operation-complete | `#1C6B47` | `#6FD39B` | `#0B4A2E` | `#9AE8BD` | |
| operation-blocked | `#B91C1C` | `#FC8181` | `#7F0000` | `#FFB3B3` | |
| sync-local | `#4B44A8` | `#C3BEF5` | `#332C86` | `#DCD9FA` | |
| sync-pending | `#92400E` | `#FDBA74` | `#5C2E00` | `#FFD59A` | |
| sync-failed | `#B91C1C` | `#FC8181` | `#7F0000` | `#FFB3B3` | |
| **hero** (new) | `#14263F` | `#0A1422` | `#0B1830` | `#000000` | hero region, tab shell |
| **hero-raised** (new) | `#1F3A5C` | `#172A42` | `#1A2D4A` | `#14243A` | cards on the hero |
| **hero-edge** (new) | `#2E4866` | `#2A3F5B` | `#3B5170` | `#55677E` | 1px edge on hero cards, hero dividers |
| **hero-tile** (new) | `#28425F` | `#213754` | `#26405E` | `#1E3048` | tiles inside hero cards |
| **on-hero** (new) | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | primary text on hero |
| **on-hero-secondary** (new) | `#B7C4D6` | `#B7C4D6` | `#D9E2EE` | `#EEF2F7` | ≥ 4.5 on hero and hero-raised |
| **on-hero-muted** (new) | `#8394AB` | `#8394AB` | `#B7C4D6` | `#D3DCE7` | ≥ 4.5 on hero only; never on hero-raised for essential copy |
| **action** (new) | `#F4A340` | `#F4A340` | `#F4A340` | `#FFCB85` | amber fill: hero primary button, amber chips |
| **action-pressed** (new) | `#E3912E` | `#E3912E` | `#D98420` | `#FFE0B3` | |
| **action-fg** (new) | `#14263F` | `#14263F` | `#000000` | `#000000` | text on action |
| **action-ink** (new) | `#A64E08` | `#F6B25E` | `#7A3A06` | `#FFCB85` | amber as text on sheet surfaces |
| **action-soft** (new) | `#FDEBD2` | `#3A2A10` | `#FDEBD2` | `#3A2A10` | amber disc / soft chip fill |
| **accent** (new) | `#CFCBF7` | `#CFCBF7` | `#CFCBF7` | `#DCD9FA` | lavender chip fill (text = ink light / action-fg) |
| **accent-ink** (new) | `#4B44A8` | `#C3BEF5` | `#332C86` | `#DCD9FA` | lavender as text |
| **accent-soft** (new) | `#F0EEFC` | `#262B52` | `#E4E1FA` | `#2F3670` | lavender disc fill |
| **success-soft** (new) | `#DDF3E8` | `#153B2B` | `#DDF3E8` | `#153B2B` | green disc / chip fill |
| **danger-soft** (new) | `#FBE3E0` | `#3E1B1B` | `#FBE3E0` | `#3E1B1B` | red disc / chip fill |

Rules bound to the table:
- Text on `action` and `accent` is always `action-fg` (light) — never white.
- Text on `*-soft` fills is the matching strong role (`success` on `success-soft`, `danger` on
  `danger-soft`, `accent-ink` on `accent-soft`, `action-ink` on `action-soft`).
- `on-hero-muted` may carry only non-essential copy (axis labels, timestamps). Anything a driver
  must read on the hero uses `on-hero` or `on-hero-secondary`.
- The contrast test gains, per theme: `on-hero` ≥ 7 on `hero` and `hero-raised`; `on-hero-secondary`
  ≥ 4.5 on `hero`, `hero-raised`, `hero-tile`; `on-hero-muted` ≥ 4.5 on `hero`; `action-fg` ≥ 4.5 on
  `action` and `action-pressed`; `action-ink` and `accent-ink` ≥ 4.5 on the seven content surfaces;
  `success` ≥ 4.5 on `success-soft`; `danger` ≥ 4.5 on `danger-soft`; `accent-ink` ≥ 4.5 on
  `accent-soft`; `action-ink` ≥ 4.5 on `action-soft`; `ink` ≥ 4.5 on `accent` (chip text).

### 2.2 `src/theme/colors.ts`

`nativeColors()` adds: `hero`, `heroRaised`, `heroEdge`, `heroTile`, `onHero`, `onHeroSecondary`,
`onHeroMuted`, `action`, `actionPressed`, `actionFg`, `actionInk`, `actionSoft`, `accent`,
`accentInk`, `accentSoft`, `successSoft`, `dangerSoft`, `canvas`. (`canvas` is needed by the map
fallback and the chart.) `tailwind.config.js` `colors` gains the same roles under the names
`hero`, `hero-raised`, `hero-edge`, `hero-tile`, `on-hero`, `on-hero-secondary`, `on-hero-muted`,
`action`, `action-pressed`, `action-fg`, `action-ink`, `action-soft`, `accent`, `accent-ink`,
`accent-soft`, `success-soft`, `danger-soft`.

### 2.3 Typography — `src/theme/tokens.ts` `typography` and `AppText` variants

All Lexend. Weight is the family name in RN (`Lexend_500Medium`), so `AppText` selects the family
from the variant; `font-medium|semibold|bold` utilities are removed from `AppText` (they do nothing
for a loaded custom face). Tailwind `fontFamily`: `ui: ['Lexend_400Regular']`,
`ui-md: ['Lexend_500Medium']`, `ui-sb: ['Lexend_600SemiBold']`, `ui-bold: ['Lexend_700Bold']`. The
`display*` families are deleted.

| Variant | Size / line | Family | Use | Replaces |
|---|---|---|---|---|
| caption | 12 / 16 | ui | timestamps, helper | caption |
| label | 12 / 16, uppercase, tracking 0.08em | ui-md | the one overline on a hero card ("NEXT · DELIVER") | new |
| supporting | 14 / 20 | ui | secondary row text | supporting |
| body | 16 / 22 | ui | prose | body |
| rowTitle | 16 / 22 | ui-md | row titles | rowTitle |
| action | 17 / 22 | ui-sb | button labels | action + `cta` |
| navigationTitle | 18 / 24 | ui-sb | contextual screen titles, sheet section headings | navigationTitle + sectionTitle |
| screenTitle | 28 / 32 | ui-sb | tab screen titles on the hero | screenTitle |
| numericInline | 22 / 28, tabular | ui-sb | appointment window, unit numbers, miles, durations, row values | **new (critique P0-3)** |
| numericCompact | 24 / 28, tabular | ui-sb | hero-card headline number | numericCompact |
| numericHero | 40 / 44, tabular | ui-sb | the weekly score | numericHero |

`sectionTitle` is **removed** as a variant; `SectionLabel` renders `navigationTitle` (see B1.7).
Tailwind `fontSize` names change to exactly the variant names above (`micro`, `cta`, `nav`,
`section-title` are deleted; `NotificationBell`/`MessagesButton` badge counts use `caption` with
`allowFontScaling={false}`, as today). Bold Text keeps its per-variant bump: every variant steps
one weight up (400→500, 500→600, 600→700).

### 2.4 Radius, spacing, targets, elevation — `src/theme/tokens.ts` and `tailwind.config.js`

```ts
export const radius = { input: 12, tile: 16, card: 24, sheet: 28, full: 999 } as const;
// tailwind.config.js  borderRadius: { md: 12, lg: 16, xl: 24, '2xl': 28, full: 9999 }
```
Existing `rounded-xl` sites therefore become 24pt cards and `rounded-lg` sites become 16pt tiles
without a rewrite; B1 then visits each site once to confirm the mapping is the intended one and
moves buttons and chips to `rounded-full`.

`layout.screenInset` becomes **20**; `layout.cardPadding` **20** for hero cards and stays **16** for
sheet cards (new key `sheetCardPadding: 16`); `layout.sectionGap` stays 24; `layout.sheetOverlap: 28`
and `layout.sheetTopPadding: 24` are added. Targets are unchanged (44 / 48 / 52 / 56).

```ts
// src/theme/elevation.ts (new; the only shadow in the app)
export function cardElevation(themeKey: ThemeKey) {
  return { shadowColor: roleColors[themeKey].hero, shadowOpacity: 0.12, shadowRadius: 20,
           shadowOffset: { width: 0, height: 10 }, elevation: 6 } as const;
}
```
`check-driver-design.mjs` keeps banning `shadow-*` classes; a new rule bans `shadowColor` outside
`src/theme/` so the helper stays the single source.

### 2.5 Motion

Unchanged durations (`motion.press` 100 … `emphasized` 260). Two new named moments, both gated on
`reduceMotion`: **deck advance** (Loads: the next offer scales from 0.96/−12pt to 1/0 in
`motion.standard` with `withSpring({damping: 24, stiffness: 320})`) and **sheet settle** (a hero
screen's sheet enters at +12pt/0.96 opacity on first mount only, `motion.fast`). No entrance
animation anywhere else.

---

## 3. Facts the design is bound by (each verified; the design bends to these, never the reverse)

1. **Remaining distance and ETA do not exist.** `total_miles` is the whole load; stops have
   coordinates but the app has no routing call. The artboards' "148 mi ahead" and "12 min · 4.8 mi"
   are therefore **not built** (D-DB8). The hero card shows `Stop N of M` and, on the load row,
   `total_miles`.
2. **Offered vs accepted is a status, not a bucket.** `loadBucket()` returns `upcoming` for both;
   the offer deck filters `status === 'offered'` itself and the Upcoming list shows `accepted` only.
3. **Photo captures are single images.** `SessionCapture` has `localUri` and `capturedAt` only; the
   artboard's "3 pages · sharp" is not available for stop photos (that metric belongs to the hazmat
   capture engine). The tile subtitle is `Captured HH:MM` or `Already added`.
4. **Coaching copy comes from `scoreModel.coachingLine()`**, verbatim. The artboard's invented
   sentence is not copy.
5. **Score weights are `data.weights`** (one per component); the breakdown row prints the weight as
   a percentage and the fixed one-line definition per component from a new `SCORE_DEFINITIONS`
   map in `scoreModel.ts` (safety: "Harsh braking, speeding, following distance"; efficiency: "MPG
   against the fleet on the same lanes"; idling: "Engine-on time with the truck stopped").
6. **Thread rows name the sender** from `last_message.sender_name`, falling back to
   `threadTitle()`; the artboard's "Maria · Dispatch" is that rule, not a label.
7. **Last-used equipment is ids only** (`readLastEquipment`), resolved against `useEquipment()`
   rosters for unit numbers and availability; a one-tap start is offered only when the vehicle
   resolves and is free (§5 B6.1). Odometer policy (`odometerMode`) still applies.
8. **The map needs network and coordinates.** MapLibre fetches OpenFreeMap tiles live; there is no
   offline basemap. The stop hero renders the map only when `useIsOnline()` is true **and** the
   stop has `lat` and `lon`; otherwise the flat hero (B4.4).
9. **The status bar is app-global today.** Hero screens need light status-bar content in the light
   theme, so `Screen` renders its own `<StatusBar>` when `hero` is present (expo-status-bar honours
   the most recently mounted one).
10. **`apps/driver` file budgets** are the repo's (500 lines, warn 450; `lint:filesize`). `home.tsx`
    (180) and `loads/[id].tsx` (309) grow in this plan and are split into feature modules in the
    steps that touch them.
11. **The web is unaffected**: `packages/tokens` is the web's source; the driver's roles file is
    separate, and the only cross-check is the 14 names in `check-token-schema.mjs`, all kept.

---

## 4. Execution protocol — read this before executing anything, every session

**Resume ritual:**

1. Read this document top to bottom, then `apps/driver/DESIGN.md`, then root `CLAUDE.md`. Do not
   read `DRIVER-APP-DESIGN-SYSTEM-2*.md` for visual decisions — they are superseded; their
   behavioural rules are restated in D-DB9.
2. Establish reality: `git log --oneline -15`, `git status --short apps/driver` (another session
   may hold uncommitted scanner work — rule 7).
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §7; a missing answer
   means *run the fallback written next to it*.
4. One step per branch (`claude/driver-b<N>-<topic>`) from `origin/main`, PR to `main`, merge
   commit after CI green. `main` is branch-protected (required check `build`).
5. When a step ships, append a dated line to §7 (never edit table rows in place — parallel PRs
   conflict on rows) and mark the step heading **— DONE <date> (PR #N)**.
6. Gates before every PR, from the repo root: `pnpm --filter @silvicom/shared build:rn`, then
   `pnpm --filter @silvicom/driver typecheck lint lint:tokens lint:design test`, then root
   `pnpm lint:boundaries`, `pnpm lint:token-schema`, `pnpm lint:filesize`, `pnpm lint:funcsize`,
   `pnpm lint:tests` and `pnpm lint:comment-claims`. Then `git diff --check`.
   **`lint:boundaries` was missing from this list until 2026-09-07 and B2 shipped nine violations
   into CI because of it** — every new module under `src/features/<name>` is subject to it, and a
   screen that composes several features is exactly the shape that trips it. When a step adds a
   root-level directory or a cross-feature import, run the whole `gates` job's list from
   `.github/workflows/ci.yml` rather than this subset.
7. **Files this plan never edits** while the scanner programme is open (`SCANNER-UPGRADE-PLAN.md`):
   `app/hazmat/capture.tsx`, `src/capture/*`, `src/features/hazmat/hazmatCaptureModel.ts`,
   `src/features/hazmat/useHazmatChecks.ts`, `tests/hazmat-capture-model.test.ts`,
   `tests/native-scan-outcome.test.ts`, `packages/capture-engine/*`. The hazmat **hub** and
   **verdict** screens (`app/hazmat/index.tsx`, `app/hazmat/[loadId].tsx`) are restyled in B6 with
   primitives only; their data hooks are untouched.
8. **No new fake data.** Every string on a screen is from a contract field, a shared label map, or
   copy written in this plan. Gallery examples are the only place sample values live.
9. Every new pure rule gets a test in `apps/driver/tests/` (the vitest `include` is `tests/**`;
   `lint:tests` fails a test file anywhere else). Prove each test can fail by mutating the rule once
   before committing (`prove-tests-fail-by-mutating`).
10. Every PR of B1–B6 adds or updates a gallery section (`app/gallery.tsx`) showing the changed
    primitive in light and dark; that is the design-review surface until the device gate (B7).

---

## 5. Steps — each stands alone; execute in order

### B0 · Foundation: roles, type, radius, elevation, gates — DONE 2026-09-07

**Branch:** `claude/driver-b0-foundation`. Touches only `src/theme/*`, `global.css`,
`tailwind.config.js`, `app/_layout.tsx`, `package.json`, `scripts/*`, `tests/*`, `DESIGN.md`.
No screen changes; the app must look *different* after B0 (new colours, one face, bigger radii)
without any screen being broken.

- **B0.1 Fonts.** `pnpm --filter @silvicom/driver add @expo-google-fonts/lexend@0.4.3` and
  `remove @expo-google-fonts/hanken-grotesk`. `app/_layout.tsx` loads
  `Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, Lexend_700Bold`. `tailwind.config.js`
  `fontFamily` per §2.3. `check-driver-design.mjs` font rule becomes
  `/\b(?:Inter|Arial|Helvetica|Open Sans|Poppins|Hanken|HankenGrotesk)\b/` with message
  "Lexend through AppText only".
- **B0.2 Roles.** Write §2.1 into `theme.roles.json` (all four themes, 49 roles). Extend
  `colors.ts` per §2.2 and `tailwind.config.js` `colors`.
- **B0.3 Mirror generator.** New `scripts/gen-driver-theme-css.mjs`: reads the roles JSON and
  rewrites the four marker blocks in `global.css` in place (`:root` for light, `.dark` for dark,
  `.high-contrast-light` / `.high-contrast-dark` for the high-contrast themes — the selectors
  already in the file). Wire `"gen:theme": "node scripts/gen-driver-theme-css.mjs"` in `package.json`; run it;
  `lint:theme` must pass unchanged (it is the verifier, the generator is convenience).
- **B0.4 Type.** `tokens.ts` `typography` and `AppText` per §2.3. Delete `font-display*` families
  and the `micro`, `cta`, `nav`, `section-title` sizes. **Keep the `sectionTitle` variant through B0**
  (13 / 18, `ui-sb`) because eleven screens still use it; B1.7 migrates them and B7 deletes the variant
  with a gate rule. Grep `apps/driver` for each deleted class
  and replace at the call site with the variant that owns it (the list is short: `Button.tsx` `cta`
  and `nav`, `NotificationBell.tsx` / `MessagesButton.tsx` `micro`, `SectionLabel.tsx`,
  `classes.ts` `sectionLabel`).
- **B0.5 Radius, layout, elevation.** `tokens.ts` `radius` and `layout` per §2.4; Tailwind
  `borderRadius`; new `src/theme/elevation.ts`. `check-driver-design.mjs` gains
  `{ pattern: /\bshadowColor\b/, message: 'shadows come from src/theme/elevation.ts only' }`
  scoped to files outside `src/theme/`.
- **B0.6 Tests.** Extend `tests/theme-colors.test.ts` with the §2.1 pairs. Add
  `tests/theme-css-mirror.test.ts`: running the generator against the committed `global.css`
  produces no diff. Delete `tests/ramp-parity.test.ts` and `src/theme/ramps.ts` (ramps mirror web
  brand values no longer shared; `check-driver-design.mjs` already bans importing them; the
  `lint:token-schema` gate does not read ramps).
- **B0.7 DESIGN.md.** Replace the "Product character", "Token contract" and "Typography" sections
  with §1 and §2 of this document (copy the tables; do not link out). Leave the behavioural sections
  as they are.
- **Done when:** all §4.6 gates green; the gallery screen opens in light, dark and high contrast
  with Lexend rendering (`Lexend_600SemiBold` visible in the typography section); `pnpm
  lint:token-schema` green at the root.

### B1 · Shell and primitives — DONE 2026-09-07

**Branch:** `claude/driver-b1-shell`. Touches `src/components/*`, `src/theme/classes.ts`,
`app/gallery.tsx`. Screens keep working because primitives keep their props; new props are
additive.

- **B1.1 `Screen`** gains `hero?: ReactNode`. With `hero`: the root view is `bg-hero`; renders
  `<StatusBar style="light" />`; the hero block gets `paddingTop = insets.top + 8`,
  `paddingHorizontal = layout.screenInset`, `paddingBottom = layout.sheetOverlap + 20`; the scroll
  content wrapper is `bg-canvas rounded-t-2xl` with `marginTop: -layout.sheetOverlap`,
  `paddingTop: layout.sheetTopPadding`, `paddingHorizontal: layout.screenInset`. The hero scrolls
  with the content (one `ScrollView`; the sheet is not a separate gesture surface). Without `hero`:
  unchanged behaviour, insets from `safeArea.ts`. **Every** `Screen` renders its own
  `<StatusBar style={hero ? 'light' : isDark ? 'light' : 'dark'} />` so a tab switch between a hero
  screen and a sheet-only screen restores the right style; `ThemeProvider` drops its global one.
  **Wide displays:** when `useWindowDimensions().width >= 600` (Android 16 ignores the portrait lock
  on displays this wide for apps targeting API 36, §6 P1), the hero and sheet content are centred in a
  560pt column; nothing stretches. `tests/screen-padding.test.ts` gains the hero
  case (`screenTopPadding(inset, false)` is reused for the hero's top).
- **B1.2 `TabBar`**: `bg-hero rounded-t-2xl`, `paddingTop: 8`, `paddingBottom: max(insets.bottom,
  8)`, items `min-h-[52px]` → `min-h-13` (52 = 13×4; add `13: '52px'` to Tailwind `spacing` so the
  bracket disappears), icon 22 `text-on-hero-muted`, label `caption` `on-hero-muted`; selected:
  `text-on-hero`, label `ui-md`, and a 6pt `bg-action` dot 2pt below the label (`accessibilityState
  selected` unchanged). Icon map: `loads: 'local_shipping'` (replaces the bar-chart `analytics`).
- **B1.3 `Card`** variants: `sheet` (default: `bg-surface rounded-xl` + `cardElevation`, padding
  `sheetCardPadding`), `hero` (`bg-hero-raised border border-hero-edge rounded-xl`, padding
  `cardPadding`, no shadow), `flat` (`bg-surface rounded-xl`, no shadow — for grouped lists). The
  old `grouped`/`operational` names are removed; every call site is updated in this PR (7 sites:
  DutyCard, LoadCard, CurrentLoadCard, stop reason card, settings appearance block, score hero, gallery).
- **B1.4 `Button`**: pill (`rounded-full`), sizes `sm` 44 / `md` 48 / `lg` 56, label `action`.
  Variants: `primary` (`bg-brand text-brand-fg`), `hero` (`bg-action text-action-fg`, pressed
  `action-pressed`), `secondary` (`bg-surface text-ink` + `cardElevation` on the sheet; on a hero
  pass `onHero` to get `bg-hero-tile text-on-hero`), `ghost` (text-only, `text-ink-secondary`, or
  `text-on-hero-secondary` with `onHero`), `danger` (`bg-danger text-ink-inverse`). `soft` is
  removed (2 call sites → `secondary`). Press feedback stays the reanimated scale 0.97.
- **B1.5 `Badge` → chip anatomy**: height 28 (`sm`) or 32 (`md`), `rounded-full`, `px-3`, label
  `caption` in `ui-md`, optional leading icon 14. Tones: `neutral` (`bg-surface-muted text-ink-secondary`),
  `brand` (`bg-accent text-ink`), `action` (`bg-action text-action-fg`), `info` (`bg-accent-soft
  text-accent-ink`), `success` (`bg-success-soft text-success`), `danger` (`bg-danger-soft
  text-danger`), `warning` (`bg-warning/12 text-warning`), `caution` (`bg-caution/12 text-caution`),
  `ghost` (`bg-on-hero/10 text-on-hero`, hero only). The `dot` prop is removed (2 sites).
  `self-start` is removed from the root (critique defect 1); the chip centres in whatever row holds it.
- **B1.6 `ListRow`** gains `disc?: Tone` which renders the 44pt icon disc (`rounded-full`, fill =
  the tone's soft role, icon = the tone's strong role, icon size 20). Row: `min-h-13`, `px-4 py-3`,
  `gap-3.5` → use `gap-3` (12). Separator inset becomes `ml-[72px]` → add `18: '72px'` to spacing
  so it is `ml-18`. `right` content is vertically centred by the row (no `self-start` anywhere).
- **B1.7 `SectionLabel`** renders `navigationTitle` in `text-ink`, with optional `action?: {label,
  onPress}` rendered right-aligned as `supporting` `ui-md` `text-action-ink` (44pt target). Spacing
  is owned by the section wrapper: `paddingTop: layout.sectionGap`, `paddingBottom: 12`; the
  `mt-2 -mb-2` trick is deleted and `ui.scrollContent` becomes `gap-0` so rhythm is explicit per
  section. A new `Section` layout component (`src/components/Section.tsx`) wraps label + children
  and is what screens use; it takes `first` to drop the top gap for the first section on a sheet.
- **B1.8 `SegmentedControl`** gains `variant="chips"`: a horizontal `ScrollView` of `Badge`-sized
  pills (`action` tone selected, `ghost` on hero / `neutral` on sheet unselected), `role="radio"`
  preserved, count suffix rendered inside the chip. The sliding-thumb variant remains for Settings.
- **B1.9 `IconButton`** variants `plain` (unchanged), `white` (`bg-surface` + elevation, sheet),
  `glass` (`bg-on-hero/10 text-on-hero`, hero). Always `rounded-full`, 44pt.
- **B1.10 `Avatar`**: `bg-action text-action-fg`, no border, initials in `ui-sb` at 0.38 × size.
- **B1.11 `Banner`, `OfflineBanner`, `NeedsAttentionNote`, `Toast`, `Progress`, `Skeleton`,
  `EmptyState`, `Field/Input/NumericField`, `ToggleRow`, `ConfirmSheet`**: radius and colour roles
  only (`rounded-lg` → 16 tiles for banners and inputs; inputs `bg-surface-muted` with `edge-focus`
  ring; `ConfirmSheet` `rounded-t-2xl`; `Skeleton` `bg-surface-muted`). `Sparkline` stroke becomes
  `action`, `preserveAspectRatio` removed and `viewBox` width bound to the measured layout width
  (critique defect 16).
- **B1.12 `ToastHost`** (new): `Toast` today is a bare inline component with no way to show it,
  which is why no screen uses it. Add `src/components/ToastHost.tsx` exporting `ToastProvider` and
  `useToast().show(message, tone = 'success')`; the provider mounts one `<Toast>` at the bottom of
  the shell, 8pt above the tab bar (or the home indicator on modal routes), for 2400 ms
  (`motion.deliberate × 10`), replacing any toast already showing. `app/_layout.tsx` wraps
  `RootNavigator` in `ToastProvider` inside `ThemeProvider`.
- **B1.14 Large text.** At `layout.largeTextBreakpoint` (1.35): the hero card's two tiles stack;
  paired buttons stack (Accept over Decline; primary over icon button); the up-next day tile moves
  above the title; chart axis labels are SVG text at a fixed 11pt (decorative: the value lives in the
  accessible label and the `AppText` callout); the tab bar grows with its labels. No component caps
  `allowFontScaling` except the two count badges that already do.
- **B1.13 Gallery**: sections for hero card, sheet card, chips (all tones, light/dark), rows with
  discs, buttons (all variants on sheet and on a hero swatch), tab bar, segmented chips, section
  with action.
- **Done when:** gates green; every existing screen renders (manual run through all routes on the
  simulator, light and dark); the gallery shows each B1 primitive; no `self-start` on `Badge`.

### B2 · Today — DONE 2026-09-07

**Branch:** `claude/driver-b2-today`. Splits `app/(tabs)/home.tsx` into
`src/features/today/{todayModel.ts, TodayHero.tsx, AttentionQueue.tsx, UpNext.tsx, WeekStrip.tsx}`;
`home.tsx` becomes composition only (< 150 lines).

- **B2.1 State switch (`todayModel.ts`, pure, tested).** Input: `dutyView`, `bucketLoads` result,
  `useSyncState`, `driver.isError`. Output `state`: `preShift` (not on duty), `activeLoad` (on duty
  and `current[0]` exists), `betweenLoads` (on duty, no current), `recovery` (`shift.isError &&
  !shift.data` **or** `driver.isError && !driver.data`). Module order per state:
  - `preShift`: DutyStrip(off) · StartDayHero (B6.1's one-tap card, or the existing "Confirm
    equipment" card when no last-used unit resolves) · Section "Your day" (UpNext with up to 2
    rows: offered first, then accepted, soonest first) · Section "Before you roll" (AttentionQueue)
    · WeekStrip.
  - `activeLoad`: DutyStrip(on) · CurrentLoadHero · Section "Needs your attention"
    (AttentionQueue) · Section "Up next" (UpNext, 1 row) · WeekStrip.
  - `betweenLoads`: DutyStrip(on, with Change) · Section "Up next" (UpNext, up to 2 rows, or the
    inline EmptyState "Nothing assigned yet — released loads from dispatch will appear here") ·
    AttentionQueue · WeekStrip.
  - `recovery`: DutyStrip (cached or "Duty unknown") · Banner danger with Retry (existing copy) ·
    CurrentLoadHero **from cache if present** · AttentionQueue; UpNext and WeekStrip collapse.
- **B2.2 Hero region** = DutyStrip + (CurrentLoadHero | StartDayHero). DutyStrip: 44pt `Avatar`
  (initials from `full_name`), `navigationTitle` `on-hero` "On duty <shiftDurationLabel>" or "Off
  duty", `supporting` `on-hero-secondary` "<weekday, Mon D> · <equipmentLabel>" (or just the date
  off duty), then `MessagesButton` and `NotificationBell` as `glass` icon buttons with the existing
  count badges (badge fill `bg-action text-action-fg`). Settings moves off the avatar into More
  (already there); the avatar is not a target.
- **B2.3 CurrentLoadHero** (`Card variant="hero"`): row 1 `Badge action` "In transit" +
  `caption on-hero-muted` ref + right `caption on-hero-secondary` "Stop N of M"; block 2 `label`
  "NEXT · DELIVER|PICK UP", `screenTitle` (24/30 override is **not** allowed — use
  `navigationTitle` at 22? No: use `numericCompact`'s size class is wrong for text; **decision:**
  the stop name uses `screenTitle` reduced by Dynamic Type only, never a manual size) — stop name
  in `screenTitle` `on-hero`, then `supporting on-hero-secondary` "<city, ST> · <address_line>";
  grid 2 × `hero-tile` tiles (radius 16, padding 12): "Appointment" → `numericInline` window
  (`appointmentLabel` without the "Appt " prefix; `numericInline` for the start, `supporting
  on-hero-secondary` for "–end"), below it `caption` "Opens in <h> h <m> min" (`success` tone
  variant `on-hero`-safe = `#7FD9A9` is **not** a role → use `on-hero-secondary` for the countdown
  text and prefix a 14pt `clock` icon in `action`); "Required here" → `numericInline` count +
  `supporting` "photos", `caption on-hero-secondary` slot labels via `photoSlotLabel`; the stop
  rail: three or more dots per stop (`success` complete, `action` current with a 4pt `action/25`
  halo, `hero-edge` upcoming) joined by 3pt lines, captions under each with city and
  `stopTime(appointment_start)`; primary `Button variant="hero" size="lg"` "<Deliver|Pick up> at
  <stop.name>" → `router.push('/loads/<id>/stop/<nextStop.id>')` (**not** load detail); a 56pt
  `secondary onHero` icon button (`doc`) → load detail. Countdown rule: `appointment_start − now`
  in whole minutes; ≥ 60 → "Opens in h h m min", 1–59 → "Opens in m min", ≤ 0 and before
  `appointment_end` → "Window open now", after `appointment_end` → "Window closed" in `warning`
  tone; recomputed every 60 s while the screen is focused.
- **B2.4 AttentionQueue (`todayModel.ts` `attentionRows()`, pure, tested).** Sources, in priority
  order, capped at 4 rows, each `{ tone, icon, title, subtitle, time?, onPress }`:
  1. `needsAttention > 0` → danger disc `sync_problem`, "<n> items couldn't sync", "Your work is
     safe · tap to retry", `/settings`.
  2. Trailer gap on the current load (`equipmentRequiresTrailer(load.equipment) && duty.onDuty &&
     !duty.hasTrailer`) → caution disc `route`, "<equipment> needs a trailer", "Add the one you're
     pulling before <next stop kind>", `/duty/check-in?mode=swap`.
  3. Unread notifications with `severity !== 'info'`, newest first, max 2 → danger disc for
     `critical`, caution for `warning`, icon from the existing `CATEGORY_ICON` map (moved to
     `src/features/notifications/categoryIcon.ts` so both screens import it), title `n.title`,
     subtitle `n.body`, time `timeLabel(created_at)`, `resolveDeepLink(deep_link)`; marks read on
     open via `useMarkRead`.
  4. Unread message threads, newest first, max 2 → info disc `mail`, title
     `last_message.sender_name ?? threadTitle(thread)`, subtitle `messagePreview(last_message)`
     (quoted), time `timeLabel(last_message_at)`, `/messages/<id>`.
  5. `pending > 0` → action disc `sync`, "<n> items waiting to sync", "Saved on this phone · sends
     when you have signal", no chevron, no press.
  6. Hazmat rows (when `hazmat.capture`) with `latest_outcome ∈ {rejected, needs_review}` created in
     the last 7 days, newest first, max 1 → danger disc (`rejected`) or caution (`needs_review`)
     `local_fire_department`, "BOL check <rejected|in review>", `rowDate(created_at)`,
     `/hazmat/<id>`.
  When more than 4 qualify, row 4 becomes "<n> more" → `/notifications`. When none qualify the
  section is not rendered.
- **B2.5 UpNext row:** left 52pt `surface-muted` tile (radius 16) with `caption ui-md` weekday
  (`TODAY`/`TOMORROW`/`WED`) and `numericInline` `HH:MM` of the first stop's `appointment_start`
  (or "—"); title `rowTitle` "<origin city> → <destination city, ST>"; subtitle `supporting muted`
  "<ref> · <total_miles> mi · <equipment>" plus " · Hazmat" when `hazmat`; right: `Badge info`
  "Offered" for `offered`, chevron for `accepted`; press → load detail.
- **B2.6 WeekStrip:** `Card variant="flat"` `bg-surface-muted`: "Driver score" `caption muted` +
  `numericCompact` value + `caption success|warning` trend label; `Sparkline` of `scoreSpark` (when
  ≥ 2 points) filling the middle; "Fleet rank" + `numericCompact` "#n" + `caption` "of N". When
  `isWinner`, the strip's disc shows `military_tech` in `action` and the label reads "Top score in
  your fleet". Hidden when `tab.score` is off or `homeScoreSummary` is null.
- **B2.7 Skeletons** match the modules they replace: DutyStrip 56, hero card 332, attention row
  64, up-next row 72, week strip 84 — constants in `todayModel.ts` `SKELETON_HEIGHTS`, and the gallery
  renders each module beside its skeleton so a drift is visible at review.
- **Tests:** `tests/today-model.test.ts` — state selection for all four states; attention ordering,
  caps, the "+n more" row, empty → no section; countdown copy at 130 min, 45 min, −5 min, after end;
  offered-before-accepted ordering in UpNext.
- **Done when:** gates green; the four states are reachable on the simulator by toggling the mocked
  queries in the gallery's "Today states" section (added here); at default text size on a 390×844
  simulator the active-load state shows the duty strip, the hero card with its primary action, and
  the first attention row without scrolling (screenshot attached to the PR).

### B3 · Loads — DONE 2026-09-07

**Branch:** `claude/driver-b3-loads`. Splits `app/(tabs)/loads.tsx` into
`src/features/loads/{OfferDeck.tsx, offerDeckModel.ts}` and restyles `LoadCard.tsx`.

- **B3.1 Hero:** `screenTitle` "Loads", `supporting on-hero-secondary` "<c> in progress · <o>
  offered · <u> upcoming" (zero terms omitted; all zero → "No loads yet"); no filter button
  (D-DB8). Chips (`SegmentedControl variant="chips"`) in the hero: Offered (count) · Current ·
  Upcoming · History; default = Offered when `o > 0`, else Current when `c > 0`, else Upcoming.
- **B3.2 OfferDeck** (hero, shown when the Offered chip is active and `o > 0`): the front card is
  `Card variant="sheet"` (white on navy) with: `Badge info` "Offered <stopTime(created_at)>" +
  right `caption muted` ref; `navigationTitle` "<origin city, ST> → <destination city, ST>";
  `supporting` "<weekday HH:MM> pickup · <total_miles> mi · <equipment> · <stops> stops"; chips row:
  `Badge danger` "Hazmat" when `hazmat` (plus " · BOL check" when `hazmat.capture` is on — tap opens
  `/hazmat`); buttons: `Button primary` `copy.primary` (accept) + `Button secondary` `copy.secondary`
  (opens the existing decline reason list as a `ConfirmSheet`-style bottom sheet: **new**
  `ChoiceSheet` primitive = `ConfirmSheet` body with a `GroupedList` of `ListRow`s; lands in B3 with
  a gallery example). Two backer plates behind (`bg-surface/65` and `/35`, offset 14/28pt, no
  content) render only when `o ≥ 2` / `≥ 3`. Backers carry `accessibilityElementsHidden` and
  `importantForAccessibility="no-hide-descendants"`. A dots indicator below (`action` for current). After
  accept or decline the model re-derives from the cache; the next card animates in (§2.5 deck
  advance). `offerDeckModel.ts` orders offers by first `appointment_start` ascending and exposes
  `backers(count)`.
- **B3.3 Lists on the sheet:** Current → `CurrentLoadRow` (disc `action` `local_shipping`, title
  "<origin> → <destination>", subtitle "<ref> · Stop n of m · <Deliver|Pick up> at <next stop
  name> by <appointment_end HH:MM>"); Upcoming (accepted only) → `UpNext` rows from B2.5; History →
  rows with `success` disc `check_circle` (delivered) or `neutral` `cancel` (canceled), subtitle
  "<ref> · <completed_at date> · <total_miles> mi". Empty copy per bucket is the existing `EMPTY`
  map. The old `LoadCard` with the vertical rail is deleted; `RouteRail` moves to B4's timeline.
- **B3.4 Load detail entry** unchanged (`/loads/<id>`).
- **Tests:** `tests/offer-deck-model.test.ts` — ordering, backers count, chip default rule, header
  count sentence with zero terms omitted.
- **Done when:** gates green; a driver type of `owner_operator` shows Accept/Decline and a company
  driver shows "I'm ready"/"Can't take this" on the deck (gallery has both); decline still requires
  a reason and still calls `useDeclineLoad` with it.

### B4 · Load detail and Stop — DONE 2026-09-07

**Branch:** `claude/driver-b4-detail-stop`. Splits `app/loads/[id].tsx` into
`src/features/loads/{Itinerary.tsx, itineraryModel.ts}`; `app/loads/[id]/stop/[stopId].tsx` into
`src/features/loads/{StopHero.tsx, PhotoGrid.tsx}`.

- **B4.1 Load detail (sheet-only):** `ScreenHeader` back + `navigationTitle` ref + `supporting`
  "<equipment> · <total_miles> mi · Unit <vehicle_unit>" + right `Badge action` "In transit" /
  `info` "Offered" / `neutral` "Accepted" / `success` "Delivered"; progress row: `numericInline`
  "n" + `supporting muted` "/m stops" + 4pt `Progress` bar (`action`); `TaskStepper` and the
  caption below it are **deleted** (critique defect 21). The attention `Banner` logic is unchanged.
- **B4.2 Itinerary** (`Card variant="flat"`): one vertical timeline; per stop a 28pt node (complete:
  `success` fill + check; next: `brand` fill + seq number in `brand-fg`; pending: `edge` ring +
  seq in `ink-muted`; skipped: `warning` ring + `warning` icon), a 2pt connector (`success` above a
  completed stop, `edge` otherwise); content: `rowTitle` name + right `caption` state label in the
  state's tone; `supporting muted` "<address_line ?? city, ST> · <Pick up|Deliver>"; for the
  **next** stop only: `numericInline` window + the B2.3 countdown, background `surface-selected`
  across the full row width, and a chevron; for every stop with `required_photos`: `caption` with a
  14pt camera icon "<have> of <n> photos · <slot labels>" in `success` when complete else
  `ink-secondary`; for the next stop with `notes`: `caption` with a 14pt `info` icon and the note
  text. Tap target = the next stop only, → stop screen. Completed and skipped stops are not
  pressable (as today).
- **B4.3 Load section** (`Card variant="flat"`): a 3-column grid `caption muted` label over
  `supporting ui-md` value: Commodity (`commodity ?? '—'`), Trailer (`trailer_unit ?? '—'`), Stops
  (`stops.length`); then a separator and the `notes` row when `notes` (disc `neutral` `info`).
  Decline reasons move to the B3.2 `ChoiceSheet`. Footer unchanged in behaviour; the primary label
  becomes "<Deliver|Pick up> · <next.name>".
- **B4.4 StopHero:** when online and the stop has `lat`+`lon`: `Map` from
  `@maplibre/maplibre-react-native` at 360pt height, `mapStyle={mapStyleUrl(isDark)}`, `Camera`
  centred on the stop at zoom 13, `logo={false}`, `compass={false}`, `attribution` **on** (licence),
  a `Marker` at the stop drawing an 18pt `action` disc with a 3pt `surface` ring and a 6pt
  `action/25` halo; the map is `pointerEvents="none"` (a picture, not a navigator — D-DB8).
  Otherwise: a 200pt `bg-hero` block with a 40pt `pin_drop` icon in `action` and the address in
  `on-hero-secondary`. Over either: a floating header row — `IconButton white` back, a white pill
  (`Card sheet`, `rounded-full`, padding 8/14) with `supporting ui-md` stop name and `caption muted`
  "Stop n of m · <Deliver|Pick up> · <ref>", and, when `arrived_at`, a `Badge success` "Arrived
  HH:MM" at the right; **no call button** (no phone number in the contract).
- **B4.5 Sheet:** first a `Card flat` row with disc `success|warning` `clock` and the window verdict
  (`rowTitle` "Inside the window" / "Window opens in …" / "Past the window", `supporting muted`
  "Appt HH:MM–HH:MM · <arrived|now> <n> min early|late" computed from `arrived_at ?? now`); then
  `Section` "Photos for this stop" with right `caption` "<have> of <n>"; `PhotoGrid`: 2 columns of
  `Card sheet` tiles (radius 24, the thumbnail area 120pt with `Image` `localUri` when captured
  this session, `surface-muted` with a 30pt camera icon and `action` "Capture" label when not; a
  `Badge success` "Saved" over a captured image; footer `rowTitle` slot label + `caption`
  "Captured HH:MM" / "Already added" / `action-ink` "Required"); the uncaptured tile has a 2pt
  dashed `action` border and `action-soft` fill (the one allowed card-in-card: a document
  preview). Tap on a tile = `takePhoto(slot)` (existing). Then `Section` "At this stop": the stop
  `notes` row and, when a thread exists with `load_ref === load.ref`, its `last_message` as a row
  (disc `info` `mail`, "<sender_name>, HH:MM", the message text) → `/messages/<id>`.
- **B4.6 Footer:** `Button primary size="lg"` "Complete stop" when `outstandingSlots` is empty;
  otherwise the same button `disabled` with label "Complete stop · <n> photo(s) missing" and below
  it two text actions: `Button ghost` "Complete anyway" (opens the existing reason flow) and
  `Button ghost` "Skip stop"; "Mark arrived" stays as a `secondary` button **above** the primary
  only while `status === 'pending'`. The "Saved on this phone first · syncs when you have signal"
  caption stays, once, with a 14pt `cloud` icon.
- **B4.7 Completion receipt:** after `submit()` resolves, `useToast().show("<stop name> <completed|skipped|arrived> · <n>
  photos queued")` (B1.12) and then `router.back()`; the toast outlives the screen because the host
  lives in the root layout.
- **Tests:** `tests/itinerary-model.test.ts` — node states, connector colours, next-stop detection
  with skipped stops, window verdict copy (early / inside / late / closed) with `arrived_at` null and
  set; photo tile state derivation from `satisfiedSlots` + session captures.
- **Done when:** gates green; the stop screen renders the map on the simulator with network and the
  flat hero in airplane mode (both screenshots in the PR); completing a stop still enqueues the same
  outbox record shape (`stop-capture-model.test.ts` unchanged and green).

### B5 · Score — DONE 2026-09-07

**Branch:** `claude/driver-b5-score`. New `src/components/TrendChart.tsx` +
`src/features/score/trendChartModel.ts`.

- **B5.1 Hero:** `screenTitle` "Score", `supporting on-hero-secondary` `weekLabel`; then
  `numericHero` `on-hero` score with `caption on-hero-muted` "Weekly score" above; beside it a
  `Badge action` with `trending_up|down` "<trend.label> vs last week" (hidden when no trend) and
  `caption on-hero-secondary` `rankLabel` + " in your fleet". Ineligible weeks: the hero shows
  `ineligibleNote` in a `Banner info` on the hero (`bg-hero-tile text-on-hero`) instead of the
  number.
- **B5.2 TrendChart** (`react-native-svg`, width = measured layout, height 150): input = `weeks`
  ascending with non-null `week_final` (≥ 2 points required; else the chart is replaced by
  `caption on-hero-muted` "Your trend appears after two ranked weeks"). Domain: `[max(0,
  floor((min−5)/10)×10), 100]`; gridlines every 10 from the domain floor, `on-hero/10`, axis labels
  `caption on-hero-muted` at the left; a Catmull-Rom smoothed path in `action` 2.5pt; an area fill
  from `action` at 28% to 0% (linear gradient, vertical); a dashed 1pt `on-hero/35` drop line at the
  last point; the last point a 5pt `hero` disc with 2.5pt `action` ring; a callout `Card sheet`
  (padding 6/10, radius 12) above-left of the last point with `supporting ui-sb` value and
  `caption muted` "This week". `trendChartModel.ts` exports `domain()`, `points(width, height)`,
  `smoothPath()`, `calloutAnchor()`; `accessibilityLabel` on the SVG = "Weekly score, <first> to
  <last> over <n> weeks".
- **B5.3 Sheet:** `Section` "What made the score": `Card flat` with three `ListRow`s (disc
  `success` `shield` / `info` `local_gas_station` / `action` `schedule`), title, subtitle
  "<definition> · <weight %>", right column `numericInline` value + `caption` trend in
  `success|warning`; sparklines are dropped from rows (the trend line carries the history). Then a
  `Card` with `bg-hero text-on-hero` (the one hero-coloured card on a sheet, radius 24): disc
  `action` `bolt`, `rowTitle on-hero` "Next opportunity", `supporting on-hero-secondary` = `coaching`.
  Hidden when `coaching` is null.
- **Tests:** `tests/trend-chart-model.test.ts` — domain rule at min 87/72/40, point mapping at
  width 350, path has one `M` and `n−1` `C` segments, callout anchor clamps inside the width;
  `score-model.test.ts` gains `SCORE_DEFINITIONS` and the weight-percent formatting.
- **Done when:** gates green; the gallery shows the chart with 2, 5 and 8 weeks and the
  "two ranked weeks" fallback.

### B6 · Duty, More, Settings, Messages, Notifications, Hazmat hub and verdict — DONE 2026-09-07

**Branch:** `claude/driver-b6-rest`. Restyle with primitives; three behaviour changes, listed.

- **B6.1 Start-day one-tap (behaviour).** `src/features/duty/startShortcutModel.ts`: given
  `readLastEquipment()`, `useEquipment().data`, `odometerMode`, return `{ vehicle, trailer } | null`
  where vehicle = the roster entry with `id === lastUsed.vehicleId` and `in_use_by === null`, and
  trailer = the entry matching `lastUsed.trailerId` when it exists and is free (else `null`, i.e.
  bobtail). When non-null **and** `odometerMode !== 'required'`, Today's pre-shift hero is a `Card
  hero`: `label` "START YOUR DAY", `screenTitle` "Same rig as yesterday?", two rows (disc `neutral`
  truck → "Unit <n>" + `make model`; disc `neutral` route → "Trailer <n>" + "Bobtail" when none),
  each with `Badge info` "Free"; `Button hero lg` "Start with this equipment" → `useStartShift`
  with those ids and `takeOver: false`; `Button ghost onHero` "Choose different truck or trailer" →
  `/duty/check-in`. When null or odometer is required: the existing "Confirm equipment" card,
  restyled as `Card hero` with `Button hero`. On success: `useToast().show("On duty · Unit <n>")` (B1.12).
- **B6.2 End shift (behaviour).** `app/duty/end-shift.tsx` sheet: `Section` "Your shift" `Card
  flat` rows: equipment (disc `neutral` truck, `shiftDurationLabel`), loads delivered today
  (`buckets.previous.filter(completed_at is today).length`, disc `success`), stops completed today
  (sum over those loads, disc `success`), photos waiting to sync (`pending`, disc `action`, shown
  only when > 0 with subtitle "They finish uploading after you sign off"). Odometer group as today.
  Footer unchanged. `tests/duty-format.test.ts` gains the "today" filters.
- **B6.3 Check-in:** `EquipmentRow` uses `ListRow disc` (`neutral`; selected → `brand` disc with
  check), unit numbers in `numericInline`; steps and search unchanged.
- **B6.4 More:** sections Support (Message dispatch), Performance (Score, when hidden as a tab),
  Work tools (Hazmat checks), App (Settings, Notifications — **new durable entry**, gated
  `notifications`), Developer gallery. The duplicated duty rows are removed (Today owns duty).
- **B6.5 Settings:** groups Account (email/role + Sign out as the last row, destructive), Sync
  (`SyncStatus` + the error banner + a per-record retry list when `needsAttention > 0`: rows from
  `listUnfinished()` with `status ∈ {'failed', 'dead'}` (`OutboxStatus` in `src/data/policy.ts`),
  each showing `kind`, `lastError` and a Retry action calling `retryNow(id)`), Appearance (`Section` +
  `Card flat` holding the two sliding `SegmentedControl`s, no inner headings card), Build info,
  Developer. The three account-ish groups collapse to one.
- **B6.6 Messages:** thread rows with `info` disc, title `sender_name ?? threadTitle`, subtitle
  preview, right `caption` time over an unread `Badge brand` count; composer on `[id]` unchanged
  in behaviour; the inbox's stacked input+button becomes one row (input flex-1 + 48pt send icon
  button). "Works offline" caption kept once, under the composer only.
- **B6.7 Notifications:** rows with discs by severity (`danger` / `caution` / `info`), unread rows
  `bg-surface-selected`; the preferences group moves to the end under `Section` "Preferences" with
  its own `Card flat` (no split into a second screen in this plan).
- **B6.8 Hazmat hub and verdict** (`app/hazmat/index.tsx`, `app/hazmat/[loadId].tsx` only): rows
  with discs by outcome; the verdict screen's outcome becomes a `Card` `bg-success-soft|danger-soft|
  warning/12` with disc + `navigationTitle` outcome word + `supporting` message; findings rows keep
  their content.
- **B6.9 Auth screens:** `AuthHero` keeps the logo; titles in `screenTitle`; inputs and buttons
  inherit B1.
- **Tests:** `tests/start-shortcut-model.test.ts` (free / in-use / missing vehicle, trailer
  fallback to bobtail, odometer-required suppression).
- **Done when:** gates green; every route walked once on the simulator in light and dark with a
  screenshot per route attached to the PR.

### B7 · Cleanup, contract, device gate — CODE DONE 2026-09-07; device gate OPEN

**Branch:** `claude/driver-b7-close`.

- Delete `assets/tab-icons/`, `scripts/gen-tab-icons.mjs` and its `package.json` script; delete any
  remaining `h-[`/`min-h-[`/`w-[` brackets by adding the needed steps to Tailwind `spacing` (the
  audit lists the 29 sites) and extend `check-driver-design.mjs` to ban `(?:h|w|min-h|min-w|
  max-w)-\[` so they cannot return.
- `DESIGN.md`: rewrite "Component rules" and "Screen composition rules" to name the B1 primitives
  and the B2–B6 compositions; add "Hero and sheet" rules (D-DB1) and the chip/disc tone table.
- Write `DRIVER-APP-DIRECTION-B-AUDIT.md` on the model of the Design System 2.0 audit: findings
  from the device pass, corrections, and the open decisions.
- **Owner device gate** (the only non-code step): iPhone + Android, bright daylight and night cab,
  default and large text, light/dark/high-contrast, airplane mode on the stop screen, one-tap start,
  an offer deck with two offers. Log only actionable issues into the audit doc; fix them in
  follow-up PRs named `claude/driver-b7-fix-<n>`.
- **Done when:** the audit doc is merged with the device findings marked fixed or accepted.

---

## 6. Production readiness — routing, source connections, App Store and Google Play

The redesign (§5) makes the app look and behave like a product. This section makes it shippable
through the two stores and honest about what it connects to. Steps P0–P8 are independent of B0–B7
except where a step says otherwise; **P1 must merge before the first store build and P4 before the
first store submission.** Everything below was verified on `main` 1d84cfd on 2026-09-07 or taken
from the stores' own published requirements on that date.

### 6.0 Store facts this section is bound by (dated; re-check on the day of submission)

| Requirement | Source | What it means here |
|---|---|---|
| New apps and updates must **target Android 16 (API 36)** from 2026-08-31 (extension to 2026-11-01 on request) | Play Console help, "Target API level requirements" | RN 0.86.2's version catalog already resolves `targetSdk 36 / compileSdk 36 / minSdk 24`; P1 **pins** them with `expo-build-properties` so an RN bump cannot silently move them. |
| Apps targeting Android 15+ must support **16 KB page sizes** (required since 2025-11-01; hard stop for updates 2027-02-01) | Android Developers blog, "Prepare your apps for 16 KB" | Every `.so` in the bundle must be 16 KB-aligned. `useLegacyPackaging=false` is already set; NDK is 27.1 (alignment became default in r28). P1 adds a mechanical check on the built artifact; nothing is assumed. |
| App Store uploads must be built with **Xcode 26 / iOS 26 SDK** since 2026-04-28 | Apple Developer news, "App Store submissions now open…" | There is no iOS CI. P2 builds iOS on EAS's macOS image with Xcode 26; the owner's Mac needs Xcode 26 only for the manual device pass. Liquid Glass restyles native controls by default; the app's native surfaces are the image picker, the VisionKit scanner and `Modal`, all reviewed in P8. |
| **Account deletion** must be initiable in-app for apps that support account creation (5.1.1(v)); regulated industries may complete it through a customer-service flow (5.1.1(ix)) | App Store Review Guidelines | Logins are fleet-issued and the API route is closed with 403 today. Driver qualification records are retained by law (49 CFR 391.51). P4 builds an in-app **request** that closes the login immediately and records the request for the fleet, and says what is retained and why. |
| Play requires an **App Bundle** (AAB) and enrolment in Play App Signing; a privacy policy URL; the Data Safety form | Play Console | P2 adds the AAB lane; P3 hosts the policy and fills both stores' forms from one data matrix. |
| Apple requires **privacy nutrition labels**, a **privacy manifest** for required-reason APIs and collected data, review **login credentials** for gated apps | App Store Connect | P1 declares the manifest; P3 writes the labels; P7 creates the review fleet and credentials. |

### 6.1 Decisions (D-PR1–D-PR12)

- **D-PR1 · Identifiers stay.** Bundle id and package stay `com.silvicom.fuelguard.driver`; display name
  "Silvicom 360 Driver"; slug `fuelguard-driver`. Renaming would orphan every sideloaded install and
  its encrypted outbox.
- **D-PR2 · Version scheme.** `version` becomes `1.0.0` at P1 and follows semver by hand; `ios.buildNumber`
  and `android.versionCode` are the CI run number (`IOS_BUILD_NUMBER` / `ANDROID_VERSION_CODE`), never
  hand-edited. `runtime-version.json` stays the OTA runtime key and moves only when the native
  fingerprint changes (existing `driver-ota.yml` rule).
- **D-PR3 · Store builds are EAS Build, submitted with EAS Submit**, for both platforms, triggered by a
  tag `driver-v<semver>` in a new `driver-store.yml`. Rationale: there is no macOS runner and the
  Xcode 26 requirement makes a hand-archived iOS build a single-machine dependency. The existing
  `driver-android.yml` APK lane stays for the tester install page until the Play **internal testing**
  track replaces it (P8), then is deleted.
- **D-PR4 · One signing key.** The existing Android keystore (`ANDROID_KEYSTORE_*` secrets) is uploaded
  to EAS as the Android credentials **and** enrolled as the Play App Signing key (Play Console → App
  integrity → "Use an existing key", `pepk`), so a phone that installed the sideloaded APK upgrades in
  place from the store. iOS distribution certificate and profile are EAS-managed.
- **D-PR5 · Drivers sign in with Driver ID + password only** (DC9 in `DRIVER-CREDENTIALS-PLAN.md`).
  The in-app `accept-invite` screen and the driver call to `POST /api/invites/accept` are removed;
  invite emails already link to the web. Therefore **no universal links or Android App Links are
  needed for authentication**, and none are added. Notification deep links stay in-app
  (`resolveDeepLink` over the push payload). The custom `fuelguard://` scheme stays for development.
- **D-PR6 · Location leaves the app.** `expo-location` is removed (zero call sites); the map hero (B4.4)
  needs no permission. The navigation programme re-adds it with a real feature (NP4).
- **D-PR7 · Permissions shipped:** camera (`expo-image-picker`, camera only), notifications
  (`expo-notifications` plugin, requested after sign-in when the fleet enables the feature — unchanged),
  internet, vibrate. Everything else is blocked explicitly (P1).
- **D-PR8 · Account deletion = close the login now, delete what the law allows within 30 days, retain
  the DQ file and say so.** Built in P4.
- **D-PR9 · Privacy policy, terms and support are pages on the web app** at `/privacy`, `/terms`,
  `/support` (public routes), drafted from the data matrix in P3 and marked for counsel review; the URL
  is what the stores require, and it exists after P3 regardless of counsel's timing (§7 Q-PR3).
- **D-PR10 · Dev tooling never ships.** `expo-dev-client` and its plist entries are excluded from store
  builds by `APP_VARIANT=store`; dev-only routes keep their `__DEV__` redirects.
- **D-PR11 · Crash reporting goes native.** `@sentry/react-native/expo` plugin with source-map upload in
  EAS builds when `SENTRY_AUTH_TOKEN` is set; without it the build still succeeds JS-only (today's
  behaviour).
- **D-PR12 · Sign-out is global.** `supabase.auth.signOut({ scope: 'global' })` and push revocation on
  every sign-out path, not only Settings.

### 6.2 Steps

#### P0 · Retire the stale gate rows (docs, 1 PR, with this plan)

- `RELEASE-GATE.md` Gate D: the "account deletion ✅ built" row is replaced with "☐ not built — see
  DIRECTION-B-PLAN §6 P4"; the location row becomes "expo-location removed (P1)"; add rows for target
  API 36, 16 KB, Xcode 26, AAB lane, privacy manifest, review credentials, each pointing at its P-step.
- `DRIVER-APP-BUILD-STATUS.md` gets a dated line pointing here.
- **Done when:** merged with this plan (this PR).

#### P1 · Native configuration for the stores (`claude/driver-p1-store-config`)

Touches `app.config.ts`, `package.json`, `plugins/`, `assets/`, `scripts/`, `.github/workflows/ci.yml`.

- **P1.1 `app.config.ts`:**
  ```ts
  const storeBuild = process.env.APP_VARIANT === 'store';
  version: '1.0.0',
  ios: {
    supportsTablet: false, bundleIdentifier: 'com.silvicom.fuelguard.driver',
    buildNumber: process.env.IOS_BUILD_NUMBER ?? '1',
    config: { usesNonExemptEncryption: false },
    entitlements: { 'aps-environment': storeBuild ? 'production' : 'development' },
    infoPlist: {
      NSCameraUsageDescription: '<the existing proof-of-work string>',
      NSFaceIDUsageDescription: 'Silvicom 360 Driver does not use Face ID. This entry exists because the secure keychain library declares it.',
      NSMotionUsageDescription: 'Silvicom 360 Driver does not read motion data.',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: !storeBuild },
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID', … same purposes },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress', … },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos', … },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID', … (push token) },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent', … (messages, stop notes) },
        { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData', NSPrivacyCollectedDataTypeLinked: false, … },
      ],
      NSPrivacyAccessedAPITypes: [ FileTimestamp C617.1, UserDefaults CA92.1, SystemBootTime 35F9.1 ],
    },
  },
  android: {
    package: 'com.silvicom.fuelguard.driver', versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    edgeToEdgeEnabled: true, allowBackup: false,
    permissions: ['android.permission.CAMERA', 'android.permission.INTERNET', 'android.permission.VIBRATE', 'android.permission.POST_NOTIFICATIONS', 'android.permission.ACCESS_NETWORK_STATE'],
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.RECORD_AUDIO'],
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#14263F' },
  },
  icon: './assets/icon.png',
  plugins: [
    './plugins/withGradleMemory.js', './plugins/withReleaseSigning.js', './plugins/withPredictiveBack.js',
    'expo-router', ...(storeBuild ? [] : ['expo-dev-client']), 'expo-font', 'expo-secure-store',
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-image-picker', { cameraPermission: '<existing string>', photosPermission: false, microphonePermission: false }],
    '@maplibre/maplibre-react-native',
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#F4A340', defaultChannel: 'default' }],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#14263F', dark: { backgroundColor: '#0A1422' } }],
    ['expo-build-properties', { android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24, buildToolsVersion: '36.0.0', enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true }, ios: { deploymentTarget: '16.4' } }],
    ['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }],
  ],
  ```
  The three accessed-API entries are the ones Expo's template already declares. Xcode 26's privacy
  report at the first archive (Product → Generate Privacy Report) is the verifier for the rest: any
  API it lists is added then with its reason code — for disk space, `85F4.1` if the app checks free
  space before writing, `E174.1` if it displays it — never in advance.
- **P1.2 Dependencies:** add `expo-build-properties`, `expo-splash-screen`, `@sentry/react-native` is
  present; remove `expo-location`. `pnpm --filter @silvicom/driver exec expo install --fix` pins SDK
  57 versions.
- **P1.3 `plugins/withPredictiveBack.js`:** a config plugin that sets
  `android:enableOnBackInvokedCallback="true"` on `<application>`. Verified in P8 on Android 16: back
  gesture closes `ConfirmSheet` (already handles `onRequestClose`), pops modal routes, and does not exit
  the app from a tab.
- **P1.4 Icons and splash:** `scripts/gen-app-icons.mjs` (devDependency `@resvg/resvg-js`) rasterises
  `apps/web/public/SilvicomLogoS.svg` (the "S" mark, brand navy `#18274D`) into `assets/icon.png` (1024²,
  mark in white on `#14263F`), `assets/adaptive-icon.png` (1024², mark inside the 66% safe zone,
  transparent background), `assets/splash-icon.png` (512², white mark, transparent),
  `assets/notification-icon.png` (96², white silhouette, transparent — Android tints it). The script
  is idempotent and its outputs are committed.
- **P1.5 16 KB check:** `scripts/check-16kb.mjs` takes an APK or an AAB's universal APK, extracts every
  `lib/**/*.so`, runs `llvm-objdump -p` (from the Android NDK in `$ANDROID_HOME/ndk/<ver>/toolchains/llvm/prebuilt/*/bin`)
  and fails if any `LOAD` segment `align` is below `2**14`. Wired into `driver-android.yml` after
  `assembleRelease` and into `driver-store.yml` (P2) on the AAB via `bundletool build-apks --mode=universal`.
  If a library fails, the fix is that library's version bump, recorded in §8; the check is the truth.
- **P1.6 CI:** `ci.yml` `native-android` job additionally runs `expo prebuild --platform android` with
  `APP_VARIANT=store` and asserts, by grepping the generated manifest, that the blocked permissions are
  absent, `enableOnBackInvokedCallback` is `true`, and `targetSdkVersion` in the merged manifest is 36
  (`aapt dump badging` on the debug APK of the capture module is not enough; the assertion runs on the
  app module's merged manifest under `android/app/build/intermediates/merged_manifests/release/`
  after `./gradlew :app:processReleaseManifest`).
- **Done when:** gates green; `expo prebuild --clean` on both platforms produces a plist without the
  Expo Dev Launcher strings under `APP_VARIANT=store`, an Android manifest with exactly the P1.1
  permissions, and `check-16kb.mjs` passes on the CI APK.

#### P2 · Build and submit lanes (`claude/driver-p2-lanes`)

- **P2.1 `eas.json`:**
  ```json
  { "cli": { "version": ">= 16.0.0", "appVersionSource": "local" },
    "build": {
      "development": { "developmentClient": true, "distribution": "internal", "env": { "APP_VARIANT": "development" } },
      "preview":     { "distribution": "internal", "env": { "APP_VARIANT": "preview" }, "android": { "buildType": "apk" } },
      "production":  { "distribution": "store", "env": { "APP_VARIANT": "store", "EXPO_PUBLIC_API_URL": "<prod api url>", "EXPO_PUBLIC_SUPABASE_URL": "<prod>", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<prod anon>", "EXPO_PUBLIC_SENTRY_DSN": "<dsn>", "UPDATES_URL": "<xprem url>", "UPDATES_APP_ID": "<id>" },
                       "android": { "buildType": "app-bundle" }, "ios": { "image": "latest" } } },
    "submit": { "production": {
      "android": { "serviceAccountKeyPath": "./play-service-account.json", "track": "internal", "releaseStatus": "draft" },
      "ios": { "ascAppId": "<from App Store Connect>", "appleTeamId": "<team id>" } } } }
  ```
  `appVersionSource: local` because D-PR2 derives build numbers in CI, not in EAS. Public
  `EXPO_PUBLIC_*` values are not secrets (they ship in the bundle today); they are copied from the
  GitHub environment that `driver-android.yml` already uses. The Play service-account JSON and the
  App Store Connect API key are EAS secrets (`eas secret:create`), never committed.
- **P2.2 `driver-store.yml`:** on `push: tags: ['driver-v*']`: require CI green on the tagged commit
  (`require-ci-green`), `pnpm install`, `pnpm --filter @silvicom/shared build:rn`, set
  `IOS_BUILD_NUMBER=ANDROID_VERSION_CODE=${{ github.run_number }}`, then
  `eas build --platform all --profile production --non-interactive --no-wait` is **not** used;
  instead two jobs run `eas build --platform android|ios --profile production --non-interactive --wait`
  so each produces an artifact URL in the job summary, then `check-16kb.mjs` on the Android artifact,
  then `eas submit --platform android|ios --profile production --non-interactive --path <artifact>`.
  Submission lands on Play **internal testing** (draft) and TestFlight; promotion to production is a
  Play Console / App Store Connect click by the owner (P8).
- **P2.3 Credentials (owner, one-time, recorded in §8 when done):** `eas init` (writes
  `extra.eas.projectId` — commit it; it also unblocks push token minting, §7 Q-PR1); `eas credentials`
  → Android → upload the existing keystore; Play Console → App integrity → enrol with that key; Apple
  Developer → App ID `com.silvicom.fuelguard.driver` with Push Notifications capability, APNs key
  uploaded to EAS; App Store Connect → create the app record (name "Silvicom 360 Driver", primary
  category Business, secondary Productivity, iPhone only).
- **P2.4 OTA for iOS:** `driver-ota.yml` publishes `--platform android,ios` (one `eoas publish` per
  platform), so a store iOS build receives the same JS updates as Android.
- **Done when:** a tag `driver-v1.0.0-rc.1` produces an AAB and an IPA on EAS, both submitted to the
  internal/TestFlight tracks, both installable on a device from those tracks, and a sideloaded-APK
  phone upgrades in place from the Play internal track without uninstalling.

#### P3 · Privacy policy, terms, support page, store forms (`claude/driver-p3-privacy`)

- **P3.1 The data matrix** (single source for the policy, Apple labels, Play Data Safety):

  | Data | Collected? | Linked to the driver | Used for tracking | Purpose | Retention |
  |---|---|---|---|---|---|
  | Name, Driver ID (username), email (when set) | yes | yes | no | account, dispatch identification | duration of employment + 3 years (49 CFR 391.51) |
  | Photos taken in the app (stop proof, bills of lading) | yes | yes | no | proof of work, compliance | 3 years (evidence tables are append-only) |
  | Messages with dispatch, stop notes, decline reasons | yes | yes | no | app functionality | 90 days visible; retained per fleet retention rule |
  | Push token (device identifier) | yes | yes | no | notifications | deleted on sign-out and on account closure |
  | Duty sessions, equipment, odometer | yes | yes | no | fleet operations, HOS-adjacent records | 3 years |
  | Performance score inputs (from the fleet's telematics, not the phone) | yes | yes | no | coaching | 8 weeks visible; per fleet rule |
  | Crash data (Sentry, PII-scrubbed, user id only) | yes | no (id only) | no | diagnostics | 90 days (Sentry default) |
  | Precise location | **no** | — | — | — | — |
  | Contacts, health, financial info, browsing history | no | — | — | — | — |

- **P3.2 Pages** in `apps/web` under `src/features/legal/` with routes `/privacy`, `/terms`, `/support`
  (`meta: { public: true, layout: 'public' }`, `noindex: false`): Markdown rendered through the existing
  public layout. `/privacy` sections: who we are, what the driver app collects (the matrix), why, who
  sees it (the driver's fleet; Silvicom as processor; Sentry as sub-processor), retention, the deletion
  request (P4), rights, contact. `/terms`: company-issued account, acceptable use, no warranty for
  routing data, governing law placeholder `[STATE]`. `/support`: "Drivers: contact your dispatcher first.
  For app problems: <SUPPORT_EMAIL>" where `SUPPORT_EMAIL` is a `VITE_SUPPORT_EMAIL` env with the
  fallback text "your fleet manager". The app's Settings screen gains an "About" group with three
  `ListRow`s opening these URLs via `Linking.openURL`.
- **P3.3 Store forms** filled from the matrix: Apple privacy labels (Contact Info, User Content,
  Identifiers, Diagnostics; none used for tracking; all linked except Diagnostics), Play Data Safety
  (same, "data encrypted in transit: yes", "users can request deletion: yes" → P4, "committed to Play
  Families policy: no").
- **Done when:** the three URLs resolve on production web; the matrix is in the plan and the pages
  match it; the App Store Connect and Play forms are saved (owner action, logged in §8).

#### P4 · Account closure request (`claude/driver-p4-account-closure`; migration + API + app + web)

Two merges because of the deploy window rule (a column and its first reader ship separately); a new
table is exempt, so this is **one migration PR followed by one code PR**.

- **P4.1 Migration** (next-numbered): table `driver_account_closure_requests` (`id uuid pk`,
  `org_id uuid not null references organizations(id)`, `driver_id uuid not null references drivers(id) on delete restrict`,
  `user_id uuid not null`, `requested_at timestamptz not null default now()`,
  `status text not null check (status in ('open','completed','declined'))`, `resolved_by uuid`,
  `resolved_at timestamptz`, `note text`), `enable row level security`, no client policies (API-only),
  `merge_driver` learns the FK (`mergeDriver.ts` list — the trap named in the repo memory), PGlite
  matrix `supabase/tests/account-closure.test.mjs` printing a `RESULT` line (driver JWT cannot read or
  write the table; service role can).
- **P4.2 API:** `POST /api/me/account/closure-request` (replaces the closed `POST /delete-account`, which
  is deleted): in one transaction, insert the request (`open`), delete the driver's push tokens, call
  `supabase.auth.admin.signOut(userId, 'global')`, then `auth.admin.updateUserById(userId, { ban_duration: '876000h' })`
  so the login is closed immediately; audit entry `driver.account_closure_requested`; returns `{ ok: true }`.
  `GET /api/driver-app/closure-requests` and `POST /api/driver-app/closure-requests/:id/{complete|decline}`
  (fleet-manage), each audited; `complete` records `resolved_*` and is the fleet's attestation that
  non-retained data was deleted per the policy. All three routes are discovered by `routeAuth.test.ts`.
- **P4.3 App:** Settings → Account → `ListRow destructive` "Close my account" → `ConfirmSheet tone="danger"`
  titled "Close your account?" with the message: "Your login stops working right now and your fleet is
  asked to delete your data within 30 days. Federal rules (49 CFR 391.51) require your fleet to keep
  your driver qualification records for three years after you leave; those are kept. You cannot undo
  this from the app." Confirm → the request → sign out → the sign-in screen shows a `Banner info`
  "Your account is closed. Contact your fleet if this was a mistake." for that session. Offline: the
  request rides the outbox like any write and the sign-out happens locally at once.
- **P4.4 Web:** Settings → Driver App gains a "Closure requests" group listing open requests (driver,
  requested date) with Complete / Decline actions, using existing list and confirm primitives.
- **Done when:** gates green including the new matrix; on a device the flow closes the login (a
  retried sign-in fails with the closed-account message from `driver-login`); the web list shows and
  resolves the request; `RELEASE-GATE.md` Gate D row flips to built.

#### P5 · Routing and source connections hardening (`claude/driver-p5-connections`)

- **P5.1 Remove invite acceptance from the app** (D-PR5): delete `app/(auth)/accept-invite.tsx`,
  `src/features/auth/acceptInvite.ts`, the `useURL` import, the root guard's accept-invite exemption,
  and the driver branch of `POST /api/invites/accept` (the web path stays). Sign-in copy already says
  logins are issued by dispatch.
- **P5.2 Sign-in through `apiFetch`:** `SessionProvider.signIn` calls `apiFetch('/api/auth/driver-login')`
  (15 s timeout, mapped errors) instead of raw `fetch`; the email branch (`signInWithPassword`) stays for
  dev.
- **P5.3 Global sign-out:** `signOut` revokes push first (moved from Settings into the provider), then
  `supabase.auth.signOut({ scope: 'global' })`, then clears local state; the closed-account and
  version-gate paths call the same function.
- **P5.4 Update gate opens the store:** `UpdateRequired` shows a `Button hero` "Open the App Store" /
  "Open Google Play" via `Linking.openURL('itms-apps://apps.apple.com/app/id<ascAppId>')` and
  `'market://details?id=com.silvicom.fuelguard.driver'`, with the https fallbacks; the ids live in
  `src/lib/storeLinks.ts` and are filled in P2.3.
- **P5.5 Environment truth in-app:** `BuildInfoCard` already shows API commit and schema state; add the
  API base host and the update channel so a tester can prove which backend a build talks to.
- **P5.6 Deep-link test stays total:** `tests/deep-link.test.ts` gains the P4 sign-out path (a deep link
  while signed out lands on sign-in, then the target after sign-in — implemented by storing the pending
  href in `SessionProvider` and replaying it once `ready`).
- **Done when:** gates green; a fresh install signs in with a Driver ID, receives a push (after P2.3),
  opens the deep link, and after sign-out cannot reuse the old refresh token (verified by replaying it
  against `/api/me/driver` → 401).

#### P6 · Store-facing runtime checks (`claude/driver-p6-runtime`)

- Android 16 large-screen behaviour: the B1.1 560pt column rule is the fix; P6 verifies it on a
  foldable emulator (Pixel Fold AVD, API 36) in both orientations and records screenshots.
- Predictive back (P1.3) verified on the same AVD; iOS 26 Liquid Glass verified on the image picker,
  the VisionKit scanner sheet and `ConfirmSheet`'s `Modal` on an iOS 26 simulator; any native control
  that reads wrong is opted out per-surface (`UIDesignRequiresCompatibility` is **not** set app-wide,
  since it expires in a later SDK).
- `allowBackup=false` verified: `adb backup` returns nothing for the package.
- **Done when:** the screenshots and the two AVD/simulator logs are attached to the PR.

#### P7 · Review fleet and credentials (`claude/driver-p7-review-fleet`)

- `apps/api/scripts/seed-review-fleet.mjs` (service role, idempotent by org slug `silvicom-review`):
  one org with `hazmatguard` and all driver-app features on; one driver `review.driver` with a
  password from `REVIEW_DRIVER_PASSWORD`; one vehicle and one trailer; one `in_transit` load with three
  stops (Joliet → Whitestown → Columbus, real addresses, appointment windows around the time of day),
  two `offered` loads, one `delivered` load, eight settled score weeks, one dispatch thread with a
  message, one cleared hazmat check. Runs against production once (the review org is a real tenant
  with no real people) and is re-runnable to reset it.
- Reviewer notes template (stored at `docs/plans/drivers-app/STORE-REVIEW-NOTES.md`): what the app is,
  that logins are fleet-issued, the demo credentials, the path to Close my account, that notifications
  need the feature on (it is on for the review org), that camera is used for proof photos only.
- **Done when:** the seed runs green against production and the notes are pasted into both consoles.

#### P8 · Listing, tracks, and the release gate (`claude/driver-p8-listing`)

- Screenshots: 6.9" and 6.5" iPhone, 6.7" Android phone, from the review fleet: Today (active
  load), Loads (offer deck), Stop (map), Score, Settings. Feature graphic 1024×500 for Play from the
  hero navy and the mark. Short description (80 chars) and full description drafted in the PR for the
  owner to edit.
- Play: internal testing → closed testing (12 testers, 14 days — Play's requirement for new personal
  accounts does not apply to an organisation account, but the closed track is still the right soak) →
  production. Apple: TestFlight internal → App Review.
- `RELEASE-GATE.md` Gate D rows all flipped with dates; the sign-off table filled.
- **Done when:** both apps are live on their stores and `driver-android.yml` is deleted in favour of the
  Play internal track (the `driver-dist` page is retired in the same PR).

---

## 7. Prerequisites register — every unknown, its owner, and the fallback the code takes

Nothing in §5 waits on an answer here; each entry names what the code does until the answer arrives.

- **Q-DB1 · Map tiles in production** (owner): OpenFreeMap is free and account-less, with no SLA;
  `EXPO_PUBLIC_MAP_STYLE_URL(_DARK)` can point at MapTiler or self-hosted Protomaps later.
  *Fallback (built in B4.4):* offline or missing coordinates render the flat hero; a tile outage
  renders MapLibre's empty canvas behind the pin, which is acceptable for a picture-only map.
- **Q-DB2 · Sunlight legibility of the navy hero** (owner, device gate B7): the hero carries only
  `on-hero` and `on-hero-secondary` for essential copy (≥ 4.5), and the high-contrast theme deepens
  the hero to `#0B1830`. *Fallback:* if the device pass fails outdoors, B7 flips Today's hero to the
  greige alternate on the canvas by re-valuing `hero`/`on-hero*` roles only (no component change).
- **Q-DB3 · Remaining distance / ETA** (navigation programme NP1): not shown until a route service
  exists. *Fallback:* `Stop n of m` and `total_miles` (built in B2/B3).
- **Q-DB4 · Notification inbox vs preferences split** (owner): B6.7 keeps one screen. *Fallback:*
  none needed; a split is a later step.
- **Q-DB5 · Message thread ↔ stop linkage** (dispatch behaviour): B4.5 matches threads by
  `load_ref` only. *Fallback:* no message row when no thread carries the ref.
- **Q-DB6 · Deck gestures** (owner): B3.2 advances the deck on Accept/Decline only; no swipe.
  *Fallback:* none needed; a swipe is additive later.

- **Q-PR1 · EAS project and credentials** (owner, one-time, P2.3): `eas init` project id, Android
  keystore upload, Play App Signing enrolment, APNs key, App Store Connect record. *Fallback:* until
  done, P1–P3–P4–P5 still merge and ship through the existing APK lane; push tokens are not minted
  (the in-app notification centre and its 60 s poll work without them, as today).
- **Q-PR2 · Xcode 26 on the owner's Mac** (owner): needed only for the manual iOS device pass in P6/P8;
  store builds use EAS's Xcode 26 image. *Fallback:* the device pass runs on TestFlight builds.
- **Q-PR3 · Counsel review of the privacy policy and terms** (owner + counsel): P3 publishes a draft
  built from the data matrix and marked "v1, under review" in its footer; the stores need the URL,
  not the sign-off. *Fallback:* the draft stays live until replaced.
- **Q-PR4 · Support email** (owner): `VITE_SUPPORT_EMAIL`. *Fallback:* the support page says "contact
  your fleet manager", which is true today.
- **Q-PR5 · A native library that fails the 16 KB check** (measured by P1.5 on the first store
  build): *Fallback:* bump that library; if no aligned version exists, replace it (the only candidates
  with native code outside Expo/RN are MapLibre and Sentry; both publish 16 KB-aligned releases in
  2026). The check, not this sentence, decides.
- **Q-PR6 · App Review asks for account deletion beyond the closure request** (Apple, at review):
  P4's flow closes the login immediately and records the request; the reviewer notes cite 5.1.1(ix)
  and 49 CFR 391.51. *Fallback:* if rejected on this point, P4.2 `complete` gains an automatic
  30-day job that deletes the non-retained rows (push tokens, message participation, app preferences)
  without fleet action; the retained DQ file is the legal floor and does not move.

---

## 8. Progress log (append dated lines; never edit rows above)

- 2026-09-07 · Plan written from the approved canvas (page B) and the 2026-09-07 critique; facts in
  §0 verified against `main` 1d84cfd. Nothing built.
- 2026-09-07 · **B0 built.** 50 roles × 4 themes (the table in §2.1 has 17 new rows, not 16 — §2's
  prose said 49 roles, the table said 50; the table wins). `scripts/gen-driver-theme-css.mjs` +
  `pnpm gen:theme` now write the `global.css` mirror that claimed to be generated and never was,
  and `tests/theme-css-mirror.test.ts` fails when the file is not what the generator would write
  (proved by mutating a role: the mirror test and the light hero-contrast case both fail).
  Four deviations, each forced:
  (1) **`@expo-google-fonts/lexend` 0.4.3 does not exist** — the registry's published list on
  2026-09-07 is `0.2.0 … 0.4.1`, so 0.4.1 is installed. Export names are as §0 predicted
  (`Lexend_400Regular|500Medium|600SemiBold|700Bold`).
  (2) **`ink` ≥ 4.5 on `accent` is unachievable and wrong** — `accent` is the same lavender in all
  four appearances, so in the dark themes near-white `ink` lands on it at 1.44:1. The binding rule
  above the same table already says text on `action` and `accent` is always `action-fg`; the test
  asserts that instead, and **B1.5's `brand` chip tone is `bg-accent text-action-fg`, not
  `text-ink`**.
  (3) **Tailwind keeps the `section-title` size** while the `sectionTitle` variant is retained
  (§5 B0.4 asks for both the variant's survival and its size class's deletion). It goes with the
  variant in B7. `micro`, `cta` and `nav` are deleted, and their four call sites moved.
  (4) `AppText` keeps family and size in separate maps rather than appending a Bold Text weight
  class — two `font-*` classes on one node resolve by stylesheet order, not string order. The
  numeric variants are tabular by definition rather than by a `tabular` prop each caller must
  remember. Hero/action/accent text tones were added in B0 because B1 cannot put text on the hero
  without them.
- 2026-09-07 · B0 follow-on, found by reading the diff rather than the plan: swapping the platform
  face for Lexend made **seventeen `font-semibold`/`font-medium` call sites silently inert** — a
  weight utility does nothing to a loaded custom face, so the tab bar's selected label, the
  segmented control's active option, every `Badge`, `Toast`, `Banner` action and six screen sites
  would have rendered flat until B1. All seventeen moved to `font-ui-md|sb`, and
  `check-driver-design.mjs` now bans the whole Tailwind weight scale so they cannot come back.
  B1 still owns what each of those sites should *be*; this only keeps the emphasis that was there.
- 2026-09-07 · **B1 built.** `Screen` takes a `hero` node; `Section`, `ToastHost` and
  `src/components/tone.ts` are new; `Card`, `Button`, `Badge`, `ListRow`, `IconButton`, `Avatar`,
  `SegmentedControl`, `GroupedList`, `Banner`, `Toast`, `Progress`, `ConfirmSheet`, `Input`,
  `NumericField`, `Sparkline`, `TabBar`, `SyncStatus`, `ActionBar` and `OfflineBanner` all take
  their Direction B anatomy. Five deviations:
  (1) **`ui.scrollContent` does NOT become `gap-0` globally.** Flipping it flattens sixteen screens
  (~2,950 lines) that B2–B6 have not recomposed yet, and a screen carrying both rhythms gets 40pt
  between sections. `Screen` takes `flow="sections"` instead: a hero screen is always on it, and
  each later step flips its own screen at the call site. The gallery is the first on it.
  (2) **The 72pt separator inset is derived, not fixed.** `ml-[72px]` aligns under a 44pt disc and
  floats absurdly on a bare settings row, and a `GroupedList` mixes the two. `GroupedList` now reads
  each row's own `disc`/`icon` props and insets to where that row's TEXT starts (72 / 52 / 16).
  (3) **`Tone` moved out of `Badge` into `src/components/tone.ts`** with `TONE_SOFT`/`TONE_SOLID`/
  `TONE_ICON`. Six components imported the type from `Badge` and each kept its own colour table, so
  adding `action` and `ghost` would have meant six parallel tables of the same meanings. D-DB6 says
  a disc and a chip for one meaning are one pair of colours; that only holds with one table.
  (4) **`Button` has no `soft` variant to remove at two sites — there was one**, in the gallery.
  (5) **B1.14 large text is partly deferred**: the rules that belong to a primitive are in
  (`SegmentedControl` stacks, chips scroll, nothing caps `allowFontScaling`); the hero card's tile
  stacking and paired-button stacking belong to the compositions B2–B4 build and land there.
  `heroTopPadding` went into `src/theme/safeArea.ts` rather than inline in `Screen`, because that is
  the module the driver app can actually test — proved by mutating 8 to 20.
- 2026-09-07 · **B2 built.** `src/features/today/` holds `todayModel.ts` (pure, 20 tests),
  `TodayHero.tsx`, `AttentionQueue.tsx`, `UpNext.tsx`, `WeekStrip.tsx`, `StartDayCard.tsx`;
  `home.tsx` is 171 lines of composition. `CATEGORY_ICON` moved to
  `src/features/notifications/categoryIcon.ts` and both screens read it. Deviations:
  (1) **`home.tsx` is 171 lines, not "< 150"** — `StartDayCard` came out to its own module (B6.1
  replaces it wholesale) and the rest is the four states' module order, which is the file's job.
  (2) **B6.1's one-tap start is NOT in B2**, as B2.1 allows: the pre-shift hero is the existing
  confirm-equipment action in `Card hero` form, and it also covers `betweenLoads` on duty.
  (3) **`src/features/duty/DutyCard.tsx` is deleted**, not restyled. Today was its only caller and
  the duty strip replaces it; B6.4 already rules that Today owns duty.
  (4) **The countdown flips to "Window open now" AT the appointment**, not one minute after. The
  plan's "1–59 → Opens in m min" leaves `minutes === 0` reading "Opens in 0 min", which is the wrong
  sentence for a window that is open. Found by mutation: three of four mutants died and that one
  lived, so the boundary is now a test.
  (5) **`Skeleton` takes a `style`** so a module and its placeholder can share one height constant
  (`SKELETON_HEIGHTS`) instead of a class and a number drifting apart.
  (6) The four states are in the gallery as fixture rows through the real `AttentionQueue`, because
  `recovery` is otherwise reachable only by breaking the network mid-session on a device.
- 2026-09-07 · **B2 correction, caught by CI not by me.** `src/features/today/` produced **nine
  `lint:boundaries` violations**: a feature may not import a sibling's internals, and Today imports
  five of them. The gate is right — a module that needs duty, loads, notifications, messages and
  score is not a feature, it is a composition. `src/features/today/` moved to **`src/screens/today/`**
  (new layer, `src/screens/README.md` explains it: features own data and rules, screens arrange them,
  routes stay thin). The gate's own comment already ruled out the alternative: "promote the shared
  thing out of `features/`, don't allow-list the leak". Root cause is §4.6, which listed four root
  gates out of the ~28 `gates` runs and never listed this one; it now names it and says when to run
  the whole job.
- 2026-09-07 · **B3 built.** `offerDeckModel.ts` (8 tests, four mutants killed), `OfferDeck.tsx`,
  `loadRows.tsx`, `loadStatus.ts`, and `ChoiceSheet` as a new primitive. `loads.tsx` is a hero with
  the count sentence, the chip rail and the deck; the sheet carries one list per chip. Deviations:
  (1) **`LoadCard.tsx`, `CurrentLoadCard.tsx` and `sampleLoads.ts` are all deleted**, not just the
  first — the plan names `LoadCard`, but `CurrentLoadCard` had no caller left once B2 took the hero
  and B3 took the row, and `sampleLoads` fed only those two. `LOAD_STATUS` was promoted to
  `loadStatus.ts` (B4's detail badge needs it) and `RouteRail` went with the cards: B4's timeline is
  a new component, not a move.
  (2) **`loadViewModel.ts` lost `toSummary`/`toActive`.** They existed to reshape contracts into what
  the CARDS were designed against; the Direction B rows read the contract directly, so the file is
  now three formatters and `bucketLoads`.
  (3) **The decline flow moved into `ChoiceSheet`** as B3.2 asks, and that also fixes the old
  behaviour: tapping "Can't take this" used to grow a new section BELOW the fold of the load detail,
  so the reasons were reachable only by scrolling past the load being declined.
  (4) **The offer deck lives in the hero, and the Offered chip is the default whenever an offer
  exists** — ahead even of a load in transit, because an offer is the only thing on this screen with
  dispatch waiting on the other end of it.
  (5) `SAMPLE_OFFERS` is the gallery's only fixture (§4 rule 8) and exists so both driver types can
  be reviewed side by side — the labels are the ONLY difference between them, so one screenshot
  proves nothing about the other.
- 2026-09-07 · **B4 built.** `itineraryModel.ts` (13 tests), `Itinerary.tsx`, `StopHero.tsx`,
  `PhotoGrid.tsx`; both screens recomposed; the completion receipt goes through `useToast` and
  outlives the `router.back()` that follows it. `stop-capture-model.test.ts` is unchanged and green,
  so the outbox record shape is untouched. Deviations and findings:
  (1) **The window verdict is judged by `arrived_at` when it exists.** B4.5 says "computed from
  `arrived_at ?? now`", which is what this does — but the consequence deserves writing down: a stop
  marked arrived at 13:50 for a 14:00 window must still read "early" when the screen is reopened at
  16:30, or a good arrival silently becomes a late one. It is a test.
  (2) **B4.5's message row is built in the ROUTE, not in `features/loads`.** `src/features/loads/*`
  may not import `features/messages` (`lint:boundaries` — the rule that moved Today to
  `src/screens/`), so `app/loads/[id]/stop/[stopId].tsx` does the thread lookup and passes the row
  down. A route may compose across features; a feature may not reach into a sibling. Q-DB5 stands:
  the match is `load_ref` only, and no row appears when nothing carries the ref.
  (3) **The lifecycle `TaskStepper` is deleted from load detail** (critique defect 21) but the
  component stays — `check-in` uses it for a real wizard, which is what a stepper is for.
  (4) **The window-verdict tests assert the verdict and the arithmetic, never the clock string.** The
  window renders in the DEVICE locale and timezone, so an exact-string assertion tests the CI
  runner's timezone rather than the rule — it failed exactly that way first (`09:00 AM` for `14:00`).
  (5) Four mutants run against `itineraryModel`; three died. The survivor swaps the `skipped` and
  `completed` checks in `nodeState`, which is genuinely equivalent — `status` holds one value — so
  no test was added to chase it.
- 2026-09-07 · **B5 built.** `trendChartModel.ts` (21 tests), `TrendChart.tsx`, `SCORE_DEFINITIONS`
  and per-tile weight labels in `scoreModel.ts` (5 new tests), Score recomposed as a hero screen.
  Deviations and findings:
  (1) **The domain floor is `floor((min − 5) / 10) × 10`, which always leaves air under the lowest
  week.** The plan writes `max(0, floor((min−5)/10)×10)` and that IS what shipped — but the
  consequence was not obvious and my first test asserted the opposite: no point ever sits ON the
  bottom rule, which is right, because a line touching the axis reads as clipped rather than as a
  low score. It is now a property test across three series.
  (2) **The area fill and drop line are drawn; the callout is clamped inside the chart width.** The
  clamp is the one geometry bug this component would otherwise have shipped — a right-anchored
  series puts the newest point at the right edge, so an unclamped callout runs off it every time.
  (3) **Axis labels are SVG text at a fixed 11pt**, per B1.14 — they are furniture, and letting
  Dynamic Type scale them overlaps the plot. The values a driver needs are in the callout and in the
  SVG's accessibility label, both of which do scale.
  (4) **Sparklines are dropped from the breakdown rows** as B5.3 asks; the eight-week line carries
  the history, and three more tiny lines beside it answered a question nobody asked twice.
  (5) **`weightPctLabel` normalises against the configured total.** Weights are per-org and nothing
  guarantees they sum to 1; a row reading "200% of your grade" is the kind of thing a driver notices
  and a test does not, so both the normalisation and the zero-total guard are now pinned.
  (6) Five mutants run against `trendChartModel`; four died. The survivor changes spline CONTROL
  points only — the curve still passes through every week — which is aesthetic tuning, and pinning it
  in a test would freeze a drawing decision rather than a rule.
- 2026-09-07 · **B6 built.** `startShortcutModel.ts` (11 tests, four mutants killed) + the one-tap
  start; `completedToday`/`stopsCompletedToday` in `dutyFormat.ts` (5 tests) + the end-shift summary;
  `FailedSyncList.tsx`; More, Settings, Messages, Notifications, the hazmat hub and verdict, the
  check-in rows and the auth inset all restyled. Deviations and findings:
  (1) **The one-tap start declines in every doubtful case rather than guessing.** A shortcut that
  puts a driver in the wrong truck costs far more than it saves, so an in-use truck, a truck missing
  from the roster, an unloaded roster and an odometer-required org all fall back to the wizard. A
  taken TRAILER does not: it offers bobtail, which is a real morning — but it never substitutes a
  different trailer.
  (2) **`FailedSyncList` keys its labels off the kind CONSTANTS, not their string values.** My first
  pass restated them as literals and got all nine wrong, which would have shown a driver
  `hazmat_capture` on the one screen they read when something has already gone wrong.
  (3) **`completedToday` compares LOCAL calendar days.** A driver signing off at 22:00 Central on the
  7th is already the 8th in UTC; a UTC comparison shows them an empty summary at exactly the moment
  they want to read it. Skipped stops count as worked — the driver still went there.
  (4) **Settings' three account-ish groups collapse to one**, as B6.5 asks. "Account", "Session" and
  "Your account" were three headings for one subject, with sign-out two screens of scrolling from
  the identity it signs out of.
  (5) **`BuildInfoCard` lost its own heading** — inside a titled `Section` it was the title twice.
  (6) **Duty rows are gone from More** (B6.4): a second place to change a truck is how a driver ends
  up unsure which screen is telling the truth. Notifications gains the durable entry.
  (7) **`app/hazmat/capture.tsx` was NOT touched** (§4 rule 7 — scanner programme). It still uses
  `SectionLabel`, which is now a bare in-card heading and renders correctly.
- 2026-09-07 · **B7 built; §5 code complete.** Bracket escapes closed (14 sites → named steps
  `spacing.13/15/18` and `maxWidth.bubble`) and `lint:design` now bans `(h|w|min-h|min-w|max-w|max-h)-[`
  — proved by probe file, which the gate rejected. `sectionTitle` deleted from the variant list, the
  token scale and Tailwind, its last consumer (`TaskStepper`) moved to `rowTitle`. `assets/tab-icons/`
  (referenced by nothing since DS 2.0), `scripts/gen-tab-icons.mjs` and its package script deleted.
  DESIGN.md's "Component rules" and "Screen composition rules" rewritten to describe what B1–B6
  actually built, including the hero/sheet rules and the `flow` contract.
  `DRIVER-APP-DIRECTION-B-AUDIT.md` written: what shipped, the **seven corrections made during the
  build**, the three equivalent mutants accepted, and the device gate as an explicit open checklist.
  Deviations:
  (1) **`min-w-[18px]` became `min-w-5` (20px), not an 18px step.** 18 is not on the 4pt quantum and
  the count badge did not need its own number; the badge is 2pt wider.
  (2) **`max-w-[80%]` became a NAMED `maxWidth.bubble`** rather than a spacing step — a chat bubble's
  share of the column is a design decision, and naming it is the point of removing the bracket.
  (3) **The device gate is not run.** Seven steps shipped with no run on real hardware: there is no
  iOS job (macOS runners bill ~10×) and no screenshot harness. The gallery was extended at every step
  as the substitute and now covers all four Today states, both driver types, both stop heroes, four
  chart states and every chip tone on both grounds — but it is not a phone in daylight. The audit
  names the two failures to expect (Q-DB2 sunlight; amber-on-navy at night), both of which have a
  token-only fallback.
- 2026-09-07 · Audit pass: B0.4 keeps `sectionTitle` until B1; every `Screen` owns its status bar;
  560pt column on wide displays; large-text rules per component; deck backers hidden from assistive
  tech; gate list gains `lint:tests` and `lint:comment-claims`. §6 added (P0–P8, D-PR1–12) from a
  file-level inventory of the store configuration and the stores' published requirements; §7 gains
  Q-PR1–6. P0 (the stale release-gate rows) ships with this document.
