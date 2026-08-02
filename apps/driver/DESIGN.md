# FuelGuard Driver App Design Contract

This document is the implementation contract for the FuelGuard driver app. It exists to prevent
new screens and components from drifting toward generic AI-generated mobile UI. Read it before
creating or changing any UI in `apps/driver`.

## Product character

FuelGuard is an operational tool used by professional drivers in a moving vehicle, in daylight,
at night, with gloves, intermittent connectivity, and limited attention. The interface is calm,
glanceable, explicit, and trustworthy. It is not a marketing site, a social feed, or a generic
consumer dashboard.

The visual signature is:

- Hanken Grotesk typography.
- HugeIcons SVG icons through the single `Icon` adapter.
- Semantic neutral surfaces with indigo FuelGuard brand accents.
- Restrained borders and surfaces instead of decorative gradients or floating glass effects.
- Strong operational status communication: text + icon + tone, never color alone.
- Large, tabular, glanceable numbers for score, distance, time, fuel, and load data.
- Contextual work in modal routes; the four-tab shell remains stable.

Do not replace these traits with Inter, Roboto, generic dashboard gradients, arbitrary illustrations,
emoji, or ad-hoc icon imports outside the HugeIcons adapter.

## Apple-inspired layout rules

These rules are an Apple Human Interface Guidelines interpretation for this product, not a claim
that Apple mandates one universal numeric grid.

### Safe areas and structure

- Every screen starts with `Screen`; do not hand-roll safe-area padding.
- Use `ScreenHeader` for titles, subtitles, back actions, close actions, and trailing actions.
- Keep the bottom tab shell stable: Home, Loads, Score, More.
- Use modal routes for contextual work such as load details, driving, capture, duty, and settings.
- Respect the device's safe areas and keyboard; never place essential content under system chrome.

### Spacing and layout

- Use the 8pt spacing grid for structure.
- Use 4pt only for micro-spacing inside controls, labels, and icon/text pairs.
- Standard screen content margin: 16pt.
- Standard section separation: 24pt.
- Standard component gap: 12pt.
- Standard card padding: 16pt.
- Standard list-row minimum height: 60pt.
- Standard interactive target: at least 44pt; FuelGuard primary driver actions use 48pt or 56pt.
- Standard card radius: 12pt. Use 8pt for controls and 999pt only for pills, badges, and avatars.
- Do not introduce arbitrary spacing, radius, or width values without a product-specific reason.
- Prefer full-width mobile layouts. Do not force desktop dashboard grids into the driver app.
- Keep primary actions reachable and visually dominant; secondary actions should not compete with them.

### Typography and accessibility

- Use the bundled Hanken Grotesk weights through the `font-sans-*` classes.
- Use semantic icon names through `src/components/Icon.tsx`; do not import HugeIcons directly in screens.
- Use the existing type scale. Do not invent arbitrary text sizes for a one-off screen.
- Support Dynamic Type and readable text hierarchy. The icon component may disable font scaling
  only because it renders a fixed glyph box; content text must remain scalable.
- Body text must remain readable in light and dark modes and in sunlight.
- Every icon-only control has an accessibility label.
- Every interactive element exposes an appropriate accessibility role and disabled/busy/selected state.
- Do not use color as the only indication of status, trend, error, or selection.

## Token contract

### Approved semantic colors

Use only the semantic NativeWind roles defined in `global.css` and `tailwind.config.js`:

- Surfaces: `canvas`, `surface`, `surface-subtle`, `surface-muted`, `surface-inverse`
- Text: `ink`, `ink-secondary`, `ink-muted`, `ink-subtle`, `ink-inverse`
- Borders: `edge`, `edge-subtle`, `edge-strong`
- Product: `brand`, `brand-fg`
- Status: `danger`, `warning`, `caution`, `success`, `info`

Raw color values belong only in `src/theme`. Screens and components use semantic classes. Never
use raw hex values, generic Tailwind palette classes, or inline color styles.

### Approved scales

Use `src/theme/tokens.ts` for non-color decisions:

- Spacing: 4, 8, 12, 16, 20, 24, 32pt
- Radii: 8, 12, 16pt and full-pill where semantically appropriate
- Targets: 44pt minimum, 48pt comfortable, 56pt primary CTA
- Type: xs, sm, base, lg, xl, hero using Hanken Grotesk weights

If a value is not represented by the token scale, first ask whether the component is actually a
new pattern. Do not silently add a one-off value.

## Component rules

### Use existing primitives first

Always check `src/components` before writing markup. The canonical primitives are:

- Layout: `Screen`, `ScreenHeader`, `SectionLabel`, `Card`, `ListRow`, `ActionBar`
- Actions: `Button`, `IconButton`, `ConfirmSheet`
- Forms: `Field`, `Input`, `NumericField`
- Status and feedback: `Badge`, `Banner`, `Toast`, `OfflineBanner`, `SyncStatus`
- Progress and workflow: `Progress`, `TaskStepper`
- Data display: `StatTile`, `ScoreRing`, `Sparkline`
- State handling: `Skeleton`, `EmptyState`
- Choice controls: `SegmentedControl`

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

### Home

Home answers, in order: who is driving, what is the duty state, what load is current/next, and what
needs attention. It is a glance surface, not a configuration page.

### Loads

Loads use the `ScreenHeader`, `OfflineBanner`, `SegmentedControl`, and canonical load cards. Upcoming,
current, and previous are a domain-specific pattern; do not replace it with a generic table.

### Score

Score uses large numerals, a score ring, trends, coaching, and explanatory empty/ineligible states.
A score must never be presented without its time period or meaning.

### More and Settings

Use `SectionLabel` plus `ListRow` for grouped settings and account actions. Destructive actions use
`ConfirmSheet`, not native alerts.

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

- A new color, font, icon set, radius, shadow, or spacing scale.
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
- It respects safe areas, the 8pt grid, and minimum touch targets.
- It uses Hanken Grotesk and the HugeIcons adapter.
- It has a realistic gallery or screen example.
- It passes `pnpm --filter @fuelguard/driver typecheck`.
- It passes `pnpm --filter @fuelguard/driver lint` and `lint:tokens`.
- It passes the relevant driver tests.
