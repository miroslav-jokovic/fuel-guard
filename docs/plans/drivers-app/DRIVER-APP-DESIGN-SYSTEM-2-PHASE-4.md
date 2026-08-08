# Driver App Design System 2.0 — Phase 4 Screen Recomposition

> Status: **Implemented and code-audited; owner device review deferred until the full visual pass**
>
> Owner surface: `apps/driver`
>
> Created: 2026-08-07

## Outcome

Phase 4 applies the new system across the production Driver app. The visual model combines route
clarity, operational state, and company-driver support without copying any benchmark product. The
result is a dense driver mission-control interface: current work first, one obvious next action,
and supporting detail grouped beneath it.

## Screen changes

### Today and shell

- Home is now **Today**.
- Greeting/hero treatment was removed.
- Active work precedes duty when a load is in progress; duty leads pre-shift and between loads.
- Current route, next stop, appointment, progress, and Continue action share one operational module.
- Score is a compact weekly context row below work, not a dashboard tile grid.
- Messages, notifications, and settings remain reachable as labelled accessibility targets.

### Loads and stops

- Loads are ordered Current / Upcoming / History.
- Load cards use one stable route rail and one status treatment.
- Load detail uses one grouped itinerary instead of a card per stop.
- Task state is expressed once; duplicate step and progress treatments were removed.
- The current task action is pinned above the safe area.
- Stop proof uses one grouped photo checklist, a compact completion action, and explicit local-save
  feedback.

### Duty and equipment

- Off-duty and on-duty states use compact operational modules.
- Truck and trailer rosters use grouped selection rows.
- Review and end-shift summaries use grouped information rather than nested cards.
- Primary shift actions remain pinned and usable offline.

### Score

- Decorative score ring and side-by-side tiles were removed from production composition.
- The weekly scorecard combines score, period context, fleet rank, trend, and linear progress.
- Metrics are explainable grouped rows with compact trends and sparklines.
- Coaching is a single next-opportunity message.

### More, settings, notifications, and messages

- More contains only working destinations; placeholder “coming soon” rows were removed.
- Settings groups account, data, appearance, diagnostics, and session actions.
- Theme and contrast choices use the same semantic theme source as native renderers.
- Notification preferences use native switches; required safety notifications are explicitly locked.
- Notification and message records are grouped rows rather than individual cards.
- Message report reasons use a grouped choice surface.

### Hazmat and authentication

- Hazmat capture has one pinned scanner action, concise quality guidance, and honest offline state.
- Findings, flags, and verdicts use grouped operational information rather than result cards.
- Sign-in and invitation flows use a compact, left-aligned enterprise identity block.
- Pending and wrong-app gates keep their actions next to the explanation instead of creating a
  large decorative void.

## Density audit

The production composition follows these limits at default text size:

- 16pt screen inset and component relationship spacing.
- 24pt only for real workflow regions.
- 52pt minimum grouped rows; content may grow for Dynamic Type.
- 56pt driving-critical actions.
- Current-work modules are content-derived, keep their primary action visible, and contain no
  fixed-height decorative filler.
- Empty states occupy only the content and action they need.
- Shadows are limited to raised navigation, sheets, and overlays.
- Horizontal operational layouts stack at the shared large-text breakpoint instead of compressing
  or truncating content.

## Preserved behavior

The redesign does not change API contracts, authorization, feature flags, outbox semantics, route
ownership, notification deep links, or capture decision logic. Cached/offline, loading, empty,
error, ineligible, and destructive-confirmation states remain represented.

## Automated acceptance

- [x] Theme role parity across four resolved themes.
- [x] Design token and semantic color checks.
- [x] Driver design-contract check.
- [x] TypeScript typecheck.
- [x] ESLint.
- [x] Driver unit tests.
- [x] Git whitespace check for the redesign diff.

The audited suite contains 12 test files and 83 tests. See the
[`implementation audit`](./DRIVER-APP-DESIGN-SYSTEM-2-AUDIT.md) for the corrected assumptions,
remediation matrix, and remaining product decisions.

## Owner visual review gate

Owner testing remains intentionally deferred until this assembled pass. Review the complete app on
at least one physical iPhone and one physical Android device, then log only actionable visual or
workflow issues. The first pass should cover default and large text, light and dark appearance,
online and airplane mode, keyboard-visible forms, and an active-load state. This gate validates the
visual system; it does not reopen unrelated workflow or backend scope.
