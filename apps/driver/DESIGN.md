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
- **D-DB5 · Depth.** Cards on the sheet carry one soft offset shadow (`0 10 / blur 20 / 12%` of the
  hero navy) from `src/theme/elevation.ts`. Hero cards carry a 1px translucent edge and no shadow.
  Nothing else casts a shadow, and class-based shadows stay banned.
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

Icons remain HugeIcons SVG through the single `Icon` adapter. Do not replace these traits with a
bundled generic UI font, dashboard gradients, arbitrary illustrations, emoji, or ad-hoc icon imports.

## Apple-inspired layout rules

These rules are an Apple Human Interface Guidelines interpretation for this product, not a claim
that Apple mandates one universal numeric grid.

### Safe areas and structure

- Every screen starts with `Screen`; do not hand-roll safe-area padding.
- Use `ScreenHeader` for titles, subtitles, back actions, close actions, and trailing actions.
- Keep enabled tabs in one stable order: Today, Loads, Score, More. Existing fleet feature flags may
  omit Loads or Score; do not add more conditional tab behavior before resolving the exception in
  the implementation audit.
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
- Do not use raw React Native `Text` or legacy font utility aliases outside `AppText`.
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
| brand | `#14263F` | `#F4A340` | `#0B1830` | `#FFCB85` | sheet primary action fill + link/selected text |
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
| hero | `#14263F` | `#0A1422` | `#0B1830` | `#000000` | hero region, tab shell |
| hero-raised | `#1F3A5C` | `#172A42` | `#1A2D4A` | `#14243A` | cards on the hero |
| hero-edge | `#2E4866` | `#2A3F5B` | `#3B5170` | `#55677E` | 1px edge on hero cards, hero dividers |
| hero-tile | `#28425F` | `#213754` | `#26405E` | `#1E3048` | tiles inside hero cards |
| on-hero | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | primary text on hero |
| on-hero-secondary | `#B7C4D6` | `#B7C4D6` | `#D9E2EE` | `#EEF2F7` | ≥ 4.5 on hero and hero-raised |
| on-hero-muted | `#8394AB` | `#8394AB` | `#B7C4D6` | `#D3DCE7` | ≥ 4.5 on hero only |
| action | `#F4A340` | `#F4A340` | `#F4A340` | `#FFCB85` | amber fill: hero primary button, amber chips |
| action-pressed | `#E3912E` | `#E3912E` | `#D98420` | `#FFE0B3` | |
| action-fg | `#14263F` | `#14263F` | `#000000` | `#000000` | text on action **and on accent** |
| action-ink | `#A64E08` | `#F6B25E` | `#7A3A06` | `#FFCB85` | amber as text on sheet surfaces |
| action-soft | `#FDEBD2` | `#3A2A10` | `#FDEBD2` | `#3A2A10` | amber disc / soft chip fill |
| accent | `#CFCBF7` | `#CFCBF7` | `#CFCBF7` | `#DCD9FA` | lavender chip fill |
| accent-ink | `#4B44A8` | `#C3BEF5` | `#332C86` | `#DCD9FA` | lavender as text |
| accent-soft | `#F0EEFC` | `#262B52` | `#E4E1FA` | `#2F3670` | lavender disc fill |
| success-soft | `#DDF3E8` | `#153B2B` | `#DDF3E8` | `#153B2B` | green disc / chip fill |
| danger-soft | `#FBE3E0` | `#3E1B1B` | `#FBE3E0` | `#3E1B1B` | red disc / chip fill |

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
| label | 12 / 16, uppercase, +0.96 tracking | `Lexend_500Medium` | the one overline on a hero card |
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
- Elevation: `cardElevation(themeKey)` from `src/theme/elevation.ts` and nothing else. `lint:design`
  bans `shadowColor` outside `src/theme/`.

If a value is not represented by the token scale, first ask whether the component is actually a
new pattern. Do not silently add a one-off value.

## Component rules

### Use existing primitives first

Always check `src/components` before writing markup. The canonical primitives are:

- Layout: `Screen`, `ScreenHeader`, `SectionLabel`, `GroupedList`, `Card`, `ListRow`, `ActionBar`
- Typography: `AppText`
- Actions: `Button`, `IconButton`, `ConfirmSheet`
- Forms: `Field`, `Input`, `NumericField`
- Status and feedback: `Badge`, `Banner`, `Toast`, `OfflineBanner`, `SyncStatus`
- Progress and workflow: `Progress`, `TaskStepper`
- Data display: `Sparkline` and compact grouped metric rows.
- State handling: `Skeleton`, `EmptyState`
- Choice controls: `SegmentedControl`, `ToggleRow`

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

### Today

Today answers, in order: who is driving, what is current, what must happen next, what needs
attention, and what supporting context is useful. It is a state-driven mission-control surface,
not a dashboard or configuration page.

### Loads

Loads use the `ScreenHeader`, `OfflineBanner`, `SegmentedControl`, and canonical load cards. Upcoming,
current, and previous are a domain-specific pattern; do not replace it with a generic table.

### Score

Score uses a compact weekly scorecard, a linear progress cue, explainable grouped metric rows,
trends, coaching, and explicit empty/ineligible states. A score must never be presented without
its time period or meaning. Do not use a decorative ring or a grid of dashboard tiles.

### More and Settings

Use `SectionLabel`, `GroupedList`, and `ListRow` for grouped settings and account actions.
Destructive actions use `ConfirmSheet`, not native alerts.

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
