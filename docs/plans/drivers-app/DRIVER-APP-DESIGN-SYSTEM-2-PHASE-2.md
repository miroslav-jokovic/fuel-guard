# Driver App Design System 2.0 — Phase 2 Foundations

> Status: **Implemented; automated verification green**
>
> Owner surface: `apps/driver`
>
> Created: 2026-08-07

## Outcome

Phase 2 replaces the generic indigo/gray foundation with an operational cobalt/graphite system,
creates one semantic color source for every renderer, introduces platform-aware semantic
typography, and makes accessibility preferences available to every primitive. Workflows and screen
composition remain functionally unchanged until Phase 3 and the screen migration phases.

## Color architecture

`apps/driver/src/theme/theme.roles.json` is authoritative. It defines the same 33 roles for:

- Light
- Dark
- High-contrast light
- High-contrast dark

`colors.ts` derives both NativeWind variables and native API strings from that file. `global.css`
is a generated/fallback mirror checked by `check-driver-theme.mjs`; token lint fails if a theme,
role, value, or RGB channel drifts.

The palette uses graphite neutrals and a deep operational cobalt. Brand color is reserved for the
primary action, current work, selection, and focus—not generic decoration. Dedicated operational
and sync roles keep current/next/complete/blocked and local/pending/failed semantics stable as the
visual palette evolves.

## Typography architecture

Operational text uses the platform UI face. This improves native familiarity, legibility, Bold
Text behavior, and Dynamic Type rendering. Hanken Grotesk remains the product display face for:

- Screen identity
- Glanceable numeric values
- Compact numeric summaries
- Rare, deliberate brand moments

`AppText` is the semantic API. Its variants are caption, supporting, body, action,
navigationTitle, rowTitle, sectionTitle, screenTitle, numericCompact, and numericHero. It does not
cap font scaling by default. Legacy `font-sans-*` classes remain only to keep existing screens
stable during the Phase 3 migration.

## Layout and density tokens

- 4pt base quantum
- 8pt control relationships
- 12pt tightly related content
- 16pt component relationships
- 24pt workflow sections
- 32pt major regions
- 44pt minimum interactive target
- 48pt routine target
- 52pt default grouped row
- 56pt driving-critical action
- 10pt control radius
- 12pt grouped-container radius
- 16pt operational-hero radius

The previous `60pt row + card + shadow` combination is retained only as a compatibility recipe
until grouped lists land in Phase 3.

## Accessibility foundation

`ThemeProvider` now observes:

- System light/dark appearance
- High-text-contrast preference
- Reduce Motion
- Bold Text

It exposes one resolved `themeKey`, so native colors and class-based colors cannot disagree. Button
press scaling and the Score reveal already honor Reduce Motion; the remaining animated primitives
join this contract during Phase 3.

## Platform icon strategy

Screens continue to request semantic names from `Icon`. No screen imports a glyph library. The
current backend remains HugeIcons during the visual migration; the adapter is the permanent
contract and can later map selected navigation symbols to platform-specific glyphs without changing
screen code.

## Verification matrix for the final visual pass

| Axis | Required configurations |
| --- | --- |
| Appearance | Light, dark, high-contrast light, high-contrast dark |
| Text | Default, largest common accessibility size, maximum accessibility size |
| Motion | Standard and Reduce Motion |
| Weight | Standard and Bold Text |
| Device | Small iPhone, current large iPhone, min-spec Android, large Android, tablet |
| Layout | Portrait, landscape where supported, keyboard visible, system bars edge-to-edge |
| Connectivity | Online, cached offline, queued local write, failed/dead-letter write |
| Input | Touch, one-handed reach, hardware keyboard where supported |

## Phase 2 exit checklist

- [x] Single semantic color source implemented.
- [x] Light and dark palette updated from indigo/gray to operational cobalt/graphite.
- [x] High-contrast light and dark roles implemented.
- [x] CSS/native role parity check implemented.
- [x] Semantic typography metrics implemented.
- [x] Platform UI plus Hanken display strategy implemented.
- [x] Dynamic-Type-safe `AppText` foundation implemented.
- [x] Reduce Motion, Bold Text, and high-contrast preferences exposed through the theme.
- [x] Color contrast and theme-resolution tests implemented.
- [x] Existing Android safe-area correction preserved.
- [x] Driver typecheck and automated tests green.

## Phase 3 handoff

Phase 3 replaces generic presentation primitives with the new core system: semantic text migration,
labelled tab navigation, grouped lists and rows, restrained containers, compact headers, status
strips, task action bars, operational route primitives, and accessible sheets. Screen-level
recomposition begins only after those primitives are available.
