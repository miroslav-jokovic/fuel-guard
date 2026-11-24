# Evidence

## E1 — Structure and task flow

- Operations registers ten widgets, all at span 4, so desktop renders three equal columns and an orphan tenth card (`origin/main:packages/shared/src/dashboardWidgets.ts:112-136`). Fleet overview uses 5/4/3, then 12, then 6/6, creating a visible reading order (`origin/main:packages/shared/src/dashboardWidgets.ts:138-144`).
- A fully entitled default Operations surface exposes up to 37 controls: three tabs, Customize, and 33 card destinations. The primary flow from a count to its filtered list is one click (`origin/main:apps/web/src/features/dashboard/TabWidgets.vue:187-245`; `origin/main:apps/web/src/components/ui/CountList.vue:40-64`).
- The deepest common path is eight component boundaries: DashboardPage -> TabWidgets -> widget -> ChartCard -> BaseCard -> CountList -> DoorLink -> RouterLink.
- Live screenshot: the first row equalizes all cards to the height of “Needs a hand now,” leaving large empty lower areas in “Fleet right now” and “Driver files.” About 31% of the viewport appears before the first card.
- The ten cards expose 33 count rows/doors and at least 132 semantic row items before headers and readouts are counted.

## E2 — Visual system

- Operations already shares Fleet overview's PageHeader, AppTabs, ChartCard, AppCard, icon chips, spacing tokens, card edges, and typography (`origin/main:apps/web/src/pages/DashboardPage.vue:168-265`; `origin/main:apps/web/src/components/ui/ChartCard.vue:41-77`).
- Observed spacing scale: 2, 4, 6, 8, 12, 16, 20, 24 px. Type scale: 11, 12, 14, 18, 24, 30 px.
- Operations repeats one visual anatomy ten times; Fleet overview deliberately varies chart cards, an attention rail, a full-width KPI strip, a segmented/ranked panel, and a savings panel.
- Primary token contrast passes WCAG AA in both themes: ink/surface 13.71:1 light and 14.41:1 dark; tertiary text 5.65:1 and 6.46:1; link 6.98:1 and 7.13:1.
- The visual defect is hierarchy, not palette: urgent road issues, compliance debt, routine staffing, fuel context, and hiring all receive equal weight.

## E3 — Copy and honesty

- Direct wording is generally honest. “Live, every minute” is backed by a 60-second refresh; count-to-list links target the queue being counted.
- Clarity gaps include “Seats,” “HOS low,” “No GPS,” “OOS,” and generic repeated verbs such as “Review.” Plain alternatives are “Truck assignments,” “Low drive time remaining,” “No recent truck location,” “out of service,” and destination-specific action labels.
- Label mismatches: “Dispatch board” opens the route labelled Assignments; “Cases” opens Alerts; “Trucks” opens Vehicles. The static shell says “today” while Fuel covers a rolling period and Roadside covers 90 days.
- The Fuel card constructs an inclusive today-minus-30 through today window but labels it “Last 30 days,” yielding 31 dates (`origin/main:apps/web/src/features/dashboard/widgets/OpsFuelWidget.vue:23-49`).
- No dark patterns, manufactured urgency, hidden cost, or confirm-shaming were found.

## E4 — Arrows and interaction detail

- Every dashboard door appends a literal text `->` glyph in one shared component (`origin/main:apps/web/src/components/ui/DoorLink.vue:19-26`). Operations repeats it up to 33 times.
- The existing curated icon barrel maps `ArrowRight01Icon` to `ChevronRightIcon` (`origin/main:packages/ui/src/icons.ts:64-71`). Existing compact implementations use AppIcon at 12–16 px, including BreadcrumbTrail and AssistantThread.
- The canonical change is local: make DoorLink a `group inline-flex items-center gap-1` link and render `AppIcon :icon="ChevronRightIcon"` at 12 px for compact metadata links or 16 px for ordinary actions, with optional `group-hover:translate-x-0.5`.
- Keep arrow text when it means data transformation, before/after, a route, or a period. Keep ChevronDown/Right for disclosure, paired ChevronLeft/Right for pagination, and the existing hidden-from-AT delta glyphs for trends.
- DoorLink's approximate 20 px height is below WCAG 2.5.8's 24 px target floor unless the spacing exception applies; the redesign should provide a 24 px minimum hit target.

## E5 — States and accessibility

- Empty, focus, and disabled states exist. Loading is only an em dash; card-level error UI is missing; success exists only for dashboard customization.
- Skip link, banner, primary navigation, main landmark, and dashboard-view navigation are present.
- All actions are keyboard reachable, but a maximum configuration produces 33 consecutive link stops, including duplicate accessible names such as “Review,” “Drivers,” and “Vehicles.”
- A redesign should preserve direct links while making compact KPI cells or rows the whole click target, reducing duplicate link stops and names.

## E6 — Weight and attention cost

- Inspected build: 2,621,840 raw JS bytes / 767,458 gzip bytes across 35 static JS files. The eagerly imported MapLibre chunk is 1,030,227 raw bytes even when Operations shows no map (`origin/main:apps/web/src/lib/dashboardWidgets.ts:22-44`).
- Cold fully entitled Operations mount is estimated at 23 application-data requests; minimum cold total about 63 requests. Estimated TTI is about 1.3 seconds on a nominal 10 Mbps connection; this is not a measured production trace.
- OpsFuelWidget invokes the broad Fleet widget data composition and accounts for nine inferred data requests despite showing only MPG, open cases, and idle hours.
- Idle animation count is zero; dark mode and focus tokens are honored.

## E7 — Preserved strengths

- One click opens the exact filtered queue behind a count.
- Unknown data renders as a dash instead of a dishonest zero (`origin/main:apps/web/src/components/ui/CountList.vue:7-10,37`).
- Permissions hide unavailable doors without hiding truthful dashboard figures (`origin/main:apps/web/src/components/ui/DoorLink.vue:3-16`).
- The shared token, card, icon-chip, tab, and route-gating systems are sound and should survive the redesign.

