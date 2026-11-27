# Verdict: REDESIGN

Operations should be redesigned at the information-architecture level: its data and component system are strong, but a 13/30 audit and a 0 on “as little design as possible” show that restyling the ten-card wall would preserve the central failure.

## Highest-leverage moves

1. **Principles #2 and #10 — Useful and minimal:** Replace ten equal cards with five intentional regions: a derived Operations lead line; a 5/4/3 first row for Fleet status, Needs action now, and Readiness; one full-width linked KPI strip for maintenance/safety/staffing; and a slim Fuel handoff to Fleet overview. Preserve every one-click filtered queue. Evidence: E1, E2.
2. **Principles #3 and #5 — Aesthetic and unobtrusive:** Use Fleet overview's editorial span rhythm and whole-cell links so short cards no longer inherit tall empty areas and routine work stops competing with urgent exceptions. Evidence: E1, E2.
3. **Principles #4 and #6 — Understandable and honest:** Replace the static “today” sentence with a derived operational lead line and rename jargon/actions to describe the destination; fix mixed-window wording and the 30/31-day mismatch. Evidence: E3.
4. **Principle #8 — Thorough:** Replace the literal DoorLink arrow once, centrally, with the existing AppIcon/ChevronRightIcon treatment; make action targets at least 24 px, give repeated links unique accessible names, and add explicit loading/error states. Evidence: E4, E5.
5. **Principle #9 — Environmentally friendly:** Lazy-load dashboard families by active tab and give OpsFuelWidget a narrow data hook so Operations does not pay for MapLibre or nine fuel requests it does not display. Evidence: E6.

## Preserve

- Brand tokens, dark/light themes, AppCard/ChartCard/AppIconChip/AppTabs primitives (E2, E7).
- Permission-aware visibility and truthful unknown-as-dash behavior (E7).
- One-click count-to-filtered-list navigation (E1, E7).
- The curated icon barrel at `@silvicom/ui/icons` (E4).

## Discard

- The ten-card, all-span-4 catalogue (`origin/main:packages/shared/src/dashboardWidgets.ts:126-136`).
- Literal navigation arrows (`origin/main:apps/web/src/components/ui/DoorLink.vue:25`).
- Repeated generic door labels and the static mixed-window “today” summary (E3).
- Eager loading of every dashboard family (`origin/main:apps/web/src/lib/dashboardWidgets.ts:22-44`).

