# FuelGuard Driver App Design Contract

This document is the implementation contract for the FuelGuard driver app. It exists to prevent
new screens and components from drifting toward generic AI-generated mobile UI. Read it before
creating or changing any UI in `apps/driver`.

## Design System 2.0 transition

The redesign operating model and validation gates live in
[`DRIVER-APP-DESIGN-SYSTEM-2.md`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2.md).
The implemented token, typography, appearance, and accessibility foundation is recorded in
[`DRIVER-APP-DESIGN-SYSTEM-2-PHASE-2.md`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-2.md).
The implemented primitive migration and screen recomposition are recorded in
[`Phase 3`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-3.md) and
[`Phase 4`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-4.md). Their
compact-density, semantic-token, container, and task-hierarchy rules apply immediately.

## Product character

FuelGuard is an operational tool used by professional drivers in a moving vehicle, in daylight,
at night, with gloves, intermittent connectivity, and limited attention. The interface is calm,
glanceable, explicit, and trustworthy. It is not a marketing site, a social feed, or a generic
consumer dashboard.

The visual signature is:

- Platform UI typography for operational copy, with Hanken Grotesk reserved for screen identity,
  glanceable numerals, and limited display moments.
- HugeIcons SVG icons through the single `Icon` adapter.
- Graphite neutral surfaces with a deep cobalt FuelGuard action accent.
- Restrained borders and surfaces instead of decorative gradients or floating glass effects.
- Strong operational status communication: text + icon + tone, never color alone.
- Large, tabular, glanceable numbers for score, distance, time, fuel, and load data.
- Contextual work in modal routes; the four-tab shell remains stable.

Do not replace these traits with a bundled generic UI font, dashboard gradients, arbitrary
illustrations, emoji, or ad-hoc icon imports outside the semantic `Icon` adapter.

## Apple-inspired layout rules

These rules are an Apple Human Interface Guidelines interpretation for this product, not a claim
that Apple mandates one universal numeric grid.

### Safe areas and structure

- Every screen starts with `Screen`; do not hand-roll safe-area padding.
- Use `ScreenHeader` for titles, subtitles, back actions, close actions, and trailing actions.
- Keep the bottom tab shell stable: Today, Loads, optional Score, More.
- Use modal routes for contextual work such as load details, driving, capture, duty, and settings.
- Respect the device's safe areas and keyboard; never place essential content under system chrome.

### Spacing and layout

- Use a 4pt base quantum. Primary structural alignment uses 8, 16, 24, and 32pt; 12pt is reserved
  for tightly related content. Apple alignment does not require every dimension to be divisible by 8.
- Standard screen content margin: 16pt.
- Standard section separation: 24pt.
- Standard component gap: 16pt; use 12pt only within a related content group.
- Standard card padding: 16pt.
- Standard grouped-row minimum height: 52pt; content and Dynamic Type may make it taller.
- Standard interactive target: at least 44pt; FuelGuard primary driver actions use 48pt or 56pt.
- Standard grouped-container radius: 12pt. Use 10pt for controls, 16pt for a true operational hero,
  and 999pt only for pills, badges, avatars, and circular controls.
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
- A primary operational module should normally remain under 200pt at default text size. It may grow
  for content, accessibility, or safety copy; it may not grow for decoration.
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

- New or redesigned text uses `AppText` semantic variants. It supplies platform UI typography for
  operational copy and Hanken Grotesk for approved display/numeric roles.
- Do not use raw React Native `Text` or legacy font utility aliases outside `AppText`.
- Use semantic icon names through `src/components/Icon.tsx`; do not import HugeIcons directly in screens.
- Use the semantic type scale in `src/theme/tokens.ts`. Do not invent arbitrary text sizes for a
  one-off screen.
- Support Dynamic Type and readable text hierarchy. Do not cap content scaling to protect a fixed
  layout; make the layout wrap, grow, or stack. The icon component may remain a fixed glyph box.
- Respect Reduce Motion, Bold Text, and high-text-contrast platform preferences through
  `ThemeProvider`; primitives do not perform their own disconnected platform checks.
- Body text must remain readable in light and dark modes and in sunlight.
- Every icon-only control has an accessibility label.
- Every interactive element exposes an appropriate accessibility role and disabled/busy/selected state.
- Do not use color as the only indication of status, trend, error, or selection.

## Token contract

### Approved semantic colors

`src/theme/theme.roles.json` is the single color source. `ThemeProvider`, native API colors, and the
verified `global.css` fallback mirror consume it. Use only the semantic NativeWind roles defined in
that source and exposed through `tailwind.config.js`:

- Surfaces: `canvas`, `surface`, `surface-subtle`, `surface-muted`, `surface-raised`,
  `surface-selected`, `surface-inverse`
- Text: `ink`, `ink-secondary`, `ink-muted`, `ink-subtle`, `ink-disabled`, `ink-inverse`
- Borders: `edge`, `edge-subtle`, `edge-strong`, `edge-focus`
- Product: `brand`, `brand-pressed`, `brand-subtle`, `brand-fg`
- Status: `danger`, `warning`, `caution`, `success`, `info`
- Operations: `operation-current`, `operation-next`, `operation-complete`, `operation-blocked`
- Sync: `sync-local`, `sync-pending`, `sync-failed`

Raw color values belong only in `src/theme`. Screens and components use semantic classes. Never
use raw hex values, generic Tailwind palette classes, or inline color styles.

### Approved scales

Use `src/theme/tokens.ts` for non-color decisions:

- Spacing: 4, 8, 12, 16, 24, 32, 40pt, chosen by semantic relationship
- Radii: 10pt controls, 12pt grouped containers, 16pt operational heroes, and full only where semantic
- Targets: 44pt minimum, 48pt comfortable, 52pt grouped row, 56pt driving-critical action
- Type: semantic `AppText` roles, platform UI for operational copy, Hanken for display/numerals

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
- It passes `pnpm --filter @fuelguard/driver typecheck`.
- It passes `pnpm --filter @fuelguard/driver lint` and `lint:tokens`.
- It passes the relevant driver tests.
