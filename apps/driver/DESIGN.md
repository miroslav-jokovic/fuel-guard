# FuelGuard Driver App Design Contract

This document is the implementation contract for the FuelGuard driver app. It exists to prevent
new screens and components from drifting toward generic AI-generated mobile UI. Read it before
creating or changing any UI in `apps/driver`.

## Where the decisions live

The visual world is **Direction B**, approved by the owner on 2026-09-07 and recorded in
[`DRIVER-APP-DIRECTION-B-PLAN.md`](../../docs/plans/drivers-app/DRIVER-APP-DIRECTION-B-PLAN.md).
Its §1 and §2 are copied into this document below so a screen never has to link out for a value.

Direction B **supersedes the visual world** of the Design System 2.0 documents
([`plan`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2.md),
[`Phase 2`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-2.md),
[`Phase 3`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-3.md),
[`Phase 4`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-4.md),
[`audit`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-AUDIT.md)) — do not read them for
colour, type, radius or composition. **Every behavioural rule of Design System 2.0 still holds** and
is restated as D-DB9 below; the compact-density, semantic-token, container and task-hierarchy rules
apply exactly as they did.

## Product character — Direction B, "night cab over a day sheet"

Silvicom 360's driver app is an operational tool used by professional drivers in a moving vehicle,
in daylight, at night, with gloves, intermittent connectivity, and limited attention. The interface
is calm, glanceable, explicit, and trustworthy. It is not a marketing site, a social feed, or a
generic consumer dashboard.

Each decision below is final; a change is a new dated decision line, not an edit.

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
- **D-DB5 · Depth.** Cards on the sheet carry one soft offset shadow (`0 8 / blur 22 / 8%` of the
  hero, since D-DB10) from `src/theme/elevation.ts`. Hero cards carry a 1px translucent edge and no
  shadow. The floating tab shell carries the only other shadow (D-DB11); nothing else casts one,
  and class-based shadows stay banned.
- **D-DB6 · Rows.** Every list row leads with a 44pt circular icon disc tinted by the row's meaning
  (lavender = message, amber = sync/attention, green = complete, red = blocked, tile-grey = neutral).
  Chevrons are shown only on rows that open something.
- **D-DB7 · Signature moments, one per screen.** Today: the current load as a hero card with the
  appointment window in numerals. Loads: a stacked deck for offered loads with Accept/Decline on the
  card. Score: an eight-week trend line with a callout. Stop: a map hero with the stop pinned.
- **D-DB8 · Not adopted.** Photos or avatars of people, ring charts, fake status-bar chrome, grey
  captions on navy below 4.5:1, gradient buttons, a filter control with no filter behind it, and an
  ETA or remaining-distance figure — **no routing service is reachable from this app**, so any
  "12 min · 4.8 mi" figure would be invented.
- **D-DB9 · Everything behavioural from Design System 2.0 holds:** 4pt quantum; 44/48/56pt targets;
  status = text + icon + tone; offline is a normal state; skeletons only without cached data; no
  native alerts; no card inside a card except a captured-document preview; Dynamic Type stacks
  rather than truncates; Reduce Motion, Bold Text, and high contrast honoured through
  `ThemeProvider`.
- **D-DB10 · Softened palette (owner, 2026-09-07 evening).** The owner's reading of the B0 values
  on a device was "too hard": an ice-blue sheet under a saturated navy with a traffic-cone amber.
  Every role is re-valued, no role is renamed: the sheet is warm cream (`#F3EFE8`), the ink and
  the hero are a low-saturation charcoal-navy (`#1F2433` / `#20283A`), the action colour is
  apricot (`#F2B267`), the lavender and the status hues are desaturated to match. The structure of
  D-DB1–D-DB2 stands; only the temperature changed. The card shadow drops from 12% to 8%.
- **D-DB11 · The tab shell floats.** A capsule in the hero colour, 16pt in from each edge, riding
  on the home indicator's inset, with the active tab's icon raised on an apricot disc through a
  canvas-coloured notch; the disc slides between slots (spring; Reduce Motion jumps). It replaces
  the docked bar with 28pt corners. The shell is the app's SECOND and last shadow
  (`shellElevation`), amending D-DB5. Geometry and rules live in `src/components/tabBarModel.ts`.
- **D-DB12 · No overlines.** The uppercase `label` kicker above a hero-card heading is gone: the
  heading carries its own weight, and what the kicker said moves into the supporting line
  ("Deliver next · Gary, IN · …"). The `label` variant stays in the scale, reserved, with no
  current caller.
- **D-DB13 · ⛔ WITHDRAWN the same day.** Messages was a tab for one merge; the owner's tab set
  (D-DB14) has no room for it and the hero button + More row are restored. Kept so the change is
  traceable.
- **D-DB14 · The four tabs (owner, 2026-09-07 evening).** Home · Loads · Documents · More, with
  Home01, DeliveryTruck01, Folder03 and Ellipsis as their glyphs. Supersedes D51's tab list.
  **Documents** is the driver's document surface — the bill-of-lading scanner and every compliance
  verdict it produced — promoted from a modal hub two taps inside More; it is gated on
  `hazmat.capture` like the hub was. **Score is not a tab**: it is read from More and summarised on
  Home, and `tab.score.detailTab` no longer changes anything in the app. **More** holds three
  groups: the account (who is signed in, the company-issued login, **Sign out**), the work surfaces
  that are not tabs (Driver score, Messages, Notifications) and the settings (System settings,
  Scanner settings, the gallery in dev). Sign out moved to More from System settings.
- **D-DB15 · Auth screens are hero-and-sheet.** The Silvicom mark, white, centred on the navy; the
  title, form and footer on the cream at the one 20pt inset. Replaces a left-aligned 240pt mark
  over a 16pt-gutter form with a centred dev link under left-aligned copy.
- **D-DB16 · Cards are lit, not flat.** A sheet card carries a faint SVG wash (white toward the
  subtle surface at its foot in light; the raised surface fading from its head in dark), a hero
  card sinks toward the hero colour at its foot. In the dark appearances a card carries a hairline
  `edge-subtle` instead of the shadow, which a near-black ground swallows. The wash is
  `react-native-svg`, already in the binary — no gradient module was added. Amends D-DB8's ban on
  gradients: buttons stay flat; only containers carry a wash, and never above 10% at the deep end
  in light.
- **D-DB11 amendment (2026-09-07).** No tab-switch motion at all: the disc is drawn at the active
  slot without a transition and the tab scene switches with `animation: 'none'`. The owner ruled
  the spring "too much", then the fade too.
- **D-DB17 · Home carries the rig and the driver's own rank list (owner, 2026-09-07).** Two modules
  at the foot of the sheet, after the work: **Your score** — this week's grade, fleet rank, the
  eight-week line and the last four weeks each with its rank, the whole card opening Score — and
  **Your rig** — the truck and trailer of the current duty segment with *Change rig* and *End
  shift*. Every rank is the driver's own: the API deliberately exposes no other driver's row
  (`driverContract.ts`), so a fleet leaderboard is §7 Q-DB7, not a module. The current load stays
  the hero card; Up next stays the rows beneath it.

Icons remain HugeIcons SVG through the single `Icon` adapter. Do not replace these traits with a
bundled generic UI font, dashboard gradients, arbitrary illustrations, emoji, or ad-hoc icon imports.

## Apple-inspired layout rules

These rules are an Apple Human Interface Guidelines interpretation for this product, not a claim
that Apple mandates one universal numeric grid.

### Safe areas and structure

- Every screen starts with `Screen`; do not hand-roll safe-area padding.
- Use `ScreenHeader` for titles, subtitles, back actions, close actions, and trailing actions.
- Keep enabled tabs in one stable order: Home, Loads, Documents, More (D-DB14). Fleet feature flags
  may omit Loads or Documents; Home and More are never conditional. The shell draws any count of
  visible tabs; do not add more conditional tab behaviour beyond `href: null`.
- Use modal routes for contextual work such as load details, driving, capture, duty, and settings.
- Respect the device's safe areas and keyboard; never place essential content under system chrome.

### Spacing and layout

- Use a 4pt structural base quantum. Primary structural alignment uses 8, 16, 24, and 32pt; 12pt is
  reserved for tightly related content, and 20pt is a comfortable control or sheet inset. A 2pt
  value is allowed only for optical stacked-text adjustment or a hairline, never structural layout.
  Apple alignment does not require every dimension to be divisible by 8.
- Standard screen content margin: 20pt.
- Standard section separation: 24pt.
- Standard component gap: 16pt; use 12pt only within a related content group.
- Standard card padding: 20pt on the hero, 16pt on the sheet.
- Standard grouped-row minimum height: 52pt; content and Dynamic Type may make it taller.
- Standard interactive target: at least 44pt; primary driver actions use 48pt or 56pt.
- Standard card radius: 24pt. Use 12pt for inputs and small tiles, 16pt for tiles, thumbnails and
  day chips, 28pt for the sheet and tab-shell top corners, and full only for pills, badges, avatars,
  chips, and circular controls (D-DB4). There is no fifth radius.
- Do not introduce arbitrary spacing, radius, or width values without a product-specific reason.
- Prefer full-width mobile layouts. Do not force desktop dashboard grids into the driver app.
- Keep primary actions reachable and visually dominant; secondary actions should not compete with them.

### Information density and vertical rhythm

- Dense means less redundant chrome, not smaller type or touch targets.
- Do not add vertical space solely to make a screen feel premium, airy, cinematic, or symmetrical.
- At default text size on a 390×844pt portrait viewport, a normal Today state should show driver or
  duty context, current/next work, the primary action, and the start of the next useful group. Safe
  areas, accessibility text, translated copy, and blocking errors take precedence over this baseline.
- Use 24pt between genuine workflow regions. Use 32pt or more only for a real workflow boundary or
  an empty-state explanation, never as decorative breathing room.
- A primary operational module has no fixed height target. Its current state and primary action must
  remain visible without decorative filler, and it must grow for Dynamic Type or safety copy.
- Group related rows into one surface with separators. Do not render every row as an independent
  rounded, bordered, shadowed card.
- Do not place a generic card inside another card. An inner surface must represent an independent
  object or action, such as a captured-document preview.
- Multiple simultaneous alerts collapse into one attention summary with expandable detail.
- Inline empty states take only the space needed by their explanation and recovery action; they do
  not fill the viewport for visual balance.
- Every vertical region must answer a driver question, communicate state, or enable an action. If
  it does none of these, remove it.

### Typography and accessibility

- New or redesigned text uses `AppText` semantic variants. Every variant is Lexend (D-DB3); the
  variant names the weight, because a `font-medium`-style utility does nothing to a loaded custom
  face in React Native.
- Do not use raw React Native `Text` or legacy font utility aliases outside `AppText`. Tailwind
  **weight** utilities (`font-medium`, `font-semibold`, …) are banned outright by `lint:design`: they
  are silently inert on a loaded custom face, so they read as emphasis in the source and render as
  none on the device. Reach for `font-ui`, `font-ui-md`, `font-ui-sb` or `font-ui-bold`, or better,
  the variant that already carries the weight.
- Use semantic icon names through `src/components/Icon.tsx`; do not import HugeIcons directly in screens.
- Use the semantic type scale in `src/theme/tokens.ts`. Do not invent arbitrary text sizes for a
  one-off screen.
- Support Dynamic Type and readable text hierarchy. Do not cap content scaling to protect a fixed
  layout; make the layout wrap, grow, or stack. The icon component may remain a fixed glyph box.
- At the shared large-text breakpoint, horizontal metrics, paired actions, route timestamps, and
  segmented choices stack vertically instead of compressing or truncating operational copy.
- Respect Reduce Motion, Bold Text, and high-text-contrast platform preferences through
  `ThemeProvider`; primitives do not perform their own disconnected platform checks.
- Body text must remain readable in light and dark modes and in sunlight.
- Every icon-only control has an accessibility label.
- Every interactive element exposes an appropriate accessibility role and disabled/busy/selected state.
- Do not use color as the only indication of status, trend, error, or selection.

## Token contract

### Approved semantic colors — the 50 roles

`src/theme/theme.roles.json` is the single colour source: 4 appearances × 50 roles as `"R G B"`
triplets. `ThemeProvider`, `src/theme/colors.ts` (native API colours), `tailwind.config.js` and the
**generated** `global.css` mirror all read it. Regenerate the mirror with `pnpm gen:theme`; never
hand-edit `global.css`. `lint:theme` verifies every declaration and
`tests/theme-css-mirror.test.ts` fails if the file is not what the generator would write.

Values are hex here and triplets in the file (mechanical conversion).

| Role | light | dark | highContrastLight | highContrastDark | Job |
|---|---|---|---|---|---|
| canvas | `#F3EFE8` | `#131720` | `#FFFFFF` | `#000000` | the sheet |
| surface | `#FFFFFF` | `#1C2130` | `#FFFFFF` | `#0F1219` | cards, rows |
| surface-subtle | `#FAF8F4` | `#171C28` | `#FAF8F4` | `#000000` |  |
| surface-muted | `#F4F0E9` | `#262C3C` | `#F1EDE6` | `#1C2130` | tiles inside cards, day chips |
| surface-raised | `#FFFFFF` | `#262C3C` | `#FFFFFF` | `#1F2433` | sheets, overlays |
| surface-selected | `#EEEAF8` | `#2C2F4E` | `#E4E0F6` | `#333871` | pressed/selected rows (= accent-soft) |
| surface-inverse | `#1F2433` | `#F4F2EE` | `#12161F` | `#FFFFFF` |  |
| ink | `#1F2433` | `#F5F3EF` | `#000000` | `#FFFFFF` |  |
| ink-secondary | `#454B5C` | `#CBCFDA` | `#1E2331` | `#F1EFEA` |  |
| ink-muted | `#585E6E` | `#ABB1BF` | `#343A4B` | `#D8DCE5` |  |
| ink-subtle | `#5E6474` | `#959CAB` | `#454B5C` | `#C5CBD8` |  |
| ink-disabled | `#9A9EAC` | `#5F6676` | `#585E6E` | `#7C8496` |  |
| ink-inverse | `#FFFFFF` | `#131720` | `#FFFFFF` | `#000000` |  |
| edge-subtle | `#E7E2DA` | `#2A3040` | `#9A958C` | `#585E6E` | row separators |
| edge | `#D4CEC4` | `#363D4F` | `#5E6474` | `#9A9EAC` |  |
| edge-strong | `#9A958C` | `#525A6E` | `#1E2331` | `#D8DCE5` |  |
| edge-focus | `#9C5210` | `#F2B267` | `#743B08` | `#FFCF8F` | focus ring |
| brand | `#1F2433` | `#F2B267` | `#12161F` | `#FFCF8F` | sheet primary action fill + link/selected text |
| brand-pressed | `#30364A` | `#E6A050` | `#000000` | `#FFE1B6` |  |
| brand-subtle | `#EEEAF8` | `#2C2F4E` | `#E4E0F6` | `#333871` |  |
| brand-fg | `#FFFFFF` | `#1F2433` | `#FFFFFF` | `#000000` | text on brand |
| danger | `#B0433B` | `#F58F87` | `#7F1A14` | `#FFB8B3` |  |
| warning | `#8C5716` | `#F3BC78` | `#5C3700` | `#FFD8A0` |  |
| caution | `#A64A19` | `#F5A263` | `#7A2E00` | `#FFC194` |  |
| success | `#276F4D` | `#7BD6A2` | `#0D4A2E` | `#A2E9C4` |  |
| info | `#5B53B8` | `#C9C4F6` | `#3A3390` | `#DEDBFA` | = accent-ink |
| operation-current | `#9C5210` | `#F5BE78` | `#743B08` | `#FFCF8F` | = action-ink |
| operation-next | `#5B53B8` | `#C9C4F6` | `#3A3390` | `#DEDBFA` | offered / upcoming |
| operation-complete | `#276F4D` | `#7BD6A2` | `#0D4A2E` | `#A2E9C4` |  |
| operation-blocked | `#B0433B` | `#F58F87` | `#7F1A14` | `#FFB8B3` |  |
| sync-local | `#5B53B8` | `#C9C4F6` | `#3A3390` | `#DEDBFA` |  |
| sync-pending | `#8C5716` | `#F3BC78` | `#5C3700` | `#FFD8A0` |  |
| sync-failed | `#B0433B` | `#F58F87` | `#7F1A14` | `#FFB8B3` |  |
| hero | `#20283A` | `#0F1219` | `#12161F` | `#000000` | hero region, tab shell |
| hero-raised | `#2B3446` | `#1C2130` | `#1F2433` | `#1C2130` | cards on the hero |
| hero-edge | `#3A4457` | `#2E3546` | `#454B5C` | `#585E6E` | 1px edge on hero cards, hero dividers |
| hero-tile | `#333C4F` | `#272E3F` | `#2B3446` | `#232939` | tiles inside hero cards |
| on-hero | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | primary text on hero |
| on-hero-secondary | `#C5CBD8` | `#C5CBD8` | `#DDE1EA` | `#F1EFEA` | ≥ 4.5 on hero and hero-raised |
| on-hero-muted | `#939CAD` | `#939CAD` | `#C5CBD8` | `#D8DCE5` | ≥ 4.5 on hero only |
| action | `#F2B267` | `#F2B267` | `#F2B267` | `#FFCF8F` | amber fill: hero primary button, amber chips |
| action-pressed | `#E6A050` | `#E6A050` | `#DD9843` | `#FFE1B6` |  |
| action-fg | `#1F2433` | `#1F2433` | `#000000` | `#000000` | text on action **and on accent** |
| action-ink | `#9C5210` | `#F5BE78` | `#743B08` | `#FFCF8F` | amber as text on sheet surfaces |
| action-soft | `#FBE9D3` | `#3B2C14` | `#FBE9D3` | `#3B2C14` | amber disc / soft chip fill |
| accent | `#D7D3F6` | `#D7D3F6` | `#D7D3F6` | `#DEDBFA` | lavender chip fill |
| accent-ink | `#5B53B8` | `#C9C4F6` | `#3A3390` | `#DEDBFA` | lavender as text |
| accent-soft | `#EEEAF8` | `#2C2F4E` | `#E4E0F6` | `#333871` | lavender disc fill |
| success-soft | `#DFF1E6` | `#173D2C` | `#DFF1E6` | `#173D2C` | green disc / chip fill |
| danger-soft | `#F9E4E0` | `#3F1D1C` | `#F9E4E0` | `#3F1D1C` | red disc / chip fill |

Rules bound to the table, all asserted by `tests/theme-colors.test.ts`:

- Text on `action` and `accent` is always `action-fg` — never white and never `ink`. `action` and
  `accent` hold the same value in every appearance, so a theme-relative ink lands on them at 1.4:1
  in the dark themes.
- Text on `*-soft` fills is the matching strong role (`success` on `success-soft`, `danger` on
  `danger-soft`, `accent-ink` on `accent-soft`, `action-ink` on `action-soft`).
- `on-hero-muted` may carry only non-essential copy (axis labels, timestamps). Anything a driver
  must read on the hero uses `on-hero` or `on-hero-secondary`.
- `ink` ≥ 7 and `ink-secondary|muted|subtle` ≥ 4.5 on the seven content surfaces; every status,
  operation and sync role plus `brand`, `action-ink` and `accent-ink` ≥ 4.5 there as text;
  `on-hero` ≥ 7 on `hero` and `hero-raised`; `on-hero-secondary` ≥ 4.5 on `hero`, `hero-raised` and
  `hero-tile`.

Raw colour values belong only in `src/theme`. Screens and components use semantic classes. Never
use raw hex values, generic Tailwind palette classes, or inline colour styles.

### Approved scales

Use `src/theme/tokens.ts` for non-colour decisions.

**Type — all Lexend (D-DB3).** The Tailwind `fontSize` names are exactly the variant names, so a
class and a variant cannot drift apart.

| Variant | Size / line | Family | Use |
|---|---|---|---|
| caption | 12 / 16 | `Lexend_400Regular` | timestamps, helper |
| label | 12 / 16, uppercase, +0.96 tracking | `Lexend_500Medium` | reserved — no overlines since D-DB12 |
| supporting | 14 / 20 | `Lexend_400Regular` | secondary row text |
| body | 16 / 22 | `Lexend_400Regular` | prose |
| rowTitle | 16 / 22 | `Lexend_500Medium` | row titles |
| action | 17 / 22 | `Lexend_600SemiBold` | button labels |
| navigationTitle | 18 / 24 | `Lexend_600SemiBold` | contextual titles, sheet section headings |
| screenTitle | 28 / 32 | `Lexend_600SemiBold` | tab screen titles on the hero |
| numericInline | 22 / 28, tabular | `Lexend_600SemiBold` | appointment window, unit numbers, miles, durations, row values |
| numericCompact | 24 / 28, tabular | `Lexend_600SemiBold` | hero-card headline number |
| numericHero | 40 / 44, tabular | `Lexend_600SemiBold` | the weekly score |

`sectionTitle` (13 / 18) is a **transitional** variant: eleven screens still use it, B1.7 migrates
them to `navigationTitle` through the `Section` component, and B7 deletes it. Do not use it on a new
screen. Bold Text steps every variant one weight up (400→500, 500→600, 600→700).

- Radii (D-DB4): 12pt inputs and small tiles, 16pt tiles/thumbnails/day chips, 24pt cards, 28pt
  sheet and tab-shell top corners, pill for buttons, chips and icon discs. The Tailwind aliases
  carry the same numbers: `rounded-md` 12, `rounded-lg` 16, `rounded-xl` 24, `rounded-2xl` 28.
- Spacing: 4, 8, 12, 16, 20, 24, 32, 40pt, chosen by semantic relationship; 2pt only for the optical
  exceptions defined above. `layout.screenInset` is 20; hero cards pad 20 and sheet cards 16;
  the sheet rides 28pt over the hero (`sheetOverlap`) and opens with 24pt (`sheetTopPadding`).
- Targets: 44pt minimum, 48pt comfortable, 52pt grouped row, 56pt driving-critical action.
- Elevation: `cardElevation(themeKey)` and `shellElevation(themeKey)` from `src/theme/elevation.ts`
  and nothing else. `lint:design` bans `shadowColor` outside `src/theme/`.

If a value is not represented by the token scale, first ask whether the component is actually a
new pattern. Do not silently add a one-off value.

## Component rules

### Use existing primitives first

Always check `src/components` before writing markup. The canonical primitives are:

- Layout: `Screen`, `ScreenHeader`, `Section`, `SectionLabel`, `GroupedList`, `Card`, `ListRow`, `ActionBar`
- Typography: `AppText`
- Actions: `Button`, `IconButton`, `ConfirmSheet`
- Forms: `Field`, `Input`, `NumericField`
- Status and feedback: `Badge`, `Banner`, `Toast` + `ToastProvider`/`useToast`, `OfflineBanner`, `SyncStatus`
- Progress and workflow: `Progress`, `TaskStepper`
- Data display: `Sparkline` and compact grouped metric rows.
- State handling: `Skeleton`, `EmptyState`
- Choice controls: `SegmentedControl`, `ToggleRow`

Direction B anatomy, in the primitives:

- **`Screen`** takes a `hero` node to become the two-layer composition (navy region, light sheet with
  28pt corners riding 28pt over it, one ScrollView). It owns the status-bar style and, on a display
  ≥ 600pt wide, centres content in a 560pt column. `flow="sections"` means the children are
  `Section`s and the flow adds no gap of its own.
- **`Section`** owns the space around a titled region: 24pt above the heading, 12pt below it. Do not
  reintroduce a container gap alongside it — the two rhythms sum.
- **`Card`** is `sheet` (the surface, the one shadow in light, a hairline edge in dark, a faint
  wash), `hero` (on the navy, 1px `hero-edge`, a wash toward the hero at the foot, no shadow) or
  `flat` (none of it — a container for rows inside an already-contained region).
- **`Button`** is a pill at 44 / 48 / 56. `primary` is the charcoal fill on the sheet; `hero` is the
  apricot fill, and it belongs only on the hero. `secondary` carries a hairline `edge` so it keeps a
  shape on a white card. `onHero` switches `secondary` and `ghost` to their hero forms.
- **`Badge`** is a chip: 28 or 32pt, pill, `caption` in `ui-md`, and **no `self-start`** — it centres
  in whatever row holds it.
- **`ListRow`** takes `disc={tone}` to lead with the 44pt tinted circle (D-DB6). `GroupedList`
  derives each separator's inset from the row above it, so the line starts where the text does.
- **Tones** live in `src/components/tone.ts` and are shared by chips, discs, banners, toasts,
  progress bars and confirm sheets, so one meaning is one pair of colours everywhere.

Extend an existing primitive when the anatomy and behavior are the same. Create a new component
only when the use case cannot be expressed by an existing primitive without making it confusing.

### Required component contract

Every new reusable component must define:

1. Its single user problem and intended context.
2. Anatomy and content hierarchy.
3. Approved variants and size options.
4. Rest, pressed, focused, disabled, loading, empty, error, and selected states where relevant.
5. Light-mode and dark-mode behavior.
6. Accessibility role, label, state, and hit target.
7. Offline behavior when it reads or writes operational data.
8. At least one realistic FuelGuard example in the component gallery.

Do not add a `variant="primary"` escape hatch that allows arbitrary styling. Variants must encode
approved product decisions.

## Screen composition rules

### Hero and sheet (D-DB1)

Today, Loads, Score and Stop are **hero screens**: `Screen` takes a `hero` node, draws the navy
region, and rides the light sheet 28pt over it with 28pt top corners. One ScrollView — the hero
scrolls away with the content, because a driver reading a list should not be paying for a header
they have already read. Every other screen is **sheet-only**; a second navy region under the first
reads as a new app rather than a deeper level.

A hero screen passes `flow="sections"`, which means its children are `Section`s that own the space
above them. A sheet-only screen keeps the flat 16pt gap until its own step recomposes it. The two
rhythms cannot coexist: a screen with both gets 40pt between sections.

On a display 600pt or wider, content is centred in a 560pt column and nothing stretches — Android 16
ignores the portrait lock at that width for apps targeting API 36.

### Today

Today is **four screens, not one template** (`screens/today/todayModel.ts`): `preShift`,
`activeLoad`, `betweenLoads`, `recovery`. The state decides which modules appear and in what order;
`home.tsx` is composition only, and every rule that decides what a module contains is pure and
tested. Recovery outranks the rest — a screen built on data that failed to load says so first, and
still shows what the cache held.

The attention queue is the second half: sync failures, a trailer gap, unread alerts and threads,
queued work and a hazmat verdict, in priority order, capped at four, with the rest collapsed into an
honest "+n more". Before it, each of those lived on a different screen, so the one screen a driver
actually opens could be entirely calm while three things were wrong.

### Loads

The offer deck is the signature moment: Accept and Decline on the card, plates behind it for the
count, and Offered as the default chip whenever an offer exists — ahead even of the load in transit,
because an offer is the only thing here with dispatch waiting on an answer. Current, Upcoming and
History are rows on the sheet, not cards: Today already gives the current load a hero, and repeating
that card made Loads a second Today.

There is **no filter control**. The reference had one and there is nothing behind it.

### Load detail and Stop

Load detail is sheet-only and carries ONE progress indicator: the itinerary. The lifecycle stepper
is deleted — a driver looking at a load they are driving does not need to be told it has been
accepted. A stop's node colour says what happened to it, and the connector out of a **skipped** stop
stays grey, because the run did not pass through it.

The stop screen's hero is a map, `pointerEvents="none"`. There is no route service in this app, so a
pannable map would promise something with nothing behind it; it orients a driver in a yard they have
never been to. Offline, or with no coordinates, the flat navy hero takes its place. Required photos
are tiles, and a tile never claims more than the app knows.

### Score

The number and the eight-week trend are the hero; what made the score is the sheet. Every sub-score
states what it measures and what share of the grade it carries. The chart's floor is the ten below
the driver's worst week — never a flat 0–100, which spends two thirds of its height on a band no
driver occupies — and its ceiling stays at 100. No projections, no "on track for", no target the
driver did not set.

### Documents

The scanner's front door, as a tab (D-DB14): the capture action pinned in the footer, every past
check as a row whose disc carries its outcome, the verdict one tap deeper as a modal. Nothing here
is invented — a row is a `MeHazmatLoadRow`, a verdict is the server's run.

### More, Settings, Messages, Notifications

`Section` + `Card variant="flat"` + `ListRow disc` for grouped settings and account actions. More
is three groups (D-DB14): account with Sign out, work, settings. Scanner settings is a screen of
facts with no switches — every capture rule is signed fleet configuration.
Destructive actions use `ConfirmSheet`; an n-answer question uses `ChoiceSheet`, in front of the
flow rather than below its fold.

**Duty does not appear in More** — Today owns the shift, and a second place to change a truck is how
a driver ends up unsure which screen is telling the truth. A failed sync is a **list of records with
individual retries**, not a count with one global button.

### Operational workflows

Capture, duty, navigation, and load details are contextual modal routes. They should preserve the
shell and make the next action obvious, with no decorative controls that do not affect the task.

## State and motion rules

- Prefer cached data over a blank screen when safe.
- Show skeletons only when no usable cached data exists.
- Use `EmptyState` to explain what happens next and offer a recovery action when one exists.
- Use `Banner` for actionable errors and connectivity state; never silently swallow a failed write.
- Offline is a normal operational mode. Say what was saved locally and what will sync later.
- Use haptics only for meaningful actions: selection, success, warning, or destructive confirmation.
- Motion is short and purposeful: pressed feedback, sheet presentation, skeleton breathing, and state transitions.
- Never animate essential content in a way that delays the driver's next action.

## AI implementation protocol

Before writing UI:

1. Read this file and inspect the existing component gallery.
2. Identify the closest canonical screen and component pattern.
3. State which existing primitives will be reused.
4. State any genuinely new design decision and why the current system cannot express it.
5. Implement states and accessibility before visual polish.
6. Run driver typecheck, lint, token checks, and tests.

Reject generated UI that contains any of the following:

- A new color, font, icon set, radius, shadow, or spacing scale outside the Design System 2.0 tokens.
- Generic cards, dashboard tiles, tables, or pills with no FuelGuard domain purpose.
- A new component that duplicates an existing primitive.
- Native `Alert` for a user-facing confirmation.
- A screen without loading, empty, error, or offline behavior where applicable.
- Icon-only actions without labels.
- Status represented by color alone.
- Desktop/web layout patterns copied into the mobile task flow.
- Placeholder copy, lorem ipsum, fake metrics, or generic SaaS language in production UI.

## Definition of done

A driver UI change is complete only when:

- It uses the approved tokens and primitives.
- It is correct in light mode, dark mode, and offline/empty/error states.
- It respects safe areas, the 4pt spacing quantum, semantic layout rhythm, and minimum touch targets.
- It uses `AppText` for semantic typography and the semantic `Icon` adapter.
- It has a realistic gallery or screen example.
- It passes `pnpm --filter @silvicom/driver typecheck`.
- It passes `pnpm --filter @silvicom/driver lint` and `lint:tokens`.
- It passes the relevant driver tests.
