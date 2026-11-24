# Implementation-planning handoff

```text
/make-plan Redesign the Silvicom 360 Operations dashboard tab. Current design failed audit at 13/30 with a critical gap in principle #10 (as little design as possible) and weak scores in usefulness, aesthetics, understandability, thoroughness, and resource efficiency.

Verdict paragraph (quoted from 03-verdict.md):
> Operations should be redesigned at the information-architecture level: its data and component system are strong, but a 13/30 audit and a 0 on “as little design as possible” show that restyling the ten-card wall would preserve the central failure.

Why redesign and not refine: the page is structurally a ten-card wall with 33 repeated doors; changing color, radius, or shadows cannot create the missing operational priority hierarchy.

Primary user: a fleet manager or administrator responsible for whether the fleet can operate today.
Primary task: understand what is ready, what needs action now, and open the exact queue behind a count.
Constraints: preserve Vue/Tailwind and @silvicom/ui; existing permissions and query truthfulness; dark/light themes; one-click filtered drill-downs; WCAG AA; desktop and 390 px phone layouts.

Preserve from current design:
- Brand tokens and the shared AppCard, ChartCard, AppIconChip, and AppTabs primitives (`origin/main:apps/web/src/pages/DashboardPage.vue:168-265`; `origin/main:apps/web/src/components/ui/ChartCard.vue:41-77`).
- Permission-aware DoorLink visibility and unknown-as-dash behavior (`origin/main:apps/web/src/components/ui/DoorLink.vue:3-16`; `origin/main:apps/web/src/components/ui/CountList.vue:7-10,37`).
- One-click filtered destinations encoded by the ten current widgets (`origin/main:apps/web/src/components/ui/CountList.vue:40-64`).

Discard:
- Ten equal span-4 cards. Evidence: `origin/main:packages/shared/src/dashboardWidgets.ts:126-136`. Caused failures on principles #3 and #10.
- Literal text navigation arrows. Evidence: `origin/main:apps/web/src/components/ui/DoorLink.vue:19-26`. Caused failure on principle #8.
- Static mixed-window “today” summary and generic repeated action labels. Evidence: `origin/main:apps/web/src/pages/DashboardPage.vue:180-183` and audit E3. Caused weakness on principles #4 and #6.
- Eager dashboard-family loading. Evidence: `origin/main:apps/web/src/lib/dashboardWidgets.ts:22-44`. Caused weakness on principle #9.

Top 5 moves from the audit, verbatim:
1. Principles #2 and #10 — Useful and minimal: Replace ten equal cards with five intentional regions: a derived Operations lead line; a 5/4/3 first row for Fleet status, Needs action now, and Readiness; one full-width linked KPI strip for maintenance/safety/staffing; and a slim Fuel handoff to Fleet overview. Preserve every one-click filtered queue. Evidence: E1, E2.
2. Principles #3 and #5 — Aesthetic and unobtrusive: Use Fleet overview's editorial span rhythm and whole-cell links so short cards no longer inherit tall empty areas and routine work stops competing with urgent exceptions. Evidence: E1, E2.
3. Principles #4 and #6 — Understandable and honest: Replace the static “today” sentence with a derived operational lead line and rename jargon/actions to describe the destination; fix mixed-window wording and the 30/31-day mismatch. Evidence: E3.
4. Principle #8 — Thorough: Replace the literal DoorLink arrow once, centrally, with the existing AppIcon/ChevronRightIcon treatment; make action targets at least 24 px, give repeated links unique accessible names, and add explicit loading/error states. Evidence: E4, E5.
5. Principle #9 — Environmentally friendly: Lazy-load dashboard families by active tab and give OpsFuelWidget a narrow data hook so Operations does not pay for MapLibre or nine fuel requests it does not display. Evidence: E6.

Redesign principles in priority order:
1. Principle #2 — Useful: the top viewport answers whether the fleet can run and what requires action without scanning ten cards.
2. Principle #4 — Understandable: labels name the underlying page or action, jargon is expanded, and every time window is explicit.
3. Principle #10 — As little design as possible: no repeated link exists when the whole row/cell can be the target; no standalone card exists when a compact grouped region answers the same question.

Deliverables for the plan:
- New information architecture independent of the old equal-card grid.
- Desktop and 390 px low-fi primary-flow wireframes, side by side with current.
- A component/data mapping that preserves permissions and exact count-to-list contracts.
- DoorLink/icon migration inventory: raw navigation arrows become AppIcon + ChevronRightIcon through @silvicom/ui/icons; semantic from/to and trend arrows remain text/delta patterns.
- Loading, error, empty, success, focus, disabled, and reduced-motion checklist.
- Bundle/request budget and verification method; active Operations must not load MapLibre.
- Migration of saved custom layouts, with a deliberate reset/mapping decision and no recurring stale-layout notice.
- Cutover criteria: source tests, keyboard traversal, Axe, 1280/390 browser pass, dark/light screenshots, and count-to-filter equivalence tests.

Anti-patterns to guard against:
- Porting the ten-card wall under new styling.
- Hiding operational truth to make the page look sparse.
- Replacing semantic data arrows with navigation chevrons.
- Making urgent order user-customizable in a way that can bury safety or dispatch exceptions.
- Keeping eager imports because the current registry is convenient.
```
