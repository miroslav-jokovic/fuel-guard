# Driver App — PM Decision Record (2026-08-07)

Resolves the six open decisions in `DRIVER-APP-HARDENING-PLAN.md` Part V, plus three new decisions
surfaced by the research. Each decision states the choice, the evidence (Samsara as the reference
model where applicable, plus what was verified in the FuelGuard code — nothing assumed), and the
implementation impact. These are locked unless Miki overrules.

**Samsara reference model, in one paragraph (researched):** admins configure the Driver App from
the dashboard (Settings → Fleet → Driver App): granular feature toggles — messaging, maps, HOS,
DVIRs, routes, documents, team driving, **driver scores**, trip logs — where a disabled feature
simply doesn't appear in the driver's app; per-driver restrictions limit which assets a driver can
see/select; workflows prompt task sequences at sign-in or stops. Messaging: dispatchers use a
Messages icon in the dashboard with an unread counter, message one driver or many (by selection or
tag), history shows 90 days in dashboard / 30 in the app / 6 months via API, messages can never be
deleted, and the driver app blocks reading messages while actively driving. Role changes to fleet
settings sit with admin-level roles; prebuilt roles are fixed and finer control comes from custom
roles.

---

## D-PM1. Loads tab during testing — **controllable block, OFF for our org until Loads ships**

**Decision:** `tab.loads` is a real catalog feature (module: dispatch). Catalog default: **ON**
where the dispatch module is entitled — a new customer with dispatch gets the normal app. For our
own org, dispatch flips it **OFF now** and back on when the Loads module is finished.
**Scope detail (new, so the app stays coherent):** the flag hides the Loads tab, the `loads/*`
routes, **and Home's "Active work / Next assignment" section** — a hidden tab with a live Home load
card would be half-off, which is worse than either state. Hazmat is unaffected (standalone route,
Phase 3).
**Why:** exactly the Samsara pattern — disabled features simply don't appear. This also turns "our
loads module isn't finished" from a code problem into a config state, which is the whole point of
the block model.
**Impact:** Phase 4.5 consumes it in three places (tab bar, route guard, Home sections); Phase 5.1
exposes the toggle.

## D-PM2. Odometer policy — **default `optional`; `required` recommended for orgs without telematics; telematics-verified where Samsara is connected**

**Decision:** `duty.odometer` config: `off | optional | required`, catalog default **`optional`**.
Dashboard guidance text on the toggle: orgs **without** a telematics feed should set `required`
(the manual entry is their only MPG anchor); orgs **with** the Samsara integration connected should
keep `optional` or set `off`, because the authoritative odometer already flows in.
**Evidence (verified in code, not assumed):** FuelGuard already has a full Samsara integration
(`lib/samsara.ts`, schedulers, reconciliation service) and already stores `samsara_odometer`
alongside driver-entered `odometer` on fuel transactions — `askData.ts` even ships an
"entered vs. Samsara reading, mismatch > 5 mi" accuracy metric. Samsara itself auto-captures
odometer from the vehicle gateway and treats manual entry as the no-gateway fallback.
**Follow-up (cheap, high-value):** where telematics is connected, verify the driver's check-in
entry against the telematics reading using the existing >5 mi mismatch convention and surface
discrepancies on the dispatch Assignments board — turning manual entry from busywork into a
cross-check. (Phase 8 backlog item, not critical path.)
**Impact:** Phase 1.4 reads the config; Phase 4.3 catalogs it; Phase 5.1 exposes it with the
guidance copy.

## D-PM3. Score tab — **controllable, default ON**

**Decision:** `tab.score` is a catalog feature (module: core-adjacent — no purchase required),
default **ON**. Hiding it hides the tab and Home's "This week" tiles together (same coherence rule
as D-PM1).
**Why:** Samsara explicitly makes **driver scores** one of its admin toggles — score visibility is
a fleet-culture decision (some fleets run leaderboards, some find them corrosive), not a technical
one. Default ON because FuelGuard's score is coaching-oriented (weakest-component advice), which
is the healthy variant.
**Impact:** Phase 4.5 (tab bar + Home tiles), Phase 5.1 (toggle).

## D-PM4. Messages web inbox — **must be built; modeled on Samsara's dashboard messaging**

**Decision:** Phase 7 includes building the dispatch inbox in `apps/web` — **verified: no messages
UI exists anywhere in `apps/web`** (the API at `/api/messages` is mounted and complete; a driver
messaging into a void is a launch blocker for the module). Model it on Samsara:

- **Messages icon in the web top bar with an unread counter** (their dispatcher entry point).
- Thread-per-driver view, plus **compose-to-many** (select multiple drivers) for announcements —
  v1 sends one-way broadcast copies into each thread rather than group chats (Samsara's model;
  matches the existing `message_threads` schema without new tables).
- **Retention/visibility policy adopted from Samsara: 90 days visible in dashboard, 30 days in the
  driver app, full history retained** (FuelGuard's D54 already says never hard-deleted, which is
  stronger than Samsara's 6-month API window — keep ours).
- **No delete, no edit** of sent messages (Samsara: "messages cannot be deleted once sent" — and it
  matches the append-only audit posture).
- Driver-side: unread indicator until read (envelope-badge pattern); **no while-driving lockout in
  v1** — Samsara gates messaging on active driving, but FuelGuard has no motion signal until the
  navigation programme lands; record it as a nav-programme dependency rather than faking it.
**Impact:** Phase 7 scope grows by the web inbox (~2 days); 7.1's "verify first" is now resolved.

## D-PM5. Navigation module row — **hidden from the dashboard until the nav programme ships**

**Decision:** the feature catalog gains a per-feature `released: boolean`. `nav.preview` ships
`released: false`: it exists in the catalog (so nothing special-cases it later) but the dashboard
does not render a toggle and the resolver always answers OFF. When the navigation programme ships,
flip `released: true` — no schema change.
**Why:** Samsara never shows admins a toggle for a feature that can't do anything; an inert toggle
teaches admins the settings page can't be trusted. The `navigation` module entitlement stays
seeded (0088's backfill) — entitlement and release are different axes.
**Impact:** Phase 4.3 (catalog field + resolver rule), Phase 5.1 (dashboard skips unreleased).

## D-PM6. Who manages Driver App settings — **admin + fleet_manager; dispatcher gets per-driver overrides only; auditor read-only**

**Decision:** the org **Driver App settings page** (feature toggles + configs) requires
`admin` or `fleet_manager`. The **per-driver overrides panel** additionally allows `dispatcher`
(day-to-day exception handling — e.g. enabling hazmat capture for two pilot drivers — is dispatch
work). `auditor` sees everything read-only. Every write audited (already in the plan).
**Evidence:** FuelGuard's verified role matrix (`packages/shared/src/auth.ts`): admin manages all
sections incl. org admin; fleet_manager manages every operational section but not org admin;
dispatcher manages dispatch + hazmat only. Samsara's pattern is the same shape: fleet-wide settings
sit with admin-level roles, finer-grained operational access below.
**Implementation note:** reuse the existing section machinery rather than inventing a parallel
gate — driver-app *policy* rides `fleet: manage` (admin + fleet_manager exactly), overrides ride
`dispatch: manage` (adds dispatcher). No new role, no SECTION_ACCESS change.
**Impact:** Phase 5.1/5.2 route guards + web nav placement (settings page under Settings; overrides
on the existing driver page).

---

## New decisions surfaced by the research

## D-PM7. Notification governance — **org enables categories; driver tunes within them**

**Decision:** two layers, mirroring Samsara's "Manage Driver Notifications" (admin-managed) plus
per-device preferences: the org's `notifications` feature `config` declares which categories are
active for the fleet (load released/changed/canceled, message received, duty auto-close, week
settled, hazmat verdict); the driver's Settings screen offers per-category toggles and quiet hours
**only within the org-enabled set**. Driver preferences can narrow, never widen.
**Impact:** Phase 6.4 gains the org layer (config schema in the catalog, Phase 4.3); the driver
prefs UI filters by it.

## D-PM8. Feature-flag hygiene — **catalog features are long-lived switches, owned and audited; no ad-hoc flags**

**Decision:** adopt the researched at-scale conventions, sized for this codebase: every catalog
entry has an owner note and a `released` state (D-PM5); visibility blocks are **long-lived
switches** (never auto-expired); anything experimental/temporary must NOT enter the catalog — dev
experiments stay behind `__DEV__`. The catalog is append-only vocabulary like `MODULE_KEYS`:
removing a key requires a migration note. All writes audited (already planned); the audit page
should render feature changes with before/after (it already gets them via `writeAudit`).
**Why:** the failure mode of flag systems is flag sprawl and stale flags; a small, named,
audited catalog with an explicit release axis avoids both without adopting a third-party flag
service (unnecessary at this scale — the resolver is ~50 lines against two tables, and offline
delivery via the persisted bootstrap matches the local-evaluation best practice exactly).
**Impact:** Phase 4.3 catalog shape; review checklist in Phase 9.

## D-PM9. Check-in equipment UX — adopt Samsara's selection aids where they're free

**Decision:** from Samsara's vehicle-selection settings, adopt now: **recent-equipment-first
ranking** (already Phase 1.7) and **"your truck" default pinning** (already built). Explicitly
defer: location-based nearest-vehicle suggestion (needs location permission — nav-programme
dependency, same as D-PM4's driving lockout) and cross-org vehicle search (single-org product).
**Why:** each adopted aid is client-side over data the app already holds; each deferred one drags
in a permission or a concept the product doesn't have yet.
**Impact:** none beyond Phase 1 as planned; the deferred items are recorded in the nav-programme
handover list.

---

## Summary table

| # | Decision | Choice |
|---|---|---|
| D-PM1 | Loads tab | Controllable block; OFF for our org until Loads ships; hides tab + routes + Home load sections together |
| D-PM2 | Odometer | `optional` default; `required` advised without telematics; telematics cross-check follow-up |
| D-PM3 | Score tab | Controllable; default ON; hides tab + Home tiles together |
| D-PM4 | Messages inbox | Build in web (verified absent); Samsara model: top-bar icon + counter, compose-to-many, 90/30-day visibility, no delete |
| D-PM5 | Navigation row | Catalog `released:false` — no dashboard toggle until nav ships |
| D-PM6 | Settings access | Policy: admin + fleet_manager (`fleet: manage`); overrides: + dispatcher (`dispatch: manage`); auditor read-only |
| D-PM7 | Notifications | Org enables categories; drivers narrow within them |
| D-PM8 | Flag hygiene | Small audited catalog, long-lived switches, `released` axis, no ad-hoc flags |
| D-PM9 | Check-in aids | Recent-first + default pinning now; location-based + driving-lockout deferred to nav programme |

## Research sources

- Samsara Driver App and Device Settings (feature toggles, per-driver restrictions, workflows):
  kb.samsara.com/hc/en-us/articles/360059559832
- Samsara Driver Messages (dashboard inbox, compose-to-many, retention, no-delete, driving lockout):
  kb.samsara.com/hc/en-us/articles/360043461711
- Samsara Administrative Roles / Custom Roles (fixed prebuilt roles, admin-level settings access):
  kb.samsara.com/hc/en-us/articles/4411870638733
- GrowthBook — feature flags at scale (local evaluation, lifecycle, kill switches, governance):
  growthbook.io/blog/how-to-implement-feature-flags-at-scale
- FuelGuard code verification: `packages/shared/src/auth.ts` (role matrix), `apps/api/src/lib/samsara.ts`
  + `services/samsaraRecon*` + `services/askData.ts` (telematics odometer + mismatch metric),
  `apps/web/src` (no messages UI), `apps/api/src/app.ts` (messages mounted, notifications not).
