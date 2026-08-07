# Driver App Hardening & Remote-Control Plan (2026-08-07)

**Goal:** a fully functional, enterprise-grade drivers app (except the Loads module), with a
standalone hazmat route for testing, every visible datum real, and — Samsara-style — the entire
driver app controllable from the dashboard in blocks: modules and features can be granted, revoked
and configured per org and per driver without an app release.

**Method:** everything below was verified by reading the code (`apps/driver`, `apps/api`,
`apps/web`, `apps/admin`, `apps/admin-api`, `packages/shared`, `supabase/migrations`) — nothing is
assumed from the plan docs' own claims. Where the plan docs turned out to be wrong, that is called
out explicitly. Companion doc: `DRIVER-APP-AUDIT-2026-08-07.md` (the state audit).

---

## Part I — Verified findings that drive this plan

### F1. Check-in "vehicle → trailer" defect — diagnosed (your report, confirmed in code)

`app/duty/check-in.tsx` is **not a wizard, but it looks like one**. It renders a `TaskStepper`
("Truck → Trailer → Odometer/Save") and then puts **both rosters on one long scroll page**. Verified
behaviors that together produce "I select a vehicle and it doesn't proceed to trailers":

1. **Nothing advances on selection.** `pick(v,'vehicle')` only calls `setVehicle(option)` — no
   scroll, no step change, no focus move. The stepper is cosmetic; the screen never "proceeds."
2. **One shared search box filters BOTH lists.** `useFiltered` runs the same `search` string over
   `vehicles` and `trailers`. Type "214" to find your truck, tap it — the trailer list is still
   filtered by "214" and renders **zero rows with no empty state** (only the Bobtail row survives,
   because it's outside the filtered map). The trailer step appears missing/broken.
3. **The search is never cleared** after a vehicle is chosen, and the keyboard (opened by the
   search `Input`) can cover the trailer section on small screens.
4. Minor: `confirmTakeOver` resolves vehicle-vs-trailer by `vehicles.some(...)` over the *filtered*
   list — if the query changed between opening and confirming the sheet, the option can be
   mis-classified as a trailer. Narrow, but real.
5. Layout: `ActionBar` sits *inside* the `ScrollView` (verified in `Screen.tsx` — scroll by
   default), so the primary CTA is below the fold rather than pinned, contradicting the "primary
   actions reachable" rule in `DESIGN.md`.

### F2. Entitlements never reach the app — bootstrap regression (plan ledger is wrong here)

The plan ledger (5E row) claims "modules on the driver bootstrap payload" is built. **It is not.**
`GET /api/me/driver` (`apps/api/src/routes/me.ts`) selects driver + vehicles and returns
`{ driver, vehicles }` — **no `modules`**. The org_modules read exists only in the dead file
`routes/me.ts.removed` (line 87), i.e. it was dropped in a refactor. The shared contract
(`driverContract.ts:31`) declares `modules: z.array(orgModuleSchema).default([])` — the `.default([])`
**silently masks the regression**: the app parses fine and would forever see zero modules. The
driver app itself never reads `modules` anywhere (verified: no usage in `apps/driver/src`).
Consequence: dashboard-controlled module visibility is impossible today even though the DB layer
(0088) is live. This is the root the whole Samsara model hangs off — fixed in Phase 4.

### F3. No management surface exists for org_modules — anywhere

`0088` deliberately grants **no in-tenant write policy** (correct: an entitlement is a commercial
fact). But the platform side has no UI either: `apps/admin`'s CustomerDetailPage "Modules" toggle
writes **`org_integrations`** (integration providers) via `/admin/orgs/:id/modules/:provider` — it
does **not** touch `org_modules`. Today the only way to grant HazmatGuard to a tenant is SQL.

### F4. Non-real data inventory (complete sweep of `apps/driver`)

| Surface | What's fake | Status |
|---|---|---|
| Navigate tab + `drive.tsx` modal | Hardcoded "LD-20481 · Joliet → Columbus", 2 fake fuel stops with prices, hardcoded route polyline (`NavigationScreen.tsx`, `NavMap.tsx` — the NP0 spike) | Rendered as a real tab — violates D51 (4 tabs) & D52 (center slot not rendered) |
| `gallery.tsx` | `SAMPLE_UPCOMING` demo load | Legitimate design tool, but reachable in **production** via More (no `__DEV__` gate) |
| `RoutePreview.tsx` | Schematic route sketch | **Dead code** — zero imports anywhere |
| `sampleLoads.ts` | 3 sample loads | Only imported by gallery — contained |

Everything else renders live API data: Home (`/api/me/driver`), duty (`/api/me/shift|equipment`),
loads (`/api/me/loads`), score (`/api/me/score`), hazmat (`/api/me/hazmat/*`), settings/sync.

### F5. Notifications API is dead code; Messages API is live but driver-blind

`routes/notifications.ts` is fully written (centre, read, token register/revoke, preferences) and
migration `0089_notifications.sql` exists — but the router is **never mounted in `app.ts`**.
`/api/messages` **is** mounted (`0096_messages.sql`), with list/thread/post/read/report endpoints —
and the driver app has zero UI for either. No push-token registration, no bell, no threads.

### F6. Hazmat is already decoupled from Loads; it's only unreachable

`app/hazmat/capture.tsx` creates the driver's **own** load (`POST /api/me/hazmat/loads`,
`driver_id` forced server-side, driver-scope RLS 0092) — no dependency on the dispatch Loads module.
Missing: any UI entry point (More's "HazmatGuard" row is a dead "Soon" badge), a
`GET /api/me/hazmat/loads` **list** endpoint (only `GET /loads/:id` and `/loads/:id/runs` exist, so
a verdict is unfindable after leaving the screen), root-Stack declarations, and the certifications
prerequisite (§5 gate fail-closes every load until the roster is entered — HAZMATGUARD-STATUS).

### F7. Research — the Samsara reference model (what we're matching)

Samsara's dashboard (Settings → Fleet → Driver App) gives org-level **feature toggles** (messaging,
maps, HOS, DVIRs, routes, documents, driver scores, trip logs — disabled features simply don't
appear in the driver app), **general settings** (login behavior, vehicle/trailer selection behavior,
location-based vehicle suggestions), **per-driver restrictions** (which assets a driver can see and
select), and **workflows** (task sequences prompted at sign-in or at stops). Feature-flag best
practice for mobile: **server-resolved, locally cached** flag sets (stale-while-revalidate, so
offline keeps last-known config and nothing flickers), kill-switch flags as long-lived, prerequisite
relationships (feature requires module), full audit of changes, clear ownership. This maps cleanly
onto what FuelGuard already has: `org_modules` (+ its `config` jsonb), the persisted query cache,
and the append-only audit log.

---

## Part II — The target architecture: "blocks" controlled from the dashboard

Three layers, strictly ordered, each with its own owner and write path:

```
Layer 1  ENTITLEMENTS   org_modules (exists, 0088)      Who owns: platform (apps/admin)
         "what this org bought"                          Enforced in: RLS + API (requireModule) + UI

Layer 2  ORG FEATURES   driver_app_features (new)        Who owns: org admin / fleet manager (web)
         "what this org's drivers see + how it behaves"  Enforced in: API resolution + app UI

Layer 3  DRIVER OVERRIDES driver_app_feature_overrides   Who owns: org admin (web, per driver)
         "pilot/exception per driver"  (new)             Enforced in: API resolution + app UI
```

Resolution rule (server-side, one place):
`effective(feature, driver) = entitled(module_of(feature)) AND org_enabled(feature, driver.org) AND (override(driver, feature) ?? true)`
— a feature can never be on without its module (prerequisite rule); absent = the feature's declared
default. **Core surfaces (Home, Duty, Settings, sync spine) are not features and can never be
remote-disabled** — a config mistake must not brick a driver's day.

Delivery: the resolved feature set + module set ride the existing bootstrap
(`GET /api/me/driver` → `{ driver, vehicles, modules, features }`), parsed by the shared contract,
cached in the persisted query cache. Offline = last-known config (stale-while-revalidate). The app
holds **one** `useFeatures()` hook; screens/tabs/rows ask it — never the raw arrays.

Feature catalog v1 (shared `featureCatalog.ts`, single source of truth — key, module, default,
label, description, per-feature `config` schema):

| Feature key | Module | Controls |
|---|---|---|
| `tab.loads` | dispatch | Loads tab + load routes visible (lets you hide Loads org-wide until the module ships) |
| `tab.score` | (core-adjacent, default on) | Score tab visible |
| `hazmat.capture` | hazmatguard | Hazmat hub entry + capture/verdict routes |
| `messages` | messages | Messages surface + top-bar icon |
| `notifications` | notifications | Bell, centre, push registration |
| `duty.odometer` | (default on) | config: `off / optional / required` at check-in & end-shift |
| `duty.takeover` | (default on) | Allow take-over of an in-use unit vs dispatch-only reassignment |
| `nav.preview` | navigation | Navigate surface when the nav programme ships (stays off now) |
| `training` | training | Training row (future) |

RLS posture (unchanged philosophy): visibility layers 2–3 are UX, **not** authorization — the
authorization boundary remains RLS + `org_module_enabled()` exactly as today. Hiding the Loads tab
does not weaken load RLS; disabling `hazmat.capture` does not open anything.

---

## Part III — Phases

Ordering rationale: unblock builds → fix what a tester touches first (check-in, honest surfaces) →
make hazmat testable → build the control plane the rest hangs off → dashboards → notifications →
messages → polish → release gate. Each phase is shippable on its own; nothing later blocks earlier.

---

### Phase 0 — Build unblock & baseline (Mac, ~½ day) — prerequisite for everything

0.1 `pnpm install` at repo root (links `@fuelguard/capture-engine`).
0.2 Apply migration `0133` to Supabase (0127–0132 already applied).
0.3 `rm -f .git/index.lock .git/tmp_ci*`; delete `_probe.txt`, `_probes/`, `_tmp_6_*`,
    `_to_delete/` from the repo root.
0.4 `npx expo prebuild` + `expo run:android` (then iOS) — first-ever compile of the native
    `capture-native` module.
0.5 `pnpm test` (full suite) + `pnpm --filter @fuelguard/web build` — the suite has never run since
    the hazmat port; treat any failure as a Phase-0 blocker.
0.6 Device smoke: cold start offline, sign-in, queue→relaunch→drain, SQLCipher active.
**Exit:** app builds and runs on a physical device; suite green; repo clean.

---

### Phase 1 — Check-in flow rebuilt as a real wizard (the bug you found, ~1–2 days)

Make the screen match what its own stepper promises. Three true steps, one decision per screen-state:

1.1 **Step model as pure logic** — `src/features/duty/checkInModel.ts`: states
    `truck → trailer → confirm`, transitions, and per-step validity. Unit-tested (the codebase's
    pattern: pure model + thin screen).
1.2 **Step 1 Truck:** roster + search (search scoped to this step only). Selecting a truck
    (or confirming a take-over) **clears the search, dismisses the keyboard, and advances** to
    Step 2. "Your truck" quick-pick stays ranked first.
1.3 **Step 2 Trailer:** its own search; Bobtail as a first-class card (D44.2); **empty state when a
    filter matches nothing** ("No trailers match — clear search or go bobtail"). Selecting either
    advances. Back returns to Step 1 with selection preserved.
1.4 **Step 3 Confirm:** summary card (Unit · Trailer/Bobtail), odometer (per `duty.odometer`
    config: off/optional/required), then Start/Save. `ActionBar` pinned outside the scroll
    (`Screen` gains a `footer` slot — reusable for the stop-capture screen which has the same
    below-the-fold CTA issue).
1.5 **Fix the take-over misclassification:** the confirm sheet carries `kind: 'vehicle'|'trailer'`
    from the tap site instead of re-deriving it from the filtered array.
1.6 Swap mode uses the same wizard with Step 1 pre-completed ("keep your truck") — one component,
    two entry modes, as today.
1.7 Enterprise touch (from Samsara's model, cheap now): rank the roster by **recency** — last unit
    this driver used first (client-side from duty history already in the shift payload).
**Exit:** select truck → land on trailers, always; all states unit-tested; on-device pass in
gloves-thumb reach; no dead-end filter states anywhere on the screen.

---

### Phase 2 — Real-data guarantee (~½ day)

2.1 Remove `navigate` from the tab bar (`app/(tabs)/_layout.tsx`) per D52 — 4 tabs. Keep
    `navigate.tsx` / `drive.tsx` files as the seam, reachable only behind `__DEV__` (dev builds can
    still open the NP0 map spike for the future nav programme).
2.2 Gate the "Design system" gallery row in More behind `__DEV__` (Settings already gates its dev
    row correctly — copy that pattern).
2.3 Delete `RoutePreview.tsx` (dead code) or move it into the gallery.
2.4 **Guarantee, not promise:** extend the existing boundary linter (`lint:boundaries`) with a rule
    — `sampleLoads.ts` (and any future `sample*.ts`) may only be imported from `app/gallery.tsx`.
    CI fails otherwise. Add a one-line header comment to `sampleLoads.ts` stating the rule.
2.5 Sweep assertion (manual, checklist in PR): every string/number rendered on Home, Loads, Score,
    Duty, More, Settings, Hazmat traces to an API response, user input, or device state. (Verified
    true today — the check pins it.)
**Exit:** a production build contains no reachable fabricated data; CI enforces it.

---

### Phase 3 — Hazmat standalone route for testing (~1–2 days)

3.1 **API:** `GET /api/me/hazmat/loads` — the caller's own hazmat loads (`created_by = user`,
    driver-scope), projected: `id, status, created_at, latest_outcome, ref/label`. Same
    idempotent/audited style as the existing meHazmat routes. Tests: driver sees only their own;
    raw-PostgREST deny unchanged.
3.2 **App:** `app/hazmat/index.tsx` — "Hazmat checks" hub: primary "Capture BOL" button + history
    list (outcome badge per row → verdict screen). Persisted query (`['me','hazmat','loads']`) so
    it renders offline.
3.3 Wire the More-tab HazmatGuard row → `/hazmat` (drop the "Soon" badge). Until Phase 4 lands the
    feature system, gate it with a temporary `__DEV__ || modules.has('hazmatguard')` check so
    testing isn't blocked on the control plane.
3.4 Declare `hazmat/index`, `hazmat/capture`, `hazmat/[loadId]` in the root Stack (modal
    presentation, matching duty/settings).
3.5 **Test-data runbook (do before first capture):** enter the test driver's certifications in web
    → Compliance (the §5 gate fail-closes until then — every verdict would be
    `driver_unqualified:*`); confirm org has the `hazmatguard` module row; confirm migration 0133.
3.6 Verdict screen polish: show capture provenance (page count = 1 for now), "Capture another BOL"
    action, and a plain-language line when the outcome is gate-blocked by qualification (driver-
    readable, no CFR jargon on the blocked path).
3.7 Known limits, documented on the screen where honest: single-page BOL in v1 (engine supports 10;
    model uses page 1 — noted as a follow-up, not silently wrong).
3.8 When Loads ships later: embed the same vertical as a load-flow step (plan Phase 6/D51); the
    standalone hub remains as the fallback/testing surface.
**Exit:** hazmat fully drivable from the app without touching Loads: capture → verdict → history,
offline-safe, re-findable after relaunch.

---

### Phase 4 — Remote-control foundation: entitlements repaired + feature system (~3–4 days)

The core of the Samsara model. All server-side resolution; the app consumes one resolved set.

4.1 **Fix F2 (bootstrap regression):** restore the `org_modules` read in `GET /api/me/driver` and
    return `modules`. Add an API test asserting the field is present and correct — and change the
    shared contract's `.default([])` to a required field so this class of silent regression can't
    recur (the default is what hid it for a month).
4.2 **Migration `01xx_driver_app_features.sql`:**
    - `driver_app_features (org_id, feature_key, enabled, config jsonb default '{}', updated_by, updated_at, pk(org_id, feature_key))`
    - `driver_app_feature_overrides (org_id, driver_id, feature_key, enabled, note, updated_by, updated_at, pk(org_id, driver_id, feature_key))`
    - RLS: org members read their org's rows; **writes only for `rolesThatManage('dispatch')`-class
      admin roles via API (service role), no driver write path**; drivers don't read these tables at
      all — they get the resolved set from the bootstrap.
    - Every write audited (existing `writeAudit`).
4.3 **Shared `featureCatalog.ts`:** the table from Part II — key, owning module (or `core`),
    default, label, description, zod schema for its `config`. One place; web UI and resolver both
    consume it (D56's "modular without exceptions" applied to features).
4.4 **Resolver** `apps/api/services/driverAppFeatures.ts`: the Part-II rule, unit-tested, including
    the prerequisite property (feature off when module absent, regardless of org row) and the
    fail-safe property (core surfaces not disableable). Wire into `/api/me/driver` → `features`.
4.5 **App:** `useFeatures()` over the bootstrap cache (persisted → offline = last-known, no
    flicker). Consume it at: tab bar (loads/score visibility), More rows (hazmat, training,
    messages), hazmat Stack guard (replaces 3.3's temp check), duty odometer mode, take-over
    allowance. Unknown keys ignored (old app + newer server = safe).
4.6 **Kill-switch + min-version (enterprise ops):** a `core.minAppVersion` config entry in the same
    payload; app compares on bootstrap and shows a blocking "update required" screen when below
    (policy: warn at n-1, block below). This is the standard fleet-app force-upgrade gate.
**Exit:** flipping a row in the DB changes what a driver's app shows on next refetch, offline-safe;
property tests green; nothing core is remotely disableable.

---

### Phase 5 — Dashboard control surfaces (~3–4 days)

5.1 **Org dashboard (apps/web) — Settings → "Driver App"** (Samsara's Settings → Fleet → Driver
    App analog): one card per catalog feature — toggle + its config controls (e.g. odometer
    off/optional/required), grouped by module; disabled-with-explanation when the module isn't
    entitled ("Contact FuelGuard to enable HazmatGuard"); every change confirmed and audited; a
    "what drivers see" preview column (tab shell mock reflecting current toggles).
5.2 **Per-driver overrides** — on the existing driver page (web → roster/drivers): an "App
    features" panel listing overrides with note + author; the pilot flow ("enable hazmat capture
    for these 2 drivers only") is one toggle here.
5.3 **Platform entitlements (fix F3)** — `apps/admin-api`: `GET/PUT /admin/orgs/:id/entitlements`
    writing **`org_modules`** (service role; platform_owner/admin; step-up per existing MFA
    pattern; platform-audited). `apps/admin` CustomerDetailPage: an "Entitlements" section —
    clearly separate from the existing org_integrations "Modules" toggles (rename that section
    "Integrations" to end the name collision).
5.4 API guards: org-side feature endpoints under the web session with admin/fleet_manager roles;
    the route-auth fitness test auto-discovers the new routers (it already asserts 401s repo-wide).
**Exit:** you can grant an org HazmatGuard from apps/admin, turn features on/off and configure them
from the web dashboard, override per driver, and watch the driver app follow — with an audit trail
end to end.

---

### Phase 6 — Notifications (5N) (~4–5 days)

6.1 Mount `notificationsRouter` in `app.ts` (it exists, is tested code, and is currently
    unreachable); reconcile its endpoints against migration 0089 + the plan's D53 contract; add its
    routes to the route-auth fitness test.
6.2 Producers: emit `notification_events` at the moments D53 names — load released/changed/
    canceled (dispatch service), message received (messages service), duty auto-close (sweeper),
    week settled (performance), hazmat verdict ready (orchestrate finish — natural fit for the
    standalone hazmat testing loop).
6.3 App: Expo push token registration on sign-in (+ revoke on sign-out and offboarding — D14
    already specs revocation), top-bar bell with unread count on Home, notification centre screen
    (grouped, read state), deep links (`/loads/[id]`, `/hazmat/[loadId]`, thread) — behind the
    `notifications` feature.
6.4 Preferences: per-category toggles + quiet hours (server-stored via the existing preferences
    endpoint) surfaced in Settings.
6.5 Test path without APNs/FCM ceremony: in-app centre works from day one (poll/refetch);
    push delivery verified on the dev build (Expo push works in dev clients).
**Exit:** dispatch/hazmat/duty events reach the phone; centre + deep links + prefs work; tokens
revoked on offboarding.

---

### Phase 7 — Messages (5M) (~4–6 days)

7.1 Verify the web dispatch inbox state first (API is live; the web UI was **not** verified in this
    audit — check `apps/web` for a messages surface before scoping; build it if absent, since a
    driver messaging into a void is worse than no messaging).
7.2 App: thread list + thread screen (load-bound threads show their load ref), outbound through the
    existing outbox (`message_send` kind, client-UUID idempotent, offline-safe), inbound via
    Supabase Realtime with cache-backed fallback poll (the stack's first inbound-realtime path —
    isolate it in `features/messages`).
7.3 Report/block affordances on received content (App Store requirement D54 already names).
7.4 Behind the `messages` feature + module; bell-adjacent entry per D51.
**Exit:** driver↔dispatch messaging round-trips offline-safely; store-compliant; dashboard inbox
confirmed working.

---

### Phase 8 — Enterprise polish & UI/UX upgrades (continuous, start ~2 days)

Adopted from the Samsara model + fleet-app conventions, filtered to what fits this codebase:

8.1 **Crash reporting + observability for the app:** the API has Sentry; the driver app has none
    (verified — no Sentry/crash dep in `apps/driver/package.json`). Add `sentry-expo` with the same
    PII-scrubbing posture as `lib/sentryScrub.ts` (strip identifiers, keep user.id + release tags).
    An enterprise fleet app without crash telemetry is flying blind.
8.2 **OTA updates:** EAS Update for JS-level fixes between store releases (dev-client compatible);
    pairs with the Phase-4 min-version gate for a complete release-control story.
8.3 **Check-in intelligence (Samsara "location-based vehicle suggestions"):** rank the truck list
    by last-used (Phase 1.7) now; optionally by proximity later when the nav programme lands
    location permissions — don't add location permission just for this.
8.4 **Sign-in / shift workflows (Samsara "Workflows", future block):** the feature system's
    `config` jsonb is the seam for org-defined check-in task sequences (e.g. walkaround photo,
    defect note) — catalog it as a future feature key, don't build yet.
8.5 **UI/UX refinements (audit-driven, respecting DESIGN.md):**
    - Pinned `ActionBar` footer on all task screens (from Phase 1.4) — check-in, end-shift, stop
      capture.
    - Home: when off-duty, make the duty card the single dominant CTA ("Start your day") —
      currently equal-weight with the loads section.
    - Empty states audit: every filtered list gets a no-match state (the check-in trailer bug class,
      eliminated globally — loads search when added, equipment, hazmat history).
    - Error taxonomy: one retry-banner pattern exists (good) — extend it with "stale data, showing
      cached" chips on offline-served screens so drivers trust what they see (enterprise honesty
      pattern; the offline banner covers connectivity, not data age).
    - A11y pass: labels exist on icon buttons (spot-checked) — run a full TalkBack/VoiceOver pass in
      Phase 9's matrix; Dynamic Type already respected per DESIGN.md rules.
    - Haptics on step transitions in the new wizard (pattern already in `lib/haptics.ts`).
8.6 **Repo hygiene as policy:** the root-level probe/tmp litter (0.3) plus a CI check that the repo
    root stays clean.

---

### Phase 9 — Verification matrix & release gate (~2 days, then per-release)

9.1 Device matrix per surface (the plan's outstanding "device pass" column, now executable):
    cold-start offline · queue→relaunch→reconnect drain · invite E2E · duty wizard incl. take-over
    and both odometer configs · hazmat capture→verdict→history offline · feature-toggle flip
    observed live · push deep-links · light/dark · TalkBack/VoiceOver · min-spec Android.
9.2 DCE-0 hardware checks (ML Kit no-egress capture during scan; OCR latency on min-spec Android).
9.3 RLS regression: extend the existing raw-PostgREST deny matrix with the new tables
    (`driver_app_features`, overrides) and the hazmat list endpoint.
9.4 Store-readiness checklist (account deletion ✓ exists; messaging report/block from 7.3; privacy
    labels for camera/photos/push).
**Exit:** a written, repeatable release gate; first full pass recorded.

---

## Part IV — Sequencing & effort summary

| Phase | What | Size | Depends on |
|---|---|---|---|
| 0 | Build unblock (Mac) | ½ d | — |
| 1 | Check-in wizard fix | 1–2 d | 0 |
| 2 | Real-data guarantee | ½ d | 0 |
| 3 | Hazmat standalone route | 1–2 d | 0 (3.3 temp-gate → replaced by 4) |
| 4 | Entitlement fix + feature system | 3–4 d | 0 |
| 5 | Dashboard control surfaces | 3–4 d | 4 |
| 6 | Notifications | 4–5 d | 4 (feature gate), mountable day 1 |
| 7 | Messages | 4–6 d | 4, 6 (bell placement) |
| 8 | Enterprise polish | 2 d + ongoing | parallel from 1 |
| 9 | Verification & release gate | 2 d | all |

Parallelizable: 1‖2‖3 after 0; 5‖6 after 4. Critical path to "drivers app fully functional except
Loads, dashboard-controlled": **0 → 4 → 5**, with 1–3 landing alongside.

## Part V — Decisions: RESOLVED (2026-08-07)

All six open decisions are locked in **`DRIVER-APP-DECISIONS-2026-08-07.md`** (same folder), each
grounded in the Samsara reference model and verified against this codebase. Summary:

1. **Loads tab** → controllable block (`tab.loads`), OFF for our org until Loads ships; the flag
   hides the tab, the `loads/*` routes AND Home's load sections together (D-PM1).
2. **Odometer** → `optional` default; `required` advised for orgs without telematics; Samsara-
   connected orgs get a cross-check follow-up instead (D-PM2 — FuelGuard already stores
   `samsara_odometer` + a >5 mi mismatch metric).
3. **Score tab** → controllable, default ON; hides tab + Home tiles together (D-PM3).
4. **Messages web inbox** → verified ABSENT in `apps/web`; must be built in Phase 7 on the Samsara
   model (top-bar icon + unread counter, compose-to-many, 90/30-day visibility, no delete) —
   Phase 7 grows ~2 days (D-PM4).
5. **Navigation row** → catalog gains `released: boolean`; `nav.preview` ships `released: false` —
   no dashboard toggle, resolver always OFF until the nav programme (D-PM5).
6. **Settings access** → policy page: admin + fleet_manager (`fleet: manage`); per-driver
   overrides: + dispatcher (`dispatch: manage`); auditor read-only; no new roles (D-PM6).

Plus three added by research: notification governance (org enables categories, drivers narrow —
D-PM7), flag hygiene (small audited catalog, long-lived switches, no ad-hoc flags — D-PM8), and
check-in selection aids (recent-first now; location-based + driving-lockout deferred to the nav
programme — D-PM9).
