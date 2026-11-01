# Sidebar redesign

Owner's request, 2026-11-01: *"analyze our sidebar and give me a proposal how we can design this
sidebar to be more UI/UX better, more modern and easier to use"*. The proposal went back the same
day; the owner said *"proceed as suggested and recommended"*, with one change: **Recruitment stays
its own section** — *"it has one item now but I am planning to add more items there"*.

## 1. What was measured (origin/main e18a545, 2026-11-01)

- An admin with every module sees **36 links in 8 labelled sections** plus Dashboard / Ask AI /
  Chat. Every section started **open** (phase 6 made them collapsible; the default stayed open).
- Rows were 40 px plus section headers: about **2,000 px of sidebar against ~800 px of window**,
  so an admin saw less than half of it at once.
- The only way to anywhere was scrolling. DESIGN-REFRESH-2026-09 D-DR16 split the comps' ⌘K bar
  off as "a feature, not a style" and it was never built. About twenty Settings screens (EFS, Card
  control, Audit log…) were reachable only through the Settings directory.
- Placement that did not match the content: **Alerts** (`/anomalies`, "fuel-card fills that look
  wrong") and **Idling** sat under Safety; their routes live in `routes/fuel.ts`.
- Names that collide: Messages (driver inbox) beside Chat (office chat); Invoices (customer billing)
  beside Pilot invoices (fuel). Mixed capitalisation ("Fuel Log", "Truck Stops" beside "Pilot
  invoices", "Fuel problems").
- The collapse control was in the top bar, on the far side of the page from the sidebar.
- `AppShell.vue` drew the list **three times** (drawer, expanded, rail), at 494 lines.
- Settings appeared twice, 40 px apart (the Admin group and the account menu).

## 2. Decisions

**D-SB1 — "Go to a page" with ⌘K / Ctrl K, and a "Search pages" field at the top of the sidebar.**
Lists the caller's sidebar plus the Settings screens their Settings page shows
(`visibleSettingsScreens`, moved out of `SettingsPage.vue` so both read one function). No list of
its own, so it cannot offer a page the guard refuses. Page names only — records are Q-SB1.
`lib/commandPalette.ts`, `layouts/sidebar/CommandPalette.vue` (headless UI Combobox in a Dialog).

**D-SB2 — Pinned (up to 6) and Recent (last 3) at the top.** Per device in `localStorage`
(`fg.sidebar-pinned`, `fg.sidebar-recent`), stored as surface KEYS and resolved against the live
sidebar every render, so a pin can never outlive a permission. A seventh pin is refused, not
evicted; the control says so. `lib/sidebarShortcuts.ts`, `composables/useSidebarShortcuts.ts`.

**D-SB3 — Sections start closed, except the one holding the current page.** Explicit answers per
group KEY in `fg.sidebar-sections` (the phase-6 key held labels and meant the opposite, so it is no
longer read). Arriving in a section you had closed reopens it; closing the one you stand in is
allowed. `composables/useSidebarSections.ts`.

**D-SB4 — Group order and the footer.** Order is Dispatch · Fuel · Safety · Recruitment · Fleet ·
Maintenance · Finance (by daily use), then **Admin as a `footer` group**: Settings and Users are
drawn in the fixed footer above the account and never scroll away. The account menu's own Settings
link is removed (it was the second door to the same place). `SurfaceGroup.footer`.

**D-SB5 — Fuel alerts and Idling move to Fuel; twelve labels renamed.** Keys and gates unchanged:
where an item sits is navigation, where it is gated is not. A safety-only role therefore sees a
Fuel section holding just these two — the honest place, and the same trade the Odometer entry made
on 2026-10-03. Renames: Cards → Fuel cards, Alerts → Fuel alerts, Messages → Driver messages,
Invoices → Customer invoices, Odometer → Odometer mismatches (its page title), and sentence case for
Fuel log, Fuel costs, Fuel planning, Truck stops, Driver performance, Drug & alcohol, Driver
qualification. Route titles moved with them, and a new test ("every sidebar entry's route has the
entry's label as its title") keeps the two copies equal — it found three pre-existing mismatches.
**Recruitment keeps its own section** (owner, above). "Trucks & trailers" under Maintenance keeps
its name (it came from the owner's maintenance redesign).

**D-SB6 — One sidebar component, and the desk density.** `layouts/sidebar/AppSidebar.vue` renders
the drawer, the open sidebar and the rail; `SidebarNavItem.vue` is the one row. The collapse control
moved into the sidebar header (the rail's logo turns into it on hover/focus). Rows are 36 px at a
desk and 44 px on touch (`usePhoneFirst`'s `touch`, and always in the phone drawer). Section headers
wear the section's icon, the one the rail already shows. `AppShell.vue` 494 → ~360 lines.

**D-SB7 — Ask AI moves from ⌘K to ⌘J.** Ask AI took ⌘K in AUDIT W6 because "no command palette
exists for it to collide with". The browser pass found both opening at once on one keypress. ⌘K is
the go-to-page key in nearly every product people already use, so the palette keeps it, and the
assistant moved to ⌘J, a key AI assistants elsewhere commonly use. Its button label and tooltip say ⌘J.

## 3. Open questions

- **Q-SB1 — Search records, not just pages?** Typing a unit number, a driver name or a load number
  and landing on it. Needs one search endpoint with per-row org and section filtering (the service
  role bypasses RLS) and a decision on which record types. Recommendation: trucks, trailers,
  drivers and loads first, behind the same palette, as its own plan.
- **Q-SB2 — Should pins follow a person between devices?** Today they are per device, like the
  colour scheme. Moving them server-side needs a table, an RLS policy and a retention answer.
  Recommendation: wait until somebody asks.
- **Q-SB3 — Fuel alerts and Fuel problems overlap.** Both hold card fraud since F02–F04 chunk 8c4.
  Now that they sit side by side in Fuel the overlap is visible. Recommendation: a product decision
  on whether Fuel alerts folds into Fuel problems; not a sidebar change.
- **Q-SB4 — "Vehicles" or "Trucks"?** Fleet reads Vehicles · Trailers · Drivers. "Trucks" is the
  office's word, but the page's own text says vehicles throughout. Left as Vehicles.

## 4. Progress log

- **2026-11-01** — Built D-SB1..D-SB6 on `claude/sidebar-redesign`. The 26 moved nav snapshots
  were verified by script (every snapshot parsed old/new into path → group, label): no role gained
  or lost a page in any of the 32; the only group changes are `/anomalies` and `/idling`; the only
  label changes are the twelve above.
- **2026-11-01, browser pass** (built app, dev-bypass admin, light/dark, 1440 and 390 wide, the rail
  and its flyout, the phone drawer, pin → navigate → Pinned + Recent, ⌘K "card" → Enter opened Card
  control). Found the ⌘K collision (D-SB7), fixed. The Card control page drew its error state in the
  pass because the stub answered `[]` where the page reads `data.settings`: the fixture, not this
  branch, which does not touch that page.
