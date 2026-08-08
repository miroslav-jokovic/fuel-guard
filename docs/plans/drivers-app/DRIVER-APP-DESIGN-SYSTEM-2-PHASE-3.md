# Driver App Design System 2.0 — Phase 3 Core Primitives

> Status: **Implemented; automated verification green**
>
> Owner surface: `apps/driver`
>
> Created: 2026-08-07

## Outcome

Phase 3 replaces the previous floating-card and oversized-dashboard defaults with a compact,
platform-aware component system. The change preserves workflow behavior while giving production
screens one consistent hierarchy, spacing model, and accessibility contract.

## Primitive decisions

### Semantic typography

`AppText` is now the production text API. Operational copy uses the platform UI typeface; Hanken
Grotesk is limited to screen identity and glanceable numbers. Text scales with the operating
system, rows grow with content, and component layouts wrap instead of protecting fixed heights.

### Grouped information

`GroupedList` owns a single surface with internal separators. `ListRow` is a flat 52pt-minimum row
inside that surface. Icons are direct semantic cues rather than decorative colored squares.
Settings, notifications, message threads, equipment rosters, metadata, and diagnostics use this
pattern instead of a card per record.

### Operational surfaces

`Card` is retained only for a real object or operational module. Its default has a restrained
hairline edge and no shadow. The 16pt-radius operational variant is reserved for current work or
duty state; raised surfaces are limited to navigation, sheets, and overlays.

### Actions and workflow

- `Button` uses 44pt, 48pt, and 56pt target tiers with no decorative shadow.
- `ActionBar` keeps one task action reachable above the safe area.
- `TaskStepper` communicates workflow position compactly without duplicating progress.
- `ConfirmSheet` replaces native alerts and supports content growth.
- `SegmentedControl` is reserved for small peer views or settings, not workflow steps.
- `ToggleRow` uses the native switch for binary preferences.

### Status and feedback

`Banner`, `OfflineBanner`, `SyncStatus`, `Badge`, `Toast`, and `Progress` share semantic theme roles.
Status always has text and/or an icon in addition to color. Offline copy says what remains usable,
what is stored locally, and what will happen when connectivity returns.

### Navigation and headers

`ScreenHeader` is a compact contextual header rather than a decorative hero. The tab bar exposes
visible labels, keeps 44pt-or-larger targets, and preserves the Today / Loads / Score / More order
among destinations enabled by the fleet. The stability tradeoff of omitting disabled destinations
is recorded in the implementation audit.

## Anti-generic rules now encoded

- No default card shadows.
- No icon-in-colored-square row decoration.
- No all-uppercase section labels.
- No unlabeled tab icons.
- No fixed-height presentation space around titles.
- No card-inside-card composition for ordinary information.
- No decorative metric grid as the default score pattern.
- No font-scale cap on operational text.

## Phase 3 exit checklist

- [x] Semantic text primitive implemented.
- [x] Grouped list and flat row primitives implemented.
- [x] Compact header and labelled tab bar implemented.
- [x] Action hierarchy and target sizes normalized.
- [x] Forms, feedback, sheets, progress, and workflow primitives migrated.
- [x] Reduce Motion honored by animated action and score primitives.
- [x] Gallery updated to demonstrate production patterns rather than decorative score tiles.
- [x] Driver typecheck and lint green.

## Phase 4 handoff

Production screens should be recomposed by driver state and task priority. The migration must
remove redundant containers and duplicate status/progress while preserving all loading, offline,
error, empty, and permission behavior.
