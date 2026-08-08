# Driver App Design System 2.0 — Implementation Audit

> Status: **Code audit complete; physical-device review remains the final visual gate**
>
> Audited: 2026-08-07
>
> Scope: `apps/driver`

## Result

The implemented redesign is internally consistent after remediation. The audit found real gaps in
contrast coverage, platform accessibility preference handling, large-text layout, bottom spacing,
touch targets, semantic form labelling, and several error/feature states. Those code-level gaps are
fixed. No production content surface uses decorative shadows, fixed promotional whitespace, or an
invented height target.

The audit also rejected one earlier assumption: a 200pt maximum for an operational module was not an
Apple rule and was not safe for Dynamic Type or safety copy. Operational modules now derive height
from content and keep the next action visible without decorative filler.

## Audit baseline

The implementation was checked against the current Apple guidance for
[layout and safe areas](https://developer.apple.com/design/human-interface-guidelines/layout),
[accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/),
[typography and Dynamic Type](https://developer.apple.com/design/human-interface-guidelines/typography),
[tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), and
[sheets](https://developer.apple.com/design/human-interface-guidelines/sheets). Platform preference
handling follows the current React Native
[AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo) contract.

FuelGuard's numeric grid remains a product design decision, not a claim that Apple mandates an 8pt
grid. The approved structural rhythm is 4, 8, 12, 16, 20, 24, 32, and 40pt. Two-point adjustments are
limited to optical text/icon alignment and hairlines.

## Confirmed findings and remediation

| Area | Finding | Resolution |
|---|---|---|
| Color | Standard `ink-subtle` and light success roles missed or narrowly failed contrast on real tinted surfaces. The original test covered too few backgrounds. | Corrected roles and expanded the test matrix across every content surface, semantic status role, inverse surface, danger action, and pressed primary action in all four themes. |
| Color hierarchy | Standard muted and subtle text technically passed but were visually almost identical. | Widened the muted/subtle tonal steps in light and dark themes without dropping below the contrast gate. |
| Appearance | Theme and contrast settings were session-only; the status bar did not follow the resolved theme. | Persisted preferences, added a bounded startup fallback, and made the status bar theme-aware. |
| Platform accessibility | The theme queried Android high-text-contrast on iOS. Bold Text was collected but unused. | iOS now follows darker-system-colors; Android follows high-text-contrast. `AppText` responds to Bold Text and motion primitives respond to Reduce Motion. |
| Safe areas | Tab scenes could count the bottom inset twice, while an 88pt scroll tail created decorative empty space. | Centralized top/bottom rules, made tab scenes tab-bar-aware, and reduced content tails to one real section. Footers own their safe-area inset. |
| Keyboard | Pinned task actions could be covered when a form keyboard opened. | The screen shell now moves iOS footers above the keyboard while keeping content scrollable. |
| Section rhythm | Section labels inherited the same 16pt gap above and below, weakening grouping. | Canonical rhythm is now 24pt before a new section and 8pt from label to its content. Nested labels use an explicit compact mode. |
| Dynamic Type | Titles, segmented choices, metric rows, paired actions, route timestamps, auth gates, and force-update copy could truncate, compress, or overflow. | Removed title caps, made fixed gates scroll, and introduced one shared large-text breakpoint that stacks constrained horizontal layouts without enlarging default-state whitespace. |
| Sheets | Confirmation content and actions could overflow at large text sizes. | The sheet respects the top and bottom safe areas, scrolls when needed, responds to Reduce Motion, and uses leading Close/Back placement consistent with the route depth. |
| Targets | The Today avatar, password reveal controls, and development bypass had targets below or ambiguously below 44pt. | All now expose at least a 44pt target; routine inputs/actions remain 48pt and driving-critical actions 56pt. |
| Forms | Visible field labels were not automatically associated with their inputs. | `Field` now supplies the label, hint, error, and invalid state to `Input` and `NumericField` semantics. |
| Semantics | Static rows could announce as actions; actionable banners could consume their nested button; switch labels could duplicate focus. | Static rows render as grouped views, actionable banners expose the action separately, and switches own the combined title/hint state. |
| State truth | Duty, end-shift, and hazmat verdict paths could imply a valid state when their query had failed. | Added explicit error/retry states and blocked equipment swap submission when the current shift cannot be verified. |
| Feature routes | Hidden Score had no reliable detail entry; More advertised support without a route; hidden modules could still initialize queries or open through direct links. | More exposes working Score and Messages destinations when enabled. Loads, Score, Messages, Notifications, and Hazmat now align visibility, query activation, bootstrap loading, and direct-route guards. |
| Development surfaces | The component gallery link was hidden in production, but its direct route remained reachable. | The gallery now redirects outside development builds, matching the existing navigation guard. |
| Mutation feedback | Notification read failure was optimistic and silent; repeat actions remained active while pending. | Restored the previous cache on failure, surfaced the error, and disabled mark-read, preference, and sync controls while their mutation is active. |
| Copy accuracy | Some unavailable-load states instructed people to pull-to-refresh even though no refresh gesture exists. | Recovery copy now points to the actual Loads refresh path. |
| Density | An invented operational-module height and oversized bottom tail could create generic empty space. | Removed both. Empty states, auth gates, and update gates remain compact and content-led while still scrolling at large text. |

## Guardrails added or strengthened

- Semantic color parity is checked for 4 themes × 33 roles.
- Contrast tests cover primary, secondary, muted, subtle, product, status, operation, and sync roles
  on every supported content surface.
- The design-contract check rejects raw text primitives, arbitrary type and structural spacing,
  generic shadows, raw color ramps, and native confirmation alerts.
- The shared large-text breakpoint prevents future screens from inventing different stacking rules.
- `DESIGN.md` records the exact section, safe-area, touch-target, density, and optical-spacing rules.

## Intentional exceptions and unresolved decisions

These are not hidden code defects; they need product or device-level validation.

1. **Feature-controlled tab visibility.** Apple recommends stable, predictable tab availability.
   FuelGuard currently removes Loads and Score when the fleet disables them. That is an existing
   product decision and can change tab positions between fleets or after first bootstrap. The code
   handles hidden Score navigation, but resolving the HIG conflict requires choosing either a stable
   four-tab shell with disabled/educational destinations or the current entitlement-driven shell.
2. **Portrait-only orientation.** Apple recommends supporting both orientations when practical but
   allows a single orientation when the experience requires it. Portrait-only is defensible for a
   mounted, task-focused driver workflow, but it needs explicit product sign-off and an accessibility
   device check rather than being treated as an accidental default.
3. **Required-update recovery action.** The gate explains that an update is required but has no
   store, MDM, or enterprise-distribution action because no canonical destination is configured.
   Adding one requires the deployment channel decision; until then, this remains a recovery UX gap.
4. **Physical validation.** Static checks cannot prove actual Hanken rendering, device safe areas,
   keyboard transitions, VoiceOver/TalkBack order, sunlight legibility, or native scanner chrome.
   These remain the owner review gate, not assumed passes.
5. **Localization and RTL.** This redesign preserves the current English-only product scope. If
   additional locales are planned, text expansion, locale formatting, and RTL mirroring need a
   separate content and device pass before those locales ship.

## Verification

- `pnpm --filter @fuelguard/driver typecheck`
- `pnpm --filter @fuelguard/driver lint`
- `pnpm --filter @fuelguard/driver lint:tokens`
- `pnpm --filter @fuelguard/driver lint:design`
- `pnpm --filter @fuelguard/driver test` — 12 files, 83 tests
- `git diff --check`

## Physical-device review priorities

Run the assembled app on at least one physical iPhone and one physical Android device:

1. Today with current work, three header actions, and default text.
2. The same state at a large accessibility text size; confirm stacked modules do not create clipped
   copy or unreachable actions.
3. Light, dark, high-contrast, Bold Text, and Reduce Motion.
4. Check-in, end-shift, stop proof, and message composition with the keyboard visible.
5. Online to airplane mode to reconnect, including one failed notification mutation.
6. VoiceOver/TalkBack order for headers, grouped rows, fields, switches, tabs, and confirmation sheets.
7. Bright-cab and night-cab legibility at realistic screen brightness.
