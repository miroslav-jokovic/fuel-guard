# FuelGuard Driver App — Master Plan (single source of truth)

> Native mobile app (React Native + Expo) for the people who fuel the trucks.
> Owner: Silvicom Inc. · Status: **BUILDING — Phases 0–1 built (foundation + identity/auth); scope pivoted to loads/assignments + planned navigation (D41); Phases 2–7 authored/roadmapped; every decision LOCKED (D1–D58)** · Last updated: 2026-07-27
>
> ✅ **Solutions-only.** Every architecture/design/security/UX/compliance choice is a **LOCKED decision
> (D1–D58)** with a rationale and a documented fallback. **There are no "decide during build" items left**
> — §10 is now purely *operational tasks* (confirm a setting, seed an account, host two web pages, run the
> Phase-0 build spike), not research questions. A builder can implement straight through.
>
> ⚠️ **Read §20 (verification), §21 (security), §22 (UX) and §23 (backend↔frontend contract, store
> compliance & type safety) and §24 (final decision lock-down) before building.** They verify every claim
> against current code + the 2026 RN/Expo toolchain, record findings with resolutions, and correct/expand
> several inline statements. **Where a later section conflicts with an earlier inline statement, the later
> section governs** (§21 over §20 on security; §22 over earlier UX; §23 on contract/types/compliance; §24
> is the authoritative lock of every remaining choice).
>
> **This is the one and only plan document for the Driver App initiative.** It is self-contained and
> written to be followed from a fresh chat with zero prior context. Everything that used to live in
> separate per-phase files now lives here as one continuous plan. **Every decision is LOCKED** (§9,
> D1–D58); §10 holds only operational pre-build *tasks* (no research required).

---

## §0. How to use this document — and how to resume in a new chat

This plan is designed so you (or a new chat, or a new teammate) can stop and continue with zero loss.
**Resume protocol:**

1. **This file is the single source of truth.** There are no other plan files. If you find old
   `00-…`, `01-…` numbered files, they are superseded copies — ignore them.
2. Read **§1 Progress Ledger** first — it says which phase is current and what the next action is
   ("you are here").
3. Read the **Locked Decisions (§9, D1–D58)** and the **operational pre-build checklist (§10)** before doing any work — they
   are the fast way to reload context.
4. Read the **current phase section in full** before building it. Each phase is self-contained: goal,
   changes, file breakdown, exit criteria.
5. **One phase per working session** (team convention). Do not start a new phase without the phase
   before it meeting its exit criteria.
6. **When you build/complete a phase, update three things in this doc** and re-commit it:
   - flip the phase's `☐` boxes to `☑` as they're met,
   - update that phase's row in **§1 Progress Ledger**,
   - add a row to the **§18 Build Log** with the commit hash + verification tally.
7. **Migration discipline:** never edit an applied migration; append new ones from the next free
   number (currently **0083**); add every new policy to the offline RLS matrix.
8. Every design/architecture choice is already LOCKED (§9, D1–D58); §24 maps the former open questions
   to their resolutions. If a genuinely new question arises mid-build, record it as a new LOCKED decision
   with a rationale — don't guess, and don't reopen a settled one without cause.

---

## §1. Progress Ledger (you are here)

**Current state:** Foundation (Phase 0) and Identity/Auth (Phase 1) are **built** — the Expo app, the
ported design system + Material Symbols icon system (D40), driver-scoped RLS (`0083`/`0084`, matrix
green), the driver invite/offboarding backend, and the full **app-side auth** (encrypted session,
sign-in, session state machine, root routing guard, Settings + in-app account deletion) are in the
repo. **Scope pivot (D41, 2026-07):** the driver app is a **loads / assignments + planned-navigation**
app — *not* a fuel-capture app. The daily job is: see the loads assigned to you, accept one, navigate
a truck-safe route (with planned-fueling stops), and upload proof-of-work photos at each stop
(JB-Hunt-style). **Manual fuel logging is removed** from the driver app (it stays a web/manager
surface); "fuel" survives only as **planned-fueling stops inside navigation**. The offline data spine
(Phase 2: read cache + write/photo **outbox** + sync) is retained — it now carries load-step and
hazmat photos instead of fuel receipts.

**Phase-3 correction (D43–D50, 2026-07-27).** A second discovery pass (§14.2b) found two structural
gaps that the plan had assumed away, plus four defects in the built Phase-3 artifacts. (1) **Equipment
was static:** the schema had no shift, duty period or check-in anywhere — a driver's truck was the
`vehicles.assigned_driver_id` column an admin sets, and a trailer was tied to a *vehicle*, never to a
driver or a point in time, so slip-seating and drop-and-hook were unrepresentable and mis-attributed.
(2) **Nothing authorized a load:** `loads.status` defaulted to `offered` and driver RLS made any row
with a matching `driver_id` instantly readable, so an unreviewed row — including anything a McLeod feed
would write — was on a phone the moment it was inserted; and `apps/web` had **no dispatch surface at
all**, making `seed_driver_load.sql` the entire "create a load" story. Phase 3 is therefore re-cut into
**3A duty sessions → 3B load lifecycle & approval → 3C driver app ∥ 3D dispatch dashboard → 3E McLeod
ingest** (§14). Because `0085` is deployed but holds **no production loads**, this correction costs two
additive migrations and a contract edit today, versus a coordinated app-plus-data migration after
release — §14.2 records why this is the last cheap moment. **3A is built** (see the ledger); next
action: **3B**.

**Scope correction (D51–D56, 2026-07-27).** A surface-by-surface audit against the intended app —
Home, Assignments, Navigation, Performance, Hazmat, More, plus Notifications and Messages — found
three things the plan had no answer for and one it had wrong. **Notifications and Messages did not
exist anywhere**: not a table, not a phase, not a mention (the only `notifications.ts` emails *office*
recipients about anomalies), which meant dispatch releasing a load would be invisible until a driver
happened to open the app. **No entitlement model existed** despite the plan repeatedly promising
"entitlement-gated" HazmatGuard — zero matches across migrations, API, web and shared. **§22.1, the
section that defines the tab bar, was still the fuel-era IA** (`Home · Fuel Log · center Log Fill-Up ·
My Score · More`) nine months after D41 retargeted the app, so the built shell already contradicted
the document a fresh session would follow. And **Navigation** is now its own programme (**D52**),
leaving the driver app to cover the daily job end-to-end. Resolutions: **D51** locks the IA (four tabs,
reserved center slot, Messages + Notifications in the top bar, Hazmat inside the load flow);
**D53**/**D54** author Notifications and Messages as modules; **D55** builds the entitlement gate;
**D56** makes "modular without exceptions" an enforced rule rather than a sentence.

**Security note:** the driver app hands a low-trust actor the anon key + a JWT, so **RLS at the
database — not the API endpoints or the UI — is the authorization boundary.** The approval gate (D45)
and the duty-session scope (D43) are therefore expressed as RESTRICTIVE policies with raw-PostgREST
deny cases, not as API checks.

| Phase | Plan (doc) | Build | Verified | Next action |
|---|---|---|---|---|
| 0 — Foundation & Design System | ✅ authored | ◐ **~done** — spike ✅ + 16 components + gallery + tests + ESLint + CI + nav shell + Material Symbols (D40); token linter green | ☐ device pass | On-device verify (shell + gallery, light/dark, a11y) + component polish, then close. Deferred: IBM Plex font (D36), tsconfig.base strict flags (D28) |
| 1 — Identity, Auth & Access Control | ✅ authored | ☑ **built (complete)** — RLS `0083`/`0084` (matrix 50/50); API driver-branch invites (token-enforced accept D15) + linking, `GET /api/me/driver`, `POST /api/me/delete-account`, web driver-gate + `revoke` offboarding; app auth (LargeSecureStore/PKCE client, apiFetch, session state machine, sign-in/pending/wrong-app, guard, Settings + delete-account); **accept-invite/set-password flow: driver invites redirect to `fuelguard://accept-invite` (session from link → set password ≥10 → accept w/ token → claim refresh), with a paste-link rescue and the web accept page as fallback (token forwarding + driver resend-token bugs fixed)** | ◐ device pass pending | Ops before real invites: T1 (token hook) + **T9** (allow `fuelguard://accept-invite` in Supabase Redirect URLs). End-to-end invite test on device, then Phase 2 |
| 2 — Offline-first Data Layer & Home | ✅ authored | ☑ **built** — persisted read cache (`queryClient`+AsyncStorage persister, offlineFirst), NetInfo→`onlineManager`/AppState→`focusManager`, **SQLCipher-encrypted outbox** (`db/outbox/fileStaging`), serial **sync engine** w/ handler registry + jittered backoff + dead-letter, sync UX (OfflineBanner/SyncStatus/PendingBadge/NeedsAttention), **Home on real `GET /api/me/driver`** w/ skeletons, dev seeded mutation; 16 policy unit tests green | ◐ device pass pending | Verify on device: cold start in airplane mode, queue→relaunch→reconnect drain, SQLCipher active (`cipher_version` warning), then Phase 3 |
| 3 — Assignments: equipment, loads & dispatch | ✅ **re-authored (D43–D50)** | ◐ **in progress** — discovery ×2 done (§14.2a greenfield, §14.2b static equipment + no approval + no dispatch UI); **`0085_driver_loads.sql`** + **shared `loadsContract.ts`** (15 tests); **3A BUILT** — see the row below | ☐ | **3A + 3B built.** Next: **3C** app screens ∥ **3D** dispatch dashboard → **3E** McLeod ingest. Order + parallelism in §14.11 |
| 3B — Load lifecycle & approval gate (backend) | ✅ authored (D45–D47) | ☑ **built** — **`0087_load_lifecycle.sql`**: the eight-state lifecycle with **`status` default changed from `offered` to `draft`**, approval/release actor+timestamp columns, `duty_session_id`, `drivers.driver_type` + org defaults (D46), the **`loads_status_guard`** trigger (legal-pair map + the approve/release/deliver gates incl. optional separation of duties), append-only **`load_events`** (update/delete blocked by trigger, not just RLS), the **driver-visible-status predicate** added to all three driver scopes, and four `security definer` RPCs (`driver_accept_load` / `_decline_load` / `_start_load` / `_complete_stop`) that each write the load, its events and its photos in **one transaction**; shared **`loadsLifecycle.ts`** (`LOAD_TRANSITIONS`, `canTransition`, `approvalChecklist`, `acceptanceCopy`, 26 tests) with `LOAD_STATUSES` widened to eight; API `GET /api/me/loads` + `POST /api/me/loads/:id/{accept,decline,start}` + `POST .../stops/:stopId`. **F1 closed** — `in_transit` is now reachable explicitly *and* implicitly from the first worked stop | ◐ **RLS matrix 101/101** (was 85/85) · **lifecycle behaviour matrix 42/42** · shared 886/886 · API 144/144 · typecheck clean. Device pass pending (needs 3C screens) | Applies with the migrate workflow; no ops step. **3C** app screens ∥ **3D** dispatch dashboard next |
| 3A — Equipment & duty sessions (backend) | ✅ authored (D43/D44) | ☑ **built** — **`0086_duty_sessions.sql`**: `driver_duty_sessions` + `duty_equipment_segments`, the three partial unique indexes (one open shift per driver; one seated driver per truck and per trailer), `organizations.duty_session_timeout_hours`, driver self-scope RLS with **no driver write policy**, widened `vehicles_driver_scope`, and the three **F4** leaks closed (`trailers`, `driver_time_off`, `tms_movements`); four `security definer` RPCs (`start_duty_session` / `change_duty_equipment` / `end_duty_session` / `close_stale_duty_sessions`) so a check-in, a take-over and a swap are each **one transaction**; shared **`dutyContract.ts`** (parse-not-cast + `segmentAt()` attribution primitive + the D44 gate, 31 tests); API `GET /api/me/{equipment,shift}` + `POST /api/me/shift/{start,equipment,end}` with the 409 take-over envelope (11 tests); `dutySessionSweeper` wired into `schedulers.ts` | ◐ **RLS matrix 85/85** (was 62/62) · **duty behaviour matrix 20/20** · shared 860/860 · API 144/144 · typecheck clean. Device pass pending (needs 3C screens) | Applies with the migrate workflow; no ops step. Verify on device once the 3C check-in sheet exists |
| 3E — McLeod → loads ingest | ✅ authored (D48) | ☑ **built** — shared `tmsLoadInputSchema`/`tmsStopInputSchema` (provider-neutral; the agent owns McLeod's field mapping) + `tmsMayOverwrite()`; `services/tmsLoadIngest.ts` + `POST /api/tms/loads` on the existing token-authenticated ingest router. **Lands in `pending_approval`, never `offered`** — `auto_approve_loads` is opt-in per org; once dispatch approves, the feed **stops writing and starts reporting** (an `amended` event carrying a field-level diff); an upstream cancellation of a load a driver is already running becomes a loud dispatch exception, never a vanishing row; every load returns a per-row outcome so nothing is silently dropped | ☑ **13 ingest tests** covering the safety property, amendments, cancellation and batch reporting. **Real bug the tests caught:** an absent field read as "cleared", so any partial sync would have raised false amendments and blanked dispatch's driver — `undefined` (no information) and `null` (explicit clear) are now distinct throughout |
| 3D — Dispatch dashboard (`apps/web`) | ✅ authored (D49) | ☑ **built** — core plus the **`load_events` timeline** on the load page with the full **inline action set** (submit · approve · reject · release · cancel), and **bulk approve/release** (`POST /api/dispatch/loads/bulk`) where the per-row gate is unchanged and partial success is reported per row. Earlier: **built (core)** — API `apps/api/src/routes/dispatch.ts` + `services/dispatchLoads.ts`: list/create/patch loads with stops, **one endpoint per transition** (submit · approve · reject · release · cancel · assign), the assignments board read, and end-a-stuck-shift — all `rolesThatManage('dispatch')`, all audited, all writing `load_events`; shared **`dispatchContract.ts`**; web **`useDispatchLoads.ts`** + **Loads queue** (six tabs, live `approvalChecklist()` naming every blocker inline, Approve disabled until required items pass), **load editor/create** (stops, appointment windows, per-stop photo-slot builder, live checklist panel — retires `seed_driver_load.sql`), **Assignments duty board** (on/off duty, truck, trailer, shift length, current load, end-shift). Router + Dispatch nav wired; no auth-matrix change needed | ◐ API typecheck clean · **145/145** API tests (the route-auth fitness test auto-discovered `/api/dispatch` and asserts it 401s) · web design-token check clean · **web typecheck + the load timeline panel pending** | New `features/dispatch/**` under the existing Dispatch nav section (no auth-matrix change): Loads queue + approval checklist, load detail/editor + `load_events` timeline, Create load, **Assignments** live duty board + history, Exceptions. Retires `seed_driver_load.sql`. Depends on 3A+3B; parallel with 3C |
| ~~4 — Navigation~~ | ➡️ **deferred (D52)** | — | — | **Out of the driver-app critical path** — its own programme once the app ships. Server side (`0059`/`0060` route geometries, `0074` fuel plans, `0058` spine, `smartFueling/`, `lib/here.ts`) is built and untouched; the reserved center tab slot + `navigate.tsx`/`drive.tsx` stay as the seam. Handover note in §15 |
| 5 — Driver Performance (self-view) | ✅ authored | ☐ | ☐ | **Smaller than previously stated** — the math (`driverPerformance/`) *and* the self-read RLS (`dpw_driver_scope`, already shipped in `0084`) exist. Only the read path + wiring `score.tsx` off sample data remain |
| 5E — Module entitlements | ✅ authored (D55) | ☑ **built** — **`0088_module_entitlements.sql`**: `org_modules` + `auth_module_enabled()` / `org_module_enabled()` (`stable security definer`, mirroring `auth_driver_id()`), **no in-tenant write policy at all** (an entitlement is a commercial fact — not even an org admin grants one), plus a **backfill and an on-insert trigger** seeding `dispatch` + `navigation` so neither existing nor new tenants lose a live capability; shared **`entitlements.ts`**; API **`requireModule()`** guard with the dispatch router behind it and modules on the driver bootstrap payload; web **`useModules.ts`** answering `false` while in flight so a surface never flashes | ☑ **RLS matrix 115/115** (+14 entitlement cases): absent key = disabled · a driver, manager **and admin** are all refused a self-grant · cross-tenant isolation · disabling for one org leaves another's grant intact | `org_modules` + `auth_module_enabled()`; enforced in RLS **and** API **and** UI. Gates 5M/5N/6/7. **No entitlement model exists today** — the audit found zero matches repo-wide |
| 5N — Notifications | ✅ authored (D53) | ☐ | ☐ | `notification_events` / `notification_reads` / `device_push_tokens`, Expo Push, top-bar bell + centre, per-category prefs + quiet hours, deep links, token revocation on offboarding |
| 5M — Messages | ✅ authored (D54) | ☐ | ☐ | Office↔driver threads optionally bound to a load; outbound via the Phase-2 outbox, inbound via Supabase Realtime (the first inbound path in the stack); dispatch inbox on the web |
| 6 — HazmatGuard (in the load flow) | ⏳ stub | ☐ | ☐ | Guided hazmat capture as a step **inside** the load flow (**not a tab** — D51), gated on `hazmatguard` once 5E exists. Authored when reached |
| 7 — Driver Safety Training (micro-LMS) | ⏳ stub | ☐ | ☐ | Video + quiz LMS under **More**, gated on `training`. Authored when reached |
| ~~Fuel Capture~~ | ❌ **removed (D41)** | — | — | Manual fuel logging is not a driver-app feature; it stays the web/manager surface |

**Locked at kickoff (amended by D41):** driver login = personal email + password · styling = NativeWind
(locked token config + token linter) · robust offline-first · full-stack (app + backend) · **app scope
= loads/assignments + planned navigation (+ performance, hazmat, training); manual fuel capture
removed.** See §9 for the full decision register.

---

## §2. Why this app exists

Today FuelGuard has **no driver-facing native app**. `docs/10-SAMSARA-RECONCILIATION.md` states it
plainly: *"There is no driver app… drivers never touch FuelGuard."* `docs/00-PRODUCT-OVERVIEW.md`
lists native mobile apps as an explicit non-goal ("the web app will be mobile-responsive instead").
The only driver surface is a mobile-responsive **web** fill-up form buried in the manager dashboard,
and the `driver` role is `none` on every section of the web app.

Drivers are the field endpoint of every load the fleet runs, yet they have no purpose-built tool. The
Driver App gives them a first-class, offline-first mobile experience they open every shift — see the
loads assigned to them, accept one, navigate a truck-safe route with planned-fueling stops, and
capture proof-of-work photos at each stop (JB-Hunt-style) — and becomes the delivery surface for the
rest of the already-planned driver features (performance, HazmatGuard, safety training). Fuel is woven
in as **planned-fueling stops on the route**, not a manual logging chore (D41).

**Product principles (from `docs/00-PRODUCT-OVERVIEW.md §8`, specialized for mobile):**

1. **Simple to use, serious underneath.** A driver accepts a load and clears a stop in a few taps; the platform keeps an enterprise audit trail.
2. **Glanceable over comprehensive.** Big numbers, one primary action per screen, status by color + label. Readable in 1–2 seconds at a dock or fuel island.
3. **Offline by default.** Drivers lose signal constantly. Accepting loads, navigation, and photo capture never block on the network.
4. **Design from tokens, never from literals.** No hardcoded colors, no inline styles — enforced in CI, exactly like the web app.
5. **Reuse the brain, rebuild only the skin.** Domain logic, validation, and rules come from `@fuelguard/shared`; only the UI is new.

---

## §3. Scope

### 3.1 What the app delivers (LOCKED — D41)

The driver app is the in-cab operations app for a fleet driver. Its deliverables, in build order:

1. **Foundation & identity** (Phases 0–1, **built**) — the Expo app, ported design system, driver
   login (personal email + password), secure offline-tolerant session, driver-scoped RLS.
2. **Offline data spine + Home** (Phase 2) — read cache + durable write/photo **outbox** + sync; a
   glanceable Home centered on the driver's **current assignment**, with the offline/sync UX.
3. **Assignments: equipment, loads & dispatch** (Phase 3 — the daily job) — three things that only work
   together (D43–D50): a driver **checks in with the truck and trailer they are actually driving** and
   can change either mid-shift; dispatch **creates, approves and releases** loads from the web dashboard
   (manually or from the McLeod feed) so nothing unreviewed reaches a phone; and the driver then sees
   upcoming / current / previous loads, accepts one, and works a guided, per-stop **photo capture** flow
   (loading, unloading, and each stop of a multi-stop run), JB-Hunt-style, queued offline through the
   outbox. Includes the **Dispatch** section on `apps/web` — Loads queue + approval, load editor,
   create form, and a live **Assignments** board.
4. **Driver Performance** (Phase 5) — the driver's own weekly score, sub-scores and rank (scoring math
   *and* the self-read RLS already built), read-only and self-scoped.
5. **Module entitlements** (Phase 5E) — `org_modules`, the gate every sellable module hangs off,
   enforced in RLS *and* the API *and* the UI.
6. **Notifications** (Phase 5N) — push + an in-app centre behind the top-bar bell, per-category
   preferences and quiet hours, deep links straight to the load or thread.
7. **Messages** (Phase 5M) — office↔driver threads, optionally bound to a load, offline-safe outbound
   and realtime inbound, with a dispatch inbox on the web.
8. **HazmatGuard** (Phase 6) — guided hazmat documentation captured as a step **inside the load flow**,
   gated on `hazmatguard`.
9. **Driver Safety Training** (Phase 7) — a micro-LMS (video + quiz) under **More**, gated on `training`.

**Navigation** is *not* in this list any more: **D52** moves it to its own programme, planned once the
app ships. Everything it will consume is already built server-side and stays untouched (§15).

Each phase ends in something runnable and demoable; later phases are authored in full only when
reached (the incremental rule, §0).

### 3.2 Removed from scope (D41)

**Manual fuel capture is not a driver-app feature.** The earlier plan made a 30-second fuel-logging
form the app's daily job; that is **removed**. Fuel entry stays the existing web/manager surface
(`apps/web` FillUpForm). In the driver app, fuel appears only as **planned-fueling stops within
navigation** — which **D52** moves to its own programme, so in the shipping driver app fuel does not
appear at all. Consequently the former "Fuel Log" / "Log fill-up" / "My Score" fuel tab shell,
the `POST /api/me/fillups` capture endpoint (D5), driver receipt storage (D13 — **repurposed** to
load/hazmat photo storage), the in-motion fuel-entry lockout (D35), and the fuel-write rate limits
(D32) are **superseded** — see the D41 note in §9. The infrastructure they informed (encrypted outbox,
client-UUID idempotency, offline photo staging, driver-scoped Storage) is **retained and repurposed**
for load-step and hazmat photos.

### 3.3 Non-goals (v1)

Live in-cab turn-by-turn *voice* navigation (target is corridor/maneuver guidance — §8); the training
video player and hazmat capture until their phases; real push delivery; multi-language.



---

## §4. Architecture

### 4.1 Where it lives

A new workspace package in the existing monorepo — **not** a separate repo. One `pnpm install`, one
`@fuelguard/shared`, one set of types.

```
FuelGuard/ (pnpm monorepo, Node 22, pnpm 10.34)
├── apps/
│   ├── web         Vue 3 dashboard (managers/admins)
│   ├── api         Express tenant API  ← the driver app calls this
│   ├── admin       Vue 3 platform console
│   ├── admin-api   Express platform API
│   └── driver      ★ NEW — Expo (React Native) app for drivers
├── packages/
│   ├── shared      ★ REUSED AS-IS — pure TS: types, Zod schemas, RBAC, rules,
│   │               smartFueling solver, driverPerformance math (only dep: zod)
│   └── ui          Vue components (NOT reused; design tokens ported by value)
└── supabase/       Postgres + RLS (next migration: 0083)
```

`pnpm-workspace.yaml` already globs `apps/*`, so `apps/driver` joins the workspace automatically.

### 4.2 Data & auth topology (unchanged backbone, new client)

```
┌──────────────┐   Supabase JS (anon key)          ┌─────────────────────┐
│  Driver App  │   signInWithPassword ───────────▶ │  Supabase Auth      │
│  (Expo/RN)   │                                    │  + custom-token hook│──▶ JWT { org_id, user_role }
│              │   Authorization: Bearer <JWT>      └─────────────────────┘
│              │                                             │
│              │   • direct PostgREST reads/writes (RLS)  ───┼──▶ Postgres (RLS by org_id + driver scope)
│              │   • server ops via apiFetch ───────────────┼──▶ apps/api (Express, verifies JWT via JWKS)
│              │   • Storage upload (receipts bucket) ──────┘
└──────────────┘
```

The driver app authenticates **exactly like the web app** — Supabase `signInWithPassword`, then a
Bearer JWT carrying `org_id` + `user_role` claims (Custom Access Token hook,
`supabase/migrations/0006_auth_hook.sql`). No new auth mechanism. `apps/api` verifies the JWT locally
against JWKS (`apps/api/src/lib/auth.ts`); no server changes needed to *authenticate* a driver.

### 4.3 The reuse contract (verified in audit)

`@fuelguard/shared` is pure TypeScript with a single runtime dependency (`zod`): **no Vue, no browser
globals, no Node built-ins.** The driver app imports the same modules the web app and API use:

- `auth.ts` — `USER_ROLES`, `SECTION_ACCESS`, `canViewSection`, `claimsToContext`, `isEmailDomainAllowed`.
- `fuel.ts` — `fillUpInputSchema`, `computeFillUpWarnings`, `derivePricePerGal`, `FuelTransaction`.
- `apiContract.ts` — shared request/response Zod schemas (invites, members, org).
- `smartFueling/` — the `planFuelStops` solver, `RouteFuelSettings`, alert thresholds.
- `driverPerformance/` — `combineWeek`, `rankTrailing`, scoring types.

**Consumption caveat (handled in Phase 0):** `@fuelguard/shared` ships raw `.ts` (its `exports` point
at `src/index.ts`, no build step). Metro (Expo's bundler) does not transpile workspace TS by default.
Phase 0 wires this via Metro `watchFolders` + monorepo config (low-friction path; no build step added
to shared). See §11.4.

### 4.4 Modularity model (how features stay isolated)

Mirror the web app's proven structure so the team's `check-feature-boundaries.mjs` mental model carries over:

```
apps/driver/src/
├── app/            expo-router routes (screens only; no business logic)
├── theme/          NativeWind config + token maps (the ONLY place colors exist)
├── components/     design-system primitives (Button, Input, Card, Badge, Field, StatTile…)
├── features/       one folder per domain: auth, fuel, home, (later) training, hazmat, fueling, performance
│   └── <feature>/  screens, hooks (TanStack Query), feature-local components
├── lib/            supabase client, apiFetch, secure storage, sync queue, uuid
└── data/           offline DB schema + sync adapter
```

Rules (enforced, §16): screens never contain colors or business logic; features never import each
other's internals; all domain logic comes from `@fuelguard/shared`; every color is a token.

**D56 — modular without exceptions (the rule, hardened).** The structure above described an intent
that nothing enforced. From Phase 3 onward a feature is not a folder, it is a **module**, and it is
not "done" until all six hold:

| # | A module owns | Enforced by |
|---|---|---|
| 1 | Its own `features/<name>/` in the app **and** in `apps/web` | `check-feature-boundaries.mjs`, extended to `apps/driver` and run in CI |
| 2 | Its own migration(s) — never a column bolted onto someone else's table | Migration review; `supabase db diff` clean |
| 3 | Its own contract file in `packages/shared` (parse-not-cast, D24) | Typecheck + the shared test suite |
| 4 | Its own RLS policies with allow **and** raw-PostgREST deny cases (D10) | `supabase/tests/rls.test.mjs` |
| 5 | Its own entitlement key where the module is sellable (D55) | 5E's three-layer gate |
| 6 | **No import of another feature's internals** — only `@fuelguard/shared` or an explicit public `index.ts` | The boundary linter |

The practical test: *switch the module off for one org and nothing else breaks.* If disabling
HazmatGuard blanks the load detail, or removing Messages breaks the top bar, the boundary was never
real. Every phase from here states which of the six it satisfies in its exit criteria.

---

## §5. Identity & access-control model

**Decision D1 — Driver login = personal email + password.** Drivers rarely have company email, so
driver-role invites relax the `organizations.allowed_domains` restriction that gates office users. One
auth mechanism (Supabase email/password), reused invite flow, minimal backend change.

Three precise backend gaps the audit surfaced (all addressed in Phase 1):

1. **`drivers.user_id` is dead.** The column exists (`supabase/migrations/0003_core_tables.sql`) but is
   never written and has no unique constraint. Phase 1 wires it at invite-accept and enforces
   uniqueness, so a logged-in driver deterministically resolves to their `drivers` row.
2. **The web dashboard does not gate out drivers.** A `driver` login would land on `/` and read most
   data. Phase 1 adds a role redirect so drivers cannot use the web app.
3. **RLS is too broad for a driver.** Every org member can `select` all fleet data today. Phase 1 adds
   driver-scoped policies (own `driver_id` / assigned vehicle) plus a driver-scoped capture path.

**Invite flow (reused, one change):** Admin invites a driver from the dashboard (`POST /api/invites`
with `role:'driver'`) → branded email link → driver sets password in-app → `POST /api/invites/accept`
upserts the membership. The single change is relaxing the domain check for `role:'driver'` and
linking the `drivers` row on accept. Full spec in §12.

---

## §6. Design system port

**Decision D2 — Styling = NativeWind with a locked token config + a token linter.** Mirrors the web
app's Tailwind v4 mental model and its enforcement (a CI script that fails on raw palette classes,
hex, or inline color styles), so web and mobile stay one visual system.

The web design system is a three-layer OKLCH architecture (`packages/ui/src/tokens.css`,
byte-parity-checked against `apps/web/src/style.css`): **primitive ramps**
(`neutral/brand/danger/caution/warning/success/info`, brand = indigo) → **semantic roles**
(`surface`, `ink`, `edge`, …) → utilities. The port reproduces this by value:

- **Tokens** live in `apps/driver/src/theme/` as a NativeWind/Tailwind config: same ramps (OKLCH →
  precomputed hex for RN compatibility), same semantic role names, and a **light + dark** role map
  (web ships light only; the driver app builds dark now — night driving needs it).
- **Components** consume only semantic roles (`bg-surface`, `text-ink`, `ring-edge`) — never
  `indigo`/`#hex`. Variant taxonomy matches web primitives (`Button`: primary/secondary/danger/soft/
  ghost; `Input`; `Card`; `Badge` with severity tones).
- **Enforcement:** a `check-design-tokens.mjs`-equivalent for RN wired into `pnpm lint:tokens` + CI.
  This is what operationally guarantees "no inline designs, no hardcoded colors."
- **Typography:** system font stack (matches web — no custom font to bundle), same scale (`xs 12 /
  sm 14 / base 16`, weights 500/600/700), Dynamic Type support.
- **Anti-"generic-AI" rules:** one purposeful brand color used functionally; disciplined neutrals;
  reserved semantic colors carrying meaning; real typographic hierarchy via size/weight, not
  gradients; flat honest surfaces; motion restraint. No purple gradients, no decorative blur, no
  gradient text.

The concrete token values live in §11.3 (Phase 0). Once Phase 0 is built, they graduate into a
standalone `DRIVER-APP-DESIGN-SYSTEM.md`.

---

## §7. Offline-first strategy

**Decision D4 — Split the read cache from the write outbox; start lightweight; defer WatermelonDB.**

- **Reads:** TanStack Query (React) with a disk persister + `onlineManager` wired to NetInfo, so
  cached context (vehicles, driver, recent fills) is available offline.
- **Writes:** a durable **SQLite outbox** — pending mutations replayed when connectivity returns.
- **Idempotency is already solved:** the fill-up primary key is a **client-generated UUID** (web
  pattern, `apps/web/src/lib/uuid.ts`), generated once per form. Replaying a queued insert is safe —
  a duplicate PK insert fails rather than double-writing. The queue is designed around this.
- **Receipt photos:** captured with `expo-camera`/`expo-image-picker`, compressed with
  `expo-image-manipulator`, staged to `expo-file-system`, uploaded by the sync engine.
- **Why not WatermelonDB now (O2):** v1's data is small and mostly read-cached; the only hard
  requirement is a reliable offline write path. A focused outbox is less machinery and easier to
  verify. Revisit only if read-sync complexity grows. Detail in §13.

---

## §8. Maps & navigation approach

Aligned to the existing HERE investment and Expo constraints:

1. **Routing stays server-side on HERE** (already built: truck profile + hazmat class + tunnel
   category). The app requests a plan/route and receives geometry + maneuvers + fuel stops.
2. **On-device display** with **MapLibre RN / react-native-maps**: render the HERE polyline, maneuver
   cards, and **fuel-stop overlays** in branded UI. Expo-friendly, no second vendor.
3. **True offline voice turn-by-turn** (if field testing proves the need) graduates later to a **HERE
   SDK Navigate Edition** native bridge behind an Expo **config plugin / dev client**. Consequence for
   v1: **use Expo dev builds from day one** (nav SDKs and several native modules don't run in Expo Go).

> **Superseded by D52 (2026-07).** Navigation is no longer a driver-app phase — it is planned as its
> own programme once the app ships, and the *display-only vs true turn-by-turn* choice above moves
> with it. Points 1–2 remain true of what is already built server-side; point 3's licensing, cost and
> native-bridge work belongs to that programme. §15 is the handover note.
>
> **One consequence stays binding regardless:** adopt the **Expo dev-build workflow from day one** —
> several native modules already in the stack (`expo-sqlite` with SQLCipher, `expo-image-manipulator`,
> reanimated 4) and `expo-notifications` in Phase 5N do not run in Expo Go.

---

## §9. Locked decisions register

**This table is the single source of truth.** Where anything else in this document — including the
audit rounds §20–§24, which are historical provenance — disagrees with a row here, this row wins.
Every active row is written to be implementable **without a judgement call**: no "and/or", no
"decide at build time", no unresolved alternatives. Rows that no longer apply are kept, tagged, and
point at their replacement, so a decision is never silently dropped.

| Tag | Meaning |
|---|---|
| *(untagged)* | **LOCKED** — implement exactly as written |
| **✏️ AMENDED** | Still active, but the text was corrected during the 2026-07-27 cleanup (usually because the built code diverged) |
| **⛔ SUPERSEDED by Dxx** | Replaced. Kept only so the change is traceable — implement Dxx |
| **🚫 RETIRED** | No longer applies at all. Where a replacement exists it is named |
| **⏸️ DEFERRED** | Deliberately postponed to a named programme; do not act on it now |

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | Driver login = **personal email + password**; relax `allowed_domains` for `role:'driver'` invites only | Drivers lack company email; keeps one auth mechanism; minimal backend change (phone/OTP deferred, O1) |
| **D2** | Styling = **NativeWind** + locked token config + token linter | Parity with web Tailwind v4 + lint-based token enforcement (`check-design-tokens.mjs` model) |
| **D3** | Driver invites carry a **`driver_id`**; on accept, set `drivers.user_id` | Deterministic attribution; avoids fragile email/phone matching |
| **D4** | Offline = **read cache (TanStack Query persisted) + durable SQLite outbox**; WatermelonDB deferred | Only hard need is reliable offline writes; less machinery, easier to verify |
| **D5** | **🚫 RETIRED (D41).** Fuel capture syncs via a driver-scoped endpoint `POST /api/me/fillups` that scores server-side. **The endpoint is not built and must not be.** Manual fuel capture left the driver app; the *pattern* (driver-scoped endpoint, server-derived identity, server-authoritative processing) survives in `/api/me/shift/*` and `/api/me/loads/*` | Existing scoring route is manager-only (403s for drivers); keeps scoring server-authoritative |
| **D6** | Auth token storage = **`LargeSecureStore` (REQUIRED, not optional)** — AES-256 key in expo-secure-store, ciphertext in AsyncStorage — with `processLock` + AppState autorefresh + refresh-token rotation & reuse detection | Plain AsyncStorage is unencrypted (device theft/backup/root = refresh-token takeover); expo-secure-store's ~2KB limit rules out the raw session. Upgraded from "optional" by the security audit (§21 SB4) |
| **D7** | `@fuelguard/shared` gets a **real build step** (tsc emit to `dist/` + an `exports` map with a `react-native`/`default` condition); web/api keep consuming source | Metro cannot resolve the 134 `.js`-suffixed→`.ts` specifiers; a build step is the clean fix (§20 B2). Additive; does not change web/api behavior |
| **D8** | Monorepo wiring: add root **`.npmrc` `node-linker=hoisted`**; `apps/driver/package.json` **omits `"type":"module"`**; Metro configured for the workspace | pnpm symlinks break RN autolinking; Expo config files are CJS (§20 B3, F5) |
| **D9** | Restrict drivers at the DB with **RESTRICTIVE RLS policies** (AND-combined) scoped to `auth_role()='driver'` — covering **SELECT and INSERT** — leaving existing manager PERMISSIVE policies untouched. **Current coverage (keep this list current; it is the checklist):** `drivers`, `vehicles`, `fuel_transactions`, `driver_performance_weeks`, `anomalies`, `memberships`, `anomaly_thresholds` (`0084`); `loads`, `load_stops`, `load_stop_photos` (`0085`); `driver_duty_sessions`, `duty_equipment_segments`, `trailers`, `driver_time_off`, `tms_movements` (`0086`); `load_events` (`0087`); `org_modules` (5E); `notification_*`/`device_push_tokens` (5N); `message_threads`/`thread_participants`/`messages` (5M). **A new module's tables are added here in the same migration that creates them (D56)** | Existing `*_select` policies are permissive (OR); adding a scoped policy only *broadens*. RESTRICTIVE tightens drivers without touching managers. **Extended by the security audit to INSERT** (attribution forgery — §21 SB1) |
| **D10** | **DB is the authorization boundary.** RLS must hold even against **raw PostgREST** (a driver has the anon key + JWT and can bypass `/api/me/*`). Every driver policy gets an allow **and** a raw-PostgREST **deny** test in `rls.test.mjs` | The driver app ships the exact credentials to call PostgREST/Storage directly; the API endpoints and web gate are convenience/UX, not security (§21) |
| **D11** | Invite/set-password deep link = **PKCE flow** (`flowType:'pkce'`) + **verified App Links / Universal Links** (not just the `fuelguard://` custom scheme); never log deep-link URLs/tokens | Custom schemes can be hijacked (scheme squatting) → auth-code interception; PKCE + OS-verified links neutralize it (§21 SB5) |
| **D12** | **Encrypt data at rest on device:** SQLCipher-encrypted offline outbox (expo-sqlite `useSQLCipher`, key in SecureStore); staged **load/hazmat photos** kept in-sandbox, **deleted only after a confirmed sync**, min dwell; **EXIF stripped** before any photo is written or uploaded (D41 repurposed this from fuel receipts) | Outbox holds odometer/location/cost PII + receipts on a device that can be lost/rooted; camera EXIF leaks driver home GPS (§21 SB adjacent, F3/F4) |
| **D13** | **✏️ AMENDED — driver-scoped photo storage** (repurposed from receipts by D41; reverses §20 F4). **As built in `0085`:** bucket `load-photos`, path **`${org_id}/${driver_id}/${load_id}/${photo_id}.webp`** (segment 1 = tenant isolation, segment 2 = driver isolation), per-op policies enforcing `split_part(name,'/',2)=auth_driver_id()`, bucket `file_size_limit` + `allowed_mime_types`, **no `upsert` and no DELETE for drivers** (a delivered photo is evidence), signed-URL reads. Phase 6 hazmat photos reuse this exact bucket and path shape | Existing `receipts` RLS is only org-scoped with `upsert:true` → a driver could read/overwrite/delete others' receipts (evidence tampering) and upload huge/malicious files (§21 SB2) |
| **D14** | **Offboarding is an explicit atomic action:** deactivate/delete membership **+** `auth.admin.signOut(userId,'global')` **+** `drivers.status='inactive'`; add `on delete set null` to `drivers.user_id`; **revoke push tokens** (`device_push_tokens.revoked_at`, D53) so an offboarded driver's personal phone stops receiving fleet data; **close any open duty session** with `ended_reason='dispatch'` so their truck is released (D43). **Session lifetime is D31's `jwt_expiry = 3600s`** — the earlier "~15–30 min" here was superseded by D31 and is removed to end the conflict | Today `drivers.status` is inert and membership-delete doesn't revoke live tokens → a fired driver keeps access until token expiry; the new FK also blocks `deleteUser` (§21 SB3) |
| **D15** | **Prove email ownership for driver invites:** **enforce the invite `token` in `POST /invites/accept`** (acceptance bound to a server-verified secret). **BUILT.** Email confirmation is **not** additionally required — `enable_confirmations` may stay off (§24 O11); the token is the proof. The earlier "and/or" left an implementer choosing; there is no choice | Domain relaxation + `enable_confirmations=false` + accept-by-email = an attacker who knows a driver's personal email could self-register and accept the invite first (§21 SB6) |
| **D16** | **Supabase auth-hardening config gates (pre-launch):** leaked-password protection (HIBP) on, `minimum_password_length ≥ 10` + complexity, captcha on sign-in/sign-up, **app-level lockout after 10 consecutive failures for one email within 15 minutes, released after 30 minutes** (keyed on email + `sub`, never IP alone — drivers share carrier NAT); confirm production **MFA is actually enabled** for platform admins | Personal-email drivers → weaker passwords; current config is min-length 6, no HIBP, per-IP-only limits, captcha off (§21 SB adjacent) |
| **D17** | **⛔ SUPERSEDED by D51.** Original: bottom tab bar with a center action opening the current load — **Home · Loads · (center) Navigate · My Score · More**. Still true: the per-stop photo capture + hazmat flows are full-screen **modal routes** over the shell. Training lives under **More**; HazmatGuard lives **inside the load flow**. expo-router route groups. **Changed by D51:** four tabs (**Home · Loads · Score · More**), the center slot **reserved but not rendered** (navigation is D52), and Messages + Notifications as **top-bar icons**. Read D51 + §22.1, not this row | Superseded — kept only so the change is traceable |
| **D18** | **Modern UX library stack** (pins in §22.2): Reanimated 4 + worklets, gesture-handler, **FlashList v2**, @gorhom/bottom-sheet v5 (or Expo UI native sheet), **react-hook-form + zod resolver**, **react-native-keyboard-controller**, expo-haptics, one bundled **variable typeface** via expo-font; Skia only for a gauge/sparkline. **✏️ Amended against what shipped:** icons are **Material Symbols (D40)**, not lucide — `lucide-react-native` is not a dependency and must not be added; the **`style-dictionary` pipeline was dropped** — tokens are hand-authored in `apps/driver/src/theme/tokens.ts` with `lint:tokens` as the enforcement, which is the model to keep; the sheet is **`@gorhom/bottom-sheet` v5** — the "or Expo UI native sheet" alternative is closed | Native-thread motion, buttery lists, sticky-keyboard fast entry, and a real identity — the difference between "web app in a shell" and premium (§22.2) |
| **D19** | **Warning ladder is tokenized, never a native `Alert`.** Inline field caution → summary banner → blocking **confirm sheet** (danger) for a destructive or irreversible step — post-D41 the live cases are **taking over another driver's truck** (D44), **skipping a required stop photo** (D21), **declining a load** (D46) and **ending a shift**; every warning pairs **icon + label** (never color alone) | Native `Alert` breaks the design system; color-only warnings fail accessibility + sunlight (§22.4) |
| **D20** | **Motion + haptics tokens.** 120–200ms ease-out; springs only for physical drag; haptic map (Success on save, Warning on over-capacity confirm, Selection tick on pickers, Light impact on primary CTA). **Visual feedback is always primary; haptics enhance** (silent in iOS Low-Power/off); honor reduce-motion | Undefined motion is where an app drifts generic/janky; haptics can't be the only signal (§22.4) |
| **D21** | **✏️ AMENDED — correction model (was "fill correction", now the general rule).** Anything **pending (unsynced)** is **editable/deletable** by the driver; once synced it is read-only with an explained "locked — contact dispatch" (a correction-request flow is a later enhancement). **Never a dead-end:** a required stop photo that cannot be taken needs an explicit reason, not a blocked screen; a wrong truck at check-in is fixed by a swap (D44), not by being stuck. Applies to duty segments, stop photos, hazmat capture and messages | Fuel-island fat-fingers are inevitable; a locked read-only detail with no recourse is a real failure (§22.6) |
| **D22** | **Accessibility spec (WCAG 2.2 AA).** Verified contrast in **both** themes; ≥48pt primary targets; live-region announcements for offline/sync/save; reduced-motion variants; `allowFontScaling` on; screen-reader `role`/`label`/`value` on every control + metric; token linter also audits target size | Earlier drafts *asserted* a11y; §22 *specifies* it — the only way it doesn't silently fail (§22.7) |
| **D23** | **Visual identity (anti-slop).** One intentional variable typeface with **tabular numerals**; **big glanceable tabular hero numerals** as the signature; **Material Symbols (D40)** at one consistent weight/grade; palette from fuel/logistics — **no indigo→purple gradients, no decorative blur/glass, no gradient text**; night theme on near-black (not pure #000), high-contrast day theme for glare | Turns the named anti-AI rules into concrete artifacts — where genericness actually enters (§22.8) |
| **D24** | **End-to-end typed contract.** Shared **request + response** Zod schemas in `packages/shared/` for every driver endpoint — **one contract file per module (D56)**: `driverContract.ts`, `loadsContract.ts`, `dutyContract.ts`, and one each for entitlements, notifications and messages as those land; the client **parses every response — API *and* direct-PostgREST — fail-closed** (never `as T`; never cache/enqueue an unparsed payload). Shared typed `apiErrorCode` enum + a documented **retry/backoff/timeout** policy (GETs and every **client-UUID-keyed** write retryable — `shift_start`, `shift_equipment`, `shift_end`, `load_accept`, `load_decline`, `load_stop`, `message_send`; 4xx→dead-letter; `AbortController` timeouts) | The existing web client casts `payload as T` with zero runtime validation and the response schemas are dead code — an offline app that caches to disk for hours must not trust drifted shapes (§23.2 F1/F2) |
| **D25** | **Distribution = private/internal, not public.** Apple **Custom Apps via Apple Business Manager** (skips App Review) with an Unlisted fallback; Google **Managed Google Play private app** (org-scoped). Store *guidelines still apply* — this reduces friction, not compliance | Single-company fleet app, invite-only; private distribution removes the 4.2/4.3 "thin app" rejection vectors and keeps it out of public discovery (§23.3) |
| **D26** | **In-app account deletion + web deletion URL.** `POST /api/me/delete-account` (deletes the Supabase auth user + unlinks `drivers.user_id` + purges device data); a Settings "Delete account" control (not email-only); a public `…/delete-account` web page for Google Data safety. Fuel records may be retained per employer recordkeeping, disclosed | Apple 5.1.1(v) **mandates** in-app deletion for any app with account creation; Google requires in-app + web URL. Invite-only is **not** exempt (§23.3) |
| **D27** | **Store config: declare only what's used.** Privacy Manifest (`privacyManifests`: UserDefaults/FileTimestamp/DiskSpace/BootTime reasons; `NSPrivacyTracking=false`); specific iOS usage strings; `usesNonExemptEncryption:false`; **no SIWA** (own-account exemption), **no ATT** (no cross-app tracking), **no background location**, **no broad media perms** (system Photo Picker); Android foreground-service audit; privacy-policy URL; nutrition labels + Data-safety matching requested permissions | These are the deterministic 2026 rejection traps; adding SIWA/ATT you don't need can itself cause rejection (§23.3) |
| **D28** | **Type-safety hardening.** Client **parses, never casts**; type-aware ESLint for `apps/driver` (`no-unsafe-*`, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions`, `consistent-type-imports`); `@fuelguard/shared` build **emits `.d.ts`** + a CI **`dist`-freshness gate** (prevents web-source↔RN-dist drift); enable `exactOptionalPropertyTypes`/`noPropertyAccessFromIndexSignature`/`noImplicitReturns` in `tsconfig.base`; `supabase gen types` + drift check; **expo-router typed routes**; add `.tsx` to the file-size linter | The "100% type-safe" claim is currently false (casts + non-type-aware lint + no `.d.ts` emit). Runtime validation at every I/O boundary is the real guarantee (§23.4) |
| **D29** | **Reliability & performance patterns.** True **keyset pagination** (no `count:'exact'`); **decouple `scoreWithCascade` from the client ack** (respond-then-score) + Railway keep-warm; **parallelize the launch bootstrap** (or one `/api/me/driver` bootstrap payload); offline-boot session handling (gate reads on cached session; never sign-out on a refresh network error); idempotent receipt↔insert compensation; **Sentry** + a `contract_drift` event + a contract-drift CI test | Kills the launch waterfall, cold-start tax, and silent contract rot; makes sync fast and reliable on spotty connectivity (§23.2) |
| **D30** | **⛔ SUPERSEDED by D43 — this row and D43 previously contradicted each other.** Original: driver↔vehicle scope = `vehicles.assigned_driver_id` (resolved O18). It's the model the existing fuel-capture flow already uses for attribution (`FillUpForm`, fleet UI). `driver_vehicle_assignments` (`0051`) stays a **telematics/idle-analytics history** table (used by scoring/Samsara/idle only) — **not** used for driver-app scope. **Under D43 `assigned_driver_id` is the *domicile default* — the truck pinned as "Your truck" in the picker — and the **duty segment is the truth**. `vehicles_driver_scope` was widened accordingly in `0086`. Still true: `driver_vehicle_assignments` (`0051`) is telematics history, not driver-app scope (D50). **Note:** the index `vehicles(org_id, assigned_driver_id) where assigned_driver_id is not null` this row called for was **never created**; add it with the 5E migration or drop the requirement — the pick list reads the column on every check-in | Superseded — kept so the change from "static column" to "time-ranged session" is traceable |
| **D31** | **Driver session lifetime:** `jwt_expiry = 3600s` (1h — the fired-driver revocation window); refresh-token **rotation + reuse-detection ON**; **inactivity timeout 7 days**; **absolute time-box 30 days**. High-security fallback: `jwt_expiry 1800s` | Active drivers effectively never re-login; a revoked driver's token dies ≤1h after `admin.signOut`. Balances security vs field UX (§24, resolves O12) |
| **D32** | **🚫 RETIRED (D41) → replaced by D57.** Original: per-`sub` token bucket 12/min, 30/hr on `POST /api/me/fillups` with a 20-fills/day business cap. The endpoint no longer exists, but driver writes very much do — D57 re-locks the limits against the endpoints that were actually built | A real driver logs ≈1–5/day; generous headroom that still stops runaway retries / token abuse. Keyed on `sub`, not IP (drivers share NAT) (§24, resolves O14) |
| **D33** | **Push transport (still LOCKED — this is the transport layer under D53).** Expo Notifications + server-side sends via the Expo Push API for v1; store both the Expo push token and the native FCM/APNs token. **Graduate** to a managed provider (OneSignal/Courier) at ~**10k+ devices** or the first need for delivery analytics / web push / cross-channel | Free, first-class, covers hundreds–low-thousands of drivers (Expo ceiling 600 notif/sec/project) with a non-breaking migration path (§24, resolves O5) |
| **D34** | **No certificate pinning in v1.** Compensating controls: TLS 1.3 + HSTS, system-trust-store only (Android `networkSecurityConfig`, iOS ATS), short JWT (D31), server-side anomaly/geo monitoring, MDM CA control. Fallback if threat rises: dynamic pinning (Approov) or intermediate-CA SPKI + backup pin behind a remote kill-switch | A static pin can't be OTA-patched; a mis-timed cert rotation bricks every install. OWASP treats static pinning as a liability at moderate sensitivity (§24, resolves O13) |
| **D35** | **🚫 RETIRED as fuel-specific (D41) → replaced by D58.** Original: lock manual fuel entry above 5 mph with an "I've parked" attestation. Manual fuel entry is gone, but photo capture, hazmat forms and message composition are still manual entry in a moving truck — D58 re-locks in-motion safety against the surfaces that exist | Fuel logging is manual entry → NHTSA per-se lockout in motion; GPS Doppler speed is the reliable low-friction signal (§24, resolves O17) |
| **D36** | **✏️ AMENDED — the app ships Hanken Grotesk, not IBM Plex.** `apps/driver/app/_layout.tsx` loads `HankenGrotesk_400/500/600/700` via `@expo-google-fonts/hanken-grotesk`; the ledger's "deferred: IBM Plex" note left this reading as unresolved for months. **Locked:** Hanken Grotesk (OFL, bundled) is the UI face. **The requirement that drove D36 stands:** numeric readouts — odometer, gallons, MPG, scores — need **genuine tabular figures** so columns do not jitter. **T10** verifies tabular figures on device; if Hanken Grotesk lacks them, bundle **IBM Plex Mono for numerals only** rather than reopening the UI face | Industrial/engineered identity (not generic Inter/Roboto), license-clean to bundle, tabular numerals for jitter-free fuel/odometer columns (§24, resolves O16, satisfies D23) |
| **D37** | **⏸️ DEFERRED with D52 — decide inside the navigation programme, do not procure yet (T8 is on hold).** Original: map tiles/styles = MapTiler Cloud (vector tiles + hosted styles + MapLibre offline packs); fallback/cost-optimization: self-hosted **Protomaps PMTiles** (a single `.pmtiles` on object storage = an offline pack, no per-tile fees, no lock-in) | Managed, predictable per-MAU pricing for a bounded driver roster, offline support, OpenMapTiles schema → self-host escape hatch is real (§24, resolves O10) |
| **D38** | **Numeric entry = native `decimal-pad`** in v1 (accessible, fast, familiar) with the large-value display + sticky submit; a custom glove keypad is deferred unless post-launch field data shows a need | Removes the build-time keypad question; native pad is the accessible default (§24, resolves O15) |
| **D39** | **v1 build order (retargeted by D41):** Phases 0–1 (foundation + identity, **built**) → Phase 2 (offline spine + Home) → Phase 3 (**Assignments: equipment, loads & dispatch** — the daily job) → Phases 5 / 5E / 5N / 5M (Performance, Entitlements, Notifications, Messages) → 6 (Hazmat) → 7 (Training). **Amended by D52:** navigation is no longer in this order at all. | Ships identity + the loads spine first, then the surfaces that make the daily job complete; Supersedes the former fuel-capture-first order (§24 O6) |
| **D40** | **Icon system = Material Symbols** (default **Rounded**, **Outlined** available, **fill** variants), baked at **weight 200 / grade 200 / opsz 24** as subset static font instances (~92KB for all 4), rendered via `<Icon name … variant fill className>` with a generated codepoint map + a `gen-material-symbols.py` regen script. Supersedes the earlier lucide mention (D18/D23) | User spec; RN can't set grade/fill axes at runtime, so instancing is the only precise way. Self-hosted, no runtime dep, token-colored |
| **D41** | **Scope pivot — the driver app is a loads/assignments + planned-navigation app, not a fuel-capture app.** Deliverables: (0–1) foundation + identity ✅, (2) offline spine + Home, (3) **Loads & Assignments** — see/accept loads + per-stop proof-of-work photos (JB-Hunt-style), (4) **Planned Navigation & Fueling** (route + planned-fueling stops, display-only over HERE), (5) Driver Performance self-view, (6) HazmatGuard **inside the load flow**, (7) Safety Training. **Manual fuel capture is removed** (stays a web/manager surface); fuel = planned-fueling stops in navigation. **Supersedes/repurposes:** D5 (fuel-capture endpoint), D32 (fuel-write rate limits), D35 (in-motion fuel-entry lockout) are **retired as fuel-specific**; D13 (receipt storage) is **repurposed** to driver-scoped load/hazmat photo storage; D17 (tab shell) + D39 (build order) **retargeted** to loads/nav — *and both since superseded again, by D51 and D52 respectively; the "(4) Planned Navigation & Fueling" deliverable in this row is **removed by D52***; the Phase-2 outbox + client-UUID idempotency + EXIF-stripped photo staging are **kept and reused** | User direction (2026-07): the daily driver job is running loads, not logging fuel (which already exists on the web). Building around loads/navigation matches how drivers actually work (JB Hunt / Samsara / Motive) and uses the already-built assignment/route/fuel-plan backend (`0051`, `0059`/`0060`, `0074`, `0058`, `0068`, `tms.ts`, `smartFueling/`) |
| **D42** | **The driver load domain is greenfield — build it, seed it manually, keep the TMS seam open.** New `loads` / `load_stops` / `load_stop_photos` + driver-scoped `load-photos` storage (`0085`). Drivers are **read-only** at the DB; accept + stop-completion go through the driver-scoped API (server-derives identity). Provenance columns (`source`/`provider`/`external_id` + partial unique index) let a McLeod/TMS feed or a web dispatch UI adopt the same tables later with no migration | Discovery (§14.2) disproved the plan's assumption that loads existed: `0051` is idle-attribution telematics, `0068` is reefer context, `features/jobs` is import progress. Building greenfield unblocks the driver app now; the provenance columns mean the eventual TMS feed is an ingest change, not a rewrite |
| **D43** | **Equipment truth is a time-ranged duty session, not a column.** New `driver_duty_sessions` + `duty_equipment_segments` (`0086`): a driver checks in with a truck and (optionally) a trailer; every truck/trailer change writes a new segment so equipment is exact at any instant. Partial unique indexes enforce one active session per driver and one *driver*-seat holder per truck/trailer; a `seat` column keeps team driving representable. `vehicles.assigned_driver_id` is **kept but demoted** to a default/pin, and `driver_vehicle_assignments` (`0051`) is documented as Samsara-inferred history that a duty segment outranks | §14.2b: nothing in the schema modelled a shift, so a slip-seat, shop loaner or mid-week swap silently mis-attributed fuel, idle and MPG until an admin edited a row. Segments make `where from_at <= t and (to_at is null or to_at > t)` an exact attribution lookup — the query the detection engine approximates from Samsara today |
| **D44** | **The check-in is a staged soft gate, never a login wall.** No blocking modal at launch (Home shows a *Start your day* card); **vehicle required, trailer optional** at start ("bobtail / not hooked yet" is first-class); **trailer required before completing a pickup** on a trailer-equipment load; working a load with no session prompts inline and returns the driver where they were; sessions auto-close after `duty_session_timeout_hours` (default 16) with `ended_reason='auto_timeout'`; choosing a held truck returns **409** with take-over / pick-another / tell-dispatch, never silent theft; all three shift mutations are outbox kinds with client-UUID PKs and an offline check-in is **provisional** until the server resolves conflicts | A hard login gate strands a driver who opens the app before hooking a trailer, and the trailer is often unknown until the shipper. The auto-close rule is *required*, not a nicety: without it the exclusive-vehicle index jams on the first driver who forgets to sign off. Silent take-over would corrupt a week of attribution for two drivers at once |
| **D45** | **A load is not driver-visible until a human approves and releases it.** Lifecycle becomes `draft → pending_approval → approved → offered → accepted → in_transit → delivered` (+ `canceled`, + decline back to `approved`); `status` **default changes from `offered` to `draft`**; approval/release actor+timestamp columns added; `loads_driver_scope` (and the stop/photo scopes) additionally require `status in ('offered','accepted','in_transit','delivered','canceled')`; transitions are enforced in three layers — a shared `LOAD_TRANSITIONS` map + `approvalChecklist()`, per-transition API endpoints (never a `PATCH status`), and a `loads_status_guard` trigger; an append-only `load_events` table is the dispatch timeline | §14.2b: `0085` defaults to `offered` and `loads_driver_scope` makes any row with a matching `driver_id` instantly readable — an unreviewed row (including anything a McLeod feed writes) is on a phone the moment it is inserted, and approval had nowhere to live. RLS is this app's authorization boundary (§1), so the gate must be expressed there or it is not a gate |
| **D46** | **One accept mechanism, two semantics.** `drivers.driver_type` (`company` \| `owner_operator`, org default + per-driver override) selects the copy and the unassign rule, not a second state machine: company drivers get **I'm ready** / **Can't take this** (logs a decline event + dispatch exception, does **not** auto-unassign); owner-operators get **Accept** / **Decline** with a reason (returns the load to `approved`, clears `driver_id`, alerts dispatch). Both write the same `load_events` and hit the same endpoints | A carrier runs both populations on one fleet. Forking the state machine would double the surface for a difference that is really a label and one conditional |
| **D47** | **Planned vs actual equipment: flag, never overwrite, never block.** `loads.vehicle_id`/`trailer_id` are dispatch's *plan*; the driver's current duty segment is the *actual*. A mismatch at accept or first pickup writes an `equipment_mismatch` event, shows a caution chip to the driver and an exception to dispatch, and offers dispatch a one-click **Adopt driver's equipment** | Fleets swap trucks constantly, so blocking strands drivers; silently overwriting destroys dispatch's audit trail. Flagging is the only defensible option — and the flag is the same class of evidence FuelGuard sells elsewhere |
| **D48** | **TMS loads land in `pending_approval`; amendments never overwrite silently.** `tmsIngest` gains a `loads` writer (McLeod MovementService + StopService → `loads`/`load_stops`, `source='tms'`, idempotent on the existing `(org_id, provider, external_id)` index) writing **`pending_approval`**; `org_integrations.config.auto_approve_loads` defaults **false** and enabling it is audited; a re-sync touching a load past `approved` writes an `amended` event with the field diff for dispatch to apply or dismiss, and a TMS cancellation of an accepted load is an urgent exception + driver push, never a vanishing row | The provenance columns from D42 opened the seam but nothing defined *who authorizes* an ingested row. Auto-releasing a feed straight to a phone is exactly the failure this phase exists to prevent; opt-in auto-approve lets a mature customer skip review once mapping is trusted |
| **D49** | **Build the dispatch surface in Phase 3 (work package 3D), not "later."** `apps/web/src/features/dispatch/**` under the **existing** Dispatch nav section (`auth.ts` already grants `dispatch: manage` to admin/fleet_manager/dispatcher — no auth change): **Loads** queue with the approval checklist, load detail/editor with stops + required-photo builder + `load_events` timeline, **Create load**, **Assignments** (live duty board + history), **Exceptions**. Retires `seed_driver_load.sql` | §14.2 previously rejected a dispatch UI as "a second full feature." That reasoning does not survive D45: an approval gate operated from a SQL editor is not an approval gate. Loads must be creatable, assignable, approvable and releasable in a browser or Phase 3 has no input |
| **D50** | **Terminology lock — "assignment" stops meaning three things.** **Equipment assignment** = the domicile default (`vehicles.assigned_driver_id`); **duty session** = driver + equipment over time (`0086`); **load assignment** = `loads.driver_id` plus its release state. `driver_vehicle_assignments` (`0051`) keeps its telematics job and is annotated in place as a non-truth-source | The single word was carrying a static admin column, a Samsara inference table, and a dispatch decision — which is how the plan came to assume all three existed when only the first did |
| **D51** | **Information architecture — four tabs, a reserved center slot, two top-bar icons.** Bottom bar: **Home · Loads · Score · More**, capped at five including the reserved center. **Messages** and **Notifications** are **top-bar icons with full pages**, not tabs. **Hazmat is a step inside the load flow** (auto-inserted when `loads.hazmat`), with reference material under **More** — never a tab. The tab label reads **"Loads"** while the page header reads **Assignments**. Contextual work (stop capture, hazmat step, duty check-in) is a modal route over the shell. Full rationale + route tree in §22.1 | A driver's bar should hold what they open *without a reason*; anything opened *because something happened* belongs in the top bar or in context. Messages/notifications are interrupt-driven and would sit idle in a permanent slot. Hazmat is not a place — it is something a load requires, and a standing tab would invite hazmat paperwork detached from its load. "Loads" is driver vocabulary and fits the 11px label where "Assignments" truncates |
| **D52** | **Navigation is deferred to its own programme.** Phase 4 (Planned Navigation & Fueling) leaves the driver-app critical path and is planned separately once the app ships. The **center tab slot is designed in but not rendered**; `navigate.tsx` / `drive.tsx` stay as the seam. Everything server-side it would consume — `0059`/`0060` route geometries, `0074` fuel plans, `0058` smart-fueling spine, `packages/shared/src/smartFueling/` — is already built and untouched. Choosing between *display-only corridor guidance* (the former §8 position) and *true turn-by-turn on HERE SDK Navigate Edition* moves into that programme, along with its licensing, per-driver cost, native config-plugin bridge, offline map packs and background-location store declarations | User direction (2026-07). Navigation is a product of its own scale, and the audit showed nothing was built (`navigate.tsx` is a redirect stub, MapLibre is not a dependency, MapTiler T8 not procured, no HERE Navigate licensing task exists anywhere). Cutting it out of the critical path lets the daily job — check in, see loads, accept, capture proof, get told things — ship complete |
| **D53** | **Notifications are a first-class module** (Phase 5N): `notification_events` + per-user `notification_reads` + `device_push_tokens`, Expo Push delivery, a driver **notification centre** behind the top-bar bell, per-category preferences and quiet hours, and deep links that open the exact load or thread. Categories: load offered/changed/canceled, message received, duty auto-close, performance week settled, training due. Driver-scoped RESTRICTIVE RLS with raw-PostgREST deny cases | The audit found **zero** driver notification infrastructure — the only `notifications.ts` emails office recipients about anomalies. Without push, dispatch releasing a load is invisible until the driver happens to open the app, which defeats the whole approval flow built in 3B/3D |
| **D54** | **Messages are a first-class module** (Phase 5M): `message_threads` + `thread_participants` + `messages` + read state, office↔driver, optionally bound to a load (`threads.load_id`) so a conversation carries its context. Outbound rides the **existing Phase-2 outbox** with client-UUID PKs, so a message written in a dead zone is never lost; inbound uses **Supabase Realtime** with a cache-backed fallback poll. Dispatch gets an inbox in the web Dispatch section. Retention + export are admin settings; bodies are covered by the audit trail and never hard-deleted by a driver | The audit found no table, no plan section, no mention anywhere in the repo. This is the first surface in the stack needing **inbound** realtime — D4's offline model is write-only today — so it is authored as its own module rather than bolted onto an existing phase. Store note: Apple treats in-app user-generated content as needing report/block affordances even for internal-only apps |
| **D55** | **Module entitlements — `org_modules` (module key → enabled, per org).** Keys: `hazmatguard`, `training`, `messages`, `notifications`, `dispatch`, `navigation`. Delivered in the bootstrap payload; enforced in **three** places — RLS predicates on the module's own tables, an API guard, and the UI (a disabled module's surfaces do not render). Absent key = disabled | The plan repeatedly says "entitlement-gated (`hazmatguard`)" but the audit found **no entitlement, plan or subscription model anywhere** — zero matches across migrations, API, web and shared. HazmatGuard and Training are separately-sellable products, so the gate must exist before either ships, and gating only in the UI would not survive a driver JWT hitting PostgREST |
| **D56** | **Modular without exceptions — enforced, not aspirational.** Every feature is a module: its own `features/<name>/` folder in the app and in the web, its own migration, its own contract file in `packages/shared`, its own RLS policies with allow **and** deny cases, and its own entitlement key where sellable. **No feature imports another feature's internals** — cross-feature use goes through `@fuelguard/shared` or an explicit public `index.ts`. A boundary linter (`check-feature-boundaries.mjs`, already the web's model) runs in CI for `apps/driver` too, and a module is not "done" until it can be disabled by its entitlement key without breaking any other surface | User direction (2026-07): "everything we have is modular without exceptions." §4.4 described the structure but nothing enforced it in the driver app, and the boundary rule was a sentence rather than a gate |
| **D57** | **Driver write rate limits + business caps (replaces the retired D32).** Keyed on the JWT **`sub`, never IP** — drivers share carrier NAT, so an IP limit throttles a whole yard. Per driver: `POST /me/shift/*` **10/min, 60/day** (a real driver checks in once and swaps a handful of times); `POST /me/loads/:id/{accept,decline,start}` **20/min, 200/day**; `POST /me/loads/:id/stops/:stopId` **30/min, 500/day** (a multi-stop run with retakes is legitimately chatty); `POST /me/messages` **20/min, 300/day**. Business caps are server-counted and separate from the rate limit, with **distinct error codes** so the app can say "slow down" vs "that's the daily maximum"; both return `429 + Retry-After`. **The current `meLimiter` is IP-keyed express-rate-limit at 120/15min across all of `/api/me`** — it must become per-`sub` before 3C ships, or one depot behind one NAT will lock itself out | D32 locked limits for an endpoint that was then deleted, leaving every endpoint actually built with only a blunt shared IP limit. The numbers are sized at ~10× realistic driver behaviour: generous enough that no honest driver meets them, tight enough to stop a runaway retry loop or a stolen token draining the API |
| **D58** | **In-motion safety, re-scoped (replaces the retired D35).** Manual fuel entry is gone; these remain manual entry in a moving truck and are gated on GPS speed (`expo-location`, **> 5 mph / 2.2 m/s**, 3–5s hysteresis, permission denied or unavailable → **default LOCKED**): **stop-photo capture**, the **hazmat step**, **message composition**, and the **odometer field** at check-in. **Explicitly NOT gated** — one-tap, glanceable actions a driver may legitimately take at a light or with a passenger: viewing a load, **accepting/acknowledging** a load, reading a message or notification, and starting a shift *without* the optional odometer. In-motion surfaces stay read-only and glanceable (NHTSA ≤2s glance). Blocked entry shows the "pull over to finish this" interstitial with an **"I've parked" attestation tap**, never a dead-end (D21) | The safety rationale never applied to fuel specifically — it applies to *typing and framing photos while driving*. Retiring D35 wholesale would have silently dropped a genuine safety control, and a blanket lock would stop a driver acknowledging a load at a red light, which is exactly the behaviour dispatch needs |
| — | v1 build order set by **D41**, **re-cut inside Phase 3 by D43–D49** (3A duty → 3B lifecycle → 3C app ∥ 3D dispatch → 3E ingest, §14.11), **navigation removed by D52**, **notifications + messages added by D53/D54** | Prove identity + the loads spine before feature breadth; 3A/3B are backend-only and unblock the two UIs in parallel; communication lands once there is something worth being told about |
| — | Delivery = **one living plan doc**, built one phase per session, each phase demoable | Matches team conventions; resumable across chats |

### §9.1 Cleanup pass — 2026-07-27 (what was imprecise, and what it is now)

Every row below was either **contradicted by the built code**, **left an implementer a choice**, or
**conflicted with another locked decision**. All are resolved above; this table exists so the
resolutions are auditable rather than buried in a 58-row register.

| Was | Problem | Now |
|---|---|---|
| **D30** vs **D43** | Both read LOCKED and said opposite things — D30: "driver↔vehicle scope **is** `vehicles.assigned_driver_id`"; D43: equipment truth is a duty segment. An implementer had no way to tell which governed | D30 tagged **⛔ SUPERSEDED by D43**. `assigned_driver_id` is the domicile default (the pinned "Your truck"); the duty segment is the truth |
| **D14** vs **D31** | D14 said driver `jwt_expiry` "~15–30 min", D31 said `3600s`. A numeric contradiction in the security spec | D14's number removed; **D31's 3600s is the single value**. D14 gains the two offboarding steps it was missing (revoke push tokens, close the open duty session) |
| **D36** (IBM Plex) | The app has shipped **Hanken Grotesk** since Phase 0; the ledger noted "deferred: IBM Plex" and left the decision reading as locked-but-unbuilt for months | **✏️ Amended to Hanken Grotesk.** The *requirement* — tabular figures for numeric readouts — survives as **T10**, with IBM Plex Mono for numerals only if it fails |
| **D18 / D23** (lucide, style-dictionary) | Both named `lucide-react-native`; **D40** replaced it with Material Symbols and neither row was updated. `style-dictionary` was never adopted — tokens are hand-authored | Both amended to Material Symbols; the style-dictionary pipeline is explicitly **dropped** in favour of hand-authored tokens + `lint:tokens`; the bottom-sheet "or Expo UI" alternative is closed |
| **D32** (fuel rate limits) | Locked limits for `POST /api/me/fillups`, an endpoint D41 deleted — so **every endpoint that actually exists had no rate-limit decision**, only a blunt IP-keyed 120/15min across all of `/api/me` | **🚫 Retired → D57** re-locks per-`sub` limits and business caps against the built endpoints. **T11** tracks moving off IP keying |
| **D35** (in-motion lockout) | Retired by D41 as "fuel-specific", which silently dropped a real safety control — photo capture and message composition are still typing in a moving truck | **🚫 Retired → D58** re-scopes it: capture/hazmat/messages/odometer gated; viewing and one-tap acknowledgement explicitly **not** gated |
| **D15** ("and/or") | "Enforce the invite token **and/or** require email confirmation" — two different products | Token enforcement only; confirmations may stay off. **Built** |
| **D16** ("lockout after N fails") | `N` was never given, so an implementer would invent one | **10 consecutive failures per email / 15 min, released after 30 min**, keyed on email + `sub`, never IP alone |
| **D5 / D13 / D12 / D19 / D21 / D24** | Written in fuel vocabulary that D41 removed; D13's storage path did not match what `0085` actually built | D5 tagged retired; the rest amended to the surfaces that exist. D13 now states the real path `${org}/${driver}/${load}/${photo}.webp` |
| **D17** (tab bar) | Still described the pre-D51 bar including a live center Navigate tab | **⛔ Superseded by D51** |
| **D37** (MapTiler) | Locked a vendor for a phase that D52 moved out of scope, with **T8** telling someone to go buy tiles | **⏸️ Deferred with D52**; T8 put on hold |
| **D9** (RLS coverage) | Enumerated seven tables from Phase 1 and was never extended, so new modules had no checklist | Enumeration refreshed per migration, with the rule that a module adds its tables here in the same migration that creates them (D56) |
| **D33** (push transport) | Correct and still live — but the Notifications *module* (D53) was authored as if no push decision existed | D33 relabelled as the transport layer **under** D53. *(Correction to the previous audit: the transport decision did exist; what was missing was tables, delivery, preferences, the in-app centre and any phase to build them.)* |

**One decision deliberately left open, and named as such:** Phase 5's read path — a thin
`GET /api/me/performance` versus a direct PostgREST read under the existing `dpw_driver_scope` policy.
Both are correct and the choice depends on the launch waterfall count measured at build time. It is
recorded in §15A as a build-time measurement, not a judgement call, and blocks nothing.


**Version pins (verified 2026 — supersede any earlier "SDK 54/RN 0.76"):** Expo **SDK 57** (RN 0.86,
React 19.2; New Architecture mandatory) · Node 22 · TypeScript 6.0.3 (spike-verify vs NativeWind
typings) · **NativeWind 4.x** + tailwindcss **3.4.17** · @supabase/supabase-js 2.x (AsyncStorage
adapter) · @tanstack/react-query **5.x** + persist-client + async-storage-persister · netinfo · **zod
4.4.3** (with a Metro package-exports workaround; zod 3.x is the documented fallback) ·
expo-image-manipulator **≥12.0.1** (WebP both platforms) · @maplibre/maplibre-react-native 11.x ·
expo-sqlite (SDK-bundled). Full rationale in §20.3.

---

## §10. Operational pre-build checklist (tasks, not decisions)

**Every design/architecture/security/UX/compliance choice is now a LOCKED decision (D1–D58).** What
remains here are purely *operational tasks* — things to configure, seed, host, or verify. None require
research or a judgment call at build time. (The former "open items" O1–O20 were all resolved into
decisions in Round 5 — see §24 for the mapping.)

| # | Task | When | What to do |
|---|------|------|-----------|
| T1 | **Confirm the Custom Access Token hook is enabled** in the target Supabase project (commented out in `config.toml:284-286`) — **Blocker B1** | Before build | Enable in Dashboard → Auth → Hooks (or uncomment + point the URI at `public/custom_access_token_hook`); without it no `org_id`/`user_role` claims are issued |
| T2 | **Phase-0 build spike** — prove B2 (shared `.d.ts` build), B3 (pnpm `node-linker=hoisted` + Metro), B6 (zod v4 on a physical Hermes device); confirm `expo-image-manipulator ≥12.0.1` WebP on device | Phase 0 | Fallbacks are pre-documented (zod 3.x; JPEG path) — the spike is verification, not a decision |
| T3 | **Apply the Supabase auth-hardening config** (D16, D31): HIBP leaked-password on, `min length ≥10`, captcha on, `jwt_expiry=3600`, rotation+reuse-detection on, inactivity 7d / time-box 30d; confirm admin MFA on | Before submission | All values are locked; this is a Dashboard/`config.toml` change |
| T4 | **Ship in-app Account Deletion** (CG1/D26) + **host the web pages** (O19→task): `…/privacy` and `…/delete-account` | Before submission | Content is spec'd; enter both URLs in store metadata / Google Data-safety |
| T5 | **Seed a reviewer demo driver account** (CG2/D26) — org + assigned vehicle + sample fills, live backend | Before submission | Put creds in App Store Connect App Review Info + Play App access (invite-only apps auto-reject without it) |
| T6 | **Set up private distribution** (D25): Apple Business Manager Custom App (Org ID); Managed Google Play private app (Org ID) | Before submission | Unlisted is the Apple fallback if ABM enrolment isn't possible |
| T7 | **Verify every native dependency is New-Architecture-ready** on SDK 57 | Phase 0 | Audit the pinned set (MapLibre 11, expo-sqlite, image-manipulator, reanimated 4, gorhom sheet, etc.) |
| T8 | **⏸️ ON HOLD — MapTiler procurement moves to the navigation programme (D37/D52). Do not buy tiles yet.** The font half is **done**: Hanken Grotesk ships via `@expo-google-fonts/hanken-grotesk` (D36 amended) | Navigation programme | Nothing to do now; re-opened when navigation is planned |
| T10 | **Verify tabular figures on device** for Hanken Grotesk — render the odometer, gallons, MPG and score readouts and confirm digits do not shift width between frames (D36) | Before 3C ships a numeric surface | If it fails, bundle **IBM Plex Mono for numerals only**; do not reopen the UI typeface |
| T11 | **Move `/api/me` rate limiting from IP-keyed to per-JWT-`sub`** with the D57 buckets and business caps | Before 3C ships | Today one `meLimiter` covers all of `/api/me` at 120/15min keyed by IP — a depot behind one NAT would lock itself out |
| T9 | **Add `fuelguard://accept-invite` to the Supabase Redirect URLs allow-list** (prod Dashboard → Auth → URL Configuration; local `config.toml` already updated) | Before the first real driver invite | Without it, GoTrue falls back to `site_url` and the invite link opens the web instead of the app |

---

# PHASES

Dependency-ordered. Each phase ends in something runnable and demoable. `☐` = not started.

---

## §11. Phase 0 — Foundation & Design System

> Stand up `apps/driver` (Expo/RN) in the monorepo, port the design system to NativeWind tokens with
> CI enforcement, wire `@fuelguard/shared`, ship a themed component gallery on a real device.
> Depends on: nothing · Blocks: Phase 1

### 11.1 Goal & demoable outcome

A developer runs an Expo **dev build** on iOS and Android and sees a **component gallery** rendering
the ported design system (buttons, inputs, cards, badges, stat tiles) in **light and dark**, all
colors from tokens, `@fuelguard/shared` imported successfully, and `pnpm typecheck && lint && test`
(incl. token-lint) green. No auth, no data — a correct, themed, monorepo-wired shell that de-risks the
shared-package/Metro wiring and the token discipline.

### 11.2 App scaffold & placement

Create `apps/driver` as an Expo app using **expo-router** (file-based; matches "routes contain no logic").

- Expo **SDK 57** (RN 0.86, React 19.2; New Architecture mandatory — audit native deps for New-Arch support). See §20.3 for the full pin sheet.
- Package `@fuelguard/driver`, `private`, Node 22 (`.nvmrc`). **Do NOT set `"type":"module"`** (Expo's babel/metro configs are CJS — §20 B4), unlike the other workspace packages.
- Root **`.npmrc` `node-linker=hoisted`** (§20 B3); Metro configured for the workspace (§11.4).
- **Dev build (`expo-dev-client`) from day one** — not Expo Go — because later phases add native
  modules (camera, secure store, maps/nav). Establish `eas build --profile development` now.
- Directory shape:

```
apps/driver/
├── app/                    expo-router screens (gallery in Phase 0)
├── src/{theme,components,lib,features}/
├── app.config.ts           Expo config (scheme: "fuelguard", dev-client)
├── metro.config.js         monorepo + shared-package transpile (§11.4)
├── tailwind.config.js      token config (§11.3)
├── babel.config.js         nativewind/babel
├── tsconfig.json           extends ../../tsconfig.base.json
├── eslint.config.js        extends root + RN + token rules
└── package.json
```

### 11.3 Design tokens (the port, by value)

Keep FuelGuard's semantic names — screens never see `indigo`/`red`. Precompute OKLCH → hex once (the
ramps are Tailwind v4 defaults, so hex equivalents are exact); the OKLCH source of truth stays
`packages/ui/src/tokens.css`.

**Primitive ramps (representative anchors; full tables transcribed into `src/theme/ramps.ts`):**

| Step | brand (indigo) | neutral (gray) |
|---|---|---|
| 50 | `#eef2ff` | `#f9fafb` |
| 100 | `#e0e7ff` | `#f3f4f6` |
| 200 | `#c6d2ff` | `#e5e7eb` |
| 300 | `#a3b3ff` | `#d1d5db` |
| 400 | `#7c86ff` | `#9ca3af` |
| 500 | `#6366f1` | `#6b7280` |
| 600 | `#4f46e5` | `#4b5563` |
| 700 | `#4338ca` | `#374151` |
| 800 | `#3730a3` | `#1f2937` |
| 900 | — | `#111827` |

Status ramps (`danger`=red, `caution`=orange, `warning`=amber, `success`=green, `info`=blue) mirror
Tailwind v4 defaults; severity mapping: critical→danger, high→caution, medium→warning, low→neutral
(matches `apps/web/src/lib/badges.ts`).

**Semantic roles (light + dark) — screens/components use only these:**

| Role | Light | Dark (initial) | Use |
|---|---|---|---|
| `canvas` | neutral-50 | neutral-900 | screen background |
| `surface` | white | neutral-800 | cards, inputs, sheets |
| `surface-subtle` | neutral-50 | neutral-800/80 | headers, hover rows |
| `surface-muted` | neutral-100 | neutral-700 | soft buttons, wells |
| `ink` | neutral-900 | neutral-50 | headings, primary values |
| `ink-secondary` | neutral-700 | neutral-200 | body, labels |
| `ink-muted` | neutral-500 | neutral-400 | captions |
| `ink-subtle` | neutral-400 | neutral-500 | placeholders, disabled |
| `ink-inverse` | white | neutral-900 | text on brand/danger fills |
| `edge-subtle` | neutral-100 | neutral-700 | dividers |
| `edge` | neutral-200 | neutral-700 | card rings |
| `edge-strong` | neutral-300 | neutral-600 | control borders |

Dark mode via NativeWind `dark:` + `useColorScheme` + a manual override toggle (drivers may force
night mode). Both themes point at the same ramps; only role values change — identical to web.

**Scales:** radius `md 6` (controls) / `lg 8` (cards) / `xl 12` / `full`; spacing Tailwind 4px base,
card padding `p-5`/`p-4`, **primary touch targets ≥48pt** (gloves/one-hand — above web density);
typography system font, `xs 12 / sm 14 / base 16`, weights 500/600/700, Dynamic-Type safe, big
numerals for glanceable data; elevation `shadow-sm` cards / `shadow-lg` sheets.

### 11.4 Wiring `@fuelguard/shared` into Metro (the known gotcha)

`@fuelguard/shared` exports raw `.ts` from `src/index.ts` with no build step. Metro must watch +
transpile it:

- `metro.config.js`: `watchFolders` → repo root; enable monorepo node-modules resolution; ensure the
  transformer compiles TS from the workspace package; validate the `.js`-suffixed ESM specifiers +
  `moduleResolution: bundler` resolve by importing a pure function.
- **Acceptance:** `import { USER_ROLES, fillUpInputSchema, derivePricePerGal } from '@fuelguard/shared'`
  compiles and runs; a test calls `derivePricePerGal` + `computeFillUpWarnings` and matches web output.
- **Resolution locked (D7 / §20 B2):** Metro will **not** resolve the 134 `.js`-suffixed→`.ts`
  specifiers in shared the way Vite/tsc do, so `@fuelguard/shared` **gets a real build step** (tsc emit
  to `dist/` + an `exports` map with `react-native`/`default` conditions). Web/api keep consuming
  source. Prove this in the Phase-0 spike alongside the pnpm/Metro (B3) and zod/Hermes (B6) checks.

### 11.5 Token enforcement (the no-hardcoded-colors guarantee)

`scripts/check-driver-tokens.mjs` (sibling to `apps/web/scripts/check-design-tokens.mjs`) walks
`apps/driver/src` and **fails** on: hex literals outside `src/theme/`; raw palette utilities
(`bg-|text-|border-|ring-…-(red|indigo|gray|…)-\d+`); inline color styles (`style={{ …color… }}`).
Wire as `pnpm --filter @fuelguard/driver lint:tokens` + CI. Single-line escape hatch
`token-check-disable-line`. Parity test asserts `ramps.ts` brand/neutral anchors equal the web OKLCH anchors.

### 11.6 Base component set (the gallery)

Token-only, accessibility-annotated (`accessibilityRole`, ≥48pt targets, focus/press states):

| Component | Variants / props | Web parity |
|---|---|---|
| `Button` | primary/secondary/danger/soft/ghost; sizes sm/md; `block`; loading; disabled | `AppButton.vue` |
| `Input` | text/decimal/number keyboards; invalid; 16pt (no zoom) | `AppInput.vue` |
| `Field` | label + required + error + hint | `FormField` |
| `Card` | padding md/sm/none; `ring-edge` | `AppCard.vue` |
| `Badge` | tones danger/caution/warning/success/info/brand/neutral; `severityTone` | `badges.ts` |
| `StatTile` | big numeral + label + optional trend | dashboard stat cards |
| `Screen` | safe-area + canvas bg + scroll wrapper | `AppShell` |

This is the **primitive** subset. §22.3 defines the **full two-tier component set** (primitives +
compositions: TabBar, Sheet, Toast, ListRow, Skeleton, Banner, NumericField, SegmentedControl, Picker,
EmptyState, ScoreGauge, ReceiptViewer, OfflineBanner/SyncStatus/PendingBadge, VehicleCard, FillRow) that
Phase 0 builds and renders in the gallery. The gallery route renders **every** component in both themes,
at large Dynamic Type, and with reduce-motion — or it won't get token-audited. The **navigation shell**
(D17: tab bar + elevated center capture) is also stood up in Phase 0 so screens have a home from day one.

### 11.7 File & work breakdown

Scaffold/toolchain (`package.json`, `app.config.ts`, `babel.config.js`, `metro.config.js`,
`tsconfig.json`, `eslint.config.js`); tokens (`src/theme/ramps.ts`, `roles.ts`, `tailwind.config.js`,
`ThemeProvider.tsx` + `useTheme`); components (`src/components/*`); shell + gallery (`app/_layout.tsx`,
`app/index.tsx`); linter (`scripts/check-driver-tokens.mjs`); tests (`src/theme/__tests__/parity.test.ts`
+ a shared-import smoke test); CI (add driver app to lint/typecheck/test).

### 11.8 Exit criteria

- ☐ **Build spike passed (first task):** shared build-step (B2), pnpm `node-linker=hoisted` + Metro (B3), and a zod schema from `@fuelguard/shared` running on a **physical Hermes device** (B6) all verified; `"type":"module"` omitted (B4).
- ☐ `apps/driver` runs on iOS **and** Android dev build; gallery renders in light + dark.
- ☐ `@fuelguard/shared` imports and executes in-app (smoke test passes).
- ☐ Every color traces to a token; `lint:tokens` green; ramp-parity test green.
- ☐ `pnpm -r typecheck && lint && test` include and pass the driver app.
- ☐ Base components accessible (≥48pt, labels/roles) and Dynamic-Type safe.
- ☐ CI runs the driver app's checks.
- ☐ Doc updated: Metro-vs-build decision, final token tables location, verification tally.

### 11.9 Risks & mitigations

Metro + workspace-TS friction → validate first; documented build-step fallback. OKLCH on older devices
→ precomputed hex sidesteps it. Token drift web↔mobile → parity test on anchors. Expo Go dead-end →
dev-build workflow adopted now.

---

## §12. Phase 1 — Identity, Auth & Access Control

> Make drivers first-class login users who can use the driver app and **nothing else**.
> Depends on: Phase 0 · Blocks: Phases 2–4

### 12.1 Goal & demoable outcome

An admin invites a driver by **personal email** (`role:driver`) from the web dashboard. The driver
opens the link **in the driver app**, sets a password, signs in, resolves to their own `drivers` row,
and sees only their data. The same driver signing into the **web** dashboard is redirected out. The
offline RLS matrix proves a driver reads only their own scope. All backend changes additive.

### 12.2 Precondition

**O3:** confirm the Custom Access Token hook is **enabled** in the target Supabase project (commented
out in `supabase/config.toml`). Verify in Dashboard → Authentication → Hooks before starting. Record here.

### 12.3 Identity model

Join the two existing concepts: **`memberships`** `(org_id, user_id, role)` — the login identity the
JWT hook reads (accepting a driver invite already creates this with `role='driver'`) — and
**`drivers`** `(id, org_id, user_id **nullable**, …)` — the roster record fuel attributes to, whose
`user_id` is never populated today and has no unique constraint. Target: on accept, set
`drivers.user_id = auth.uid()` (unique per org), so `auth.uid()` resolves to exactly one driver row.

**Decision D3 (LOCKED):** the admin selects an existing `drivers` record (or creates one) at invite
time; the invite carries a `driver_id`; on accept we set that driver's `user_id`. (Matching by
email/phone rejected as error-prone.)

### 12.4 Backend changes (additive; migrations from 0083)

- **`0083_driver_identity.sql`** — add `invites.driver_id uuid null references drivers(id)`; add a
  **partial unique index** on `drivers(org_id, user_id) where user_id is not null`; **alter
  `drivers.user_id` to `on delete set null`** (today it has no on-delete action, which would block
  `auth.admin.deleteUser` once linked — §21 SB3). No destructive change.
- **Invite creation (API, `apps/api/src/routes/invites.ts`)** — extend `inviteCreateSchema`
  (`packages/shared/src/apiContract.ts`) with optional `driver_id` (required when `role='driver'`);
  **skip `isEmailDomainAllowed` when `role='driver'`** (D1) — **in BOTH the create handler
  (`:105-109`) AND the accept handler (`:257-261`)** (§20 F: accept re-checks the domain too);
  validate `driver_id` references an existing, unlinked driver in the caller's org.
- **Invite accept (API, `POST /api/invites/accept`)** — after the membership upsert, if the invite has
  `driver_id`, set `drivers.user_id = auth.sub` (service-role, org-checked); audit `invite.accepted`;
  idempotent (unique index guards double-link).
- **`0084_driver_scoped_rls.sql`** — add a helper and policies:

```sql
create or replace function auth_driver_id() returns uuid language sql stable as $$
  select d.id from drivers d
  where d.org_id = auth_org_id() and d.user_id = auth.uid()
  limit 1
$$;
```

  Because existing `*_select` policies are PERMISSIVE (they'd only broaden), driver scoping uses
  **RESTRICTIVE** policies of the form `USING (auth_role() <> 'driver' OR <owned>)` — tightening drivers
  without touching manager access (D9 / §20 F1):

  | Table | RESTRICTIVE driver policy (`<owned>`) |
  |---|---|
  | `fuel_transactions` | SELECT `driver_id = auth_driver_id()`; **INSERT (restrictive) `driver_id = auth_driver_id()` AND `vehicle_id ∈ assigned` AND `source='manual'` AND `entered_by = auth.uid()`** (closes attribution forgery via raw PostgREST — §21 SB1) |
  | `vehicles` | `assigned_driver_id = auth_driver_id()` |
  | `drivers` | `id = auth_driver_id()` |
  | `anomalies`, `memberships`, `anomaly_thresholds` | driver may not read others' — restrictive scope or deny for `driver` role |
  | `driver_performance_weeks` | `driver_id = auth_driver_id()` (built here; Phase 5 only adds the read path) |

  Also add an **audit trigger on `fuel_transactions`** (mirroring `audit_row_change`) so driver inserts
  are attributably logged (§21). **Register the migration in `rls.test.mjs`'s array** (it loads a
  curated subset — §20 F-matrix) and add allow **and deny** cases — including a **raw-PostgREST deny
  test** (D10), not just the app path: a driver inserting another `driver_id`, an unassigned
  `vehicle_id`, or a spoofed `source` must fail at RLS; a driver reading another driver's rows must fail.

- **Offboarding — `revokeDriverAccess(userId)` (D14):** one atomic server action that deactivates/deletes
  the `memberships` row, calls `supabase.auth.admin.signOut(userId,'global')` (revoke refresh tokens),
  and sets `drivers.status='inactive'`. Tie `drivers.status` to this so the roster control actually cuts
  access. Lower driver `jwt_expiry` (~15–30 min) so the residual valid-token window is short.
- **Prove email ownership (D15):** relaxing the domain check must not open invite-takeover. In
  `POST /invites/accept`, **enforce the invite `token`** (currently generated but unused — bind
  acceptance to that server-verified secret). Per **D15** the token is the proof — `email_confirmed` is **not** additionally required. Keep invites admin-only
  and referencing a pre-created `driver_id` as compensating controls.
- **Web dashboard gate (`apps/web/src/router/index.ts`)** — if `user_role === 'driver'`, redirect to a
  "Use the FuelGuard Driver app" screen (or `signOut`). UI defense-in-depth; RLS is the real enforcement.
- **`GET /api/me/driver`** — returns the caller's driver row + assigned vehicle(s) (server resolves via
  `auth_driver_id()`); `requireAuth` + `requireRole('driver')`; Zod shape in `packages/shared`.

### 12.5 App changes (Expo)

- **Supabase client (`src/lib/supabase.ts`)** — `storage: AsyncStorage` adapter (**not** raw
  expo-secure-store — see D6/§20 F2: the ~2KB Android limit truncates real sessions), `lock:
  processLock`, `autoRefreshToken`, `persistSession`, `detectSessionInUrl: false`; `AppState`-driven
  `startAutoRefresh/stopAutoRefresh`; env via `app.config.ts` `extra` (public values only; never the
  service-role key). If encryption-at-rest is required, wrap with the **`LargeSecureStore`** pattern
  (AES-256 key in SecureStore, ciphertext in AsyncStorage).
- **Auth + session (`src/features/auth/`)** — sign-in screen (email+password, large targets,
  show-password, `secureTextEntry` + autofill/keyboard-cache disabled, clear errors); session store
  (Context/Zustand) subscribed to `onAuthStateChange`, deriving `userId/email/orgId/role/hasOrg` from
  decoded (not verified) JWT claims (`decodeClaims` ported as a base64 helper — no `atob` in RN);
  "account pending" when `hasOrg === false`; **accept-invite/set-password via PKCE + verified App/
  Universal Links (D11)** — the email link delivers a one-time `?code=`, exchanged with the
  locally-held verifier (`exchangeCodeForSession`) → `updateUser({password})` →
  `POST /api/invites/accept` → `refreshSession()`; never log the link/token; a "wrong app" screen if a
  non-driver signs in; `apiFetch` (`src/lib/api.ts`) Bearer from `getSession()`. **Secure logout:**
  `signOut({ scope:'global' })`, then wipe the encrypted store, delete the SecureStore key, and (on
  deprovision) purge the offline outbox + staged receipts.
- **Accept-invite entry path (BUILT — records the D11 deep-link choice):** the driver invite's
  emailed link is Supabase's **https action_link** (survives every email client); its final
  redirect hop targets **`fuelguard://accept-invite?token=<invite>`** with session tokens in the
  fragment. The app screen (`app/(auth)/accept-invite.tsx` + `src/features/auth/acceptInvite.ts`)
  establishes the session (`setSession` / `exchangeCodeForSession` / `verifyOtp` for pasted
  action links), takes a password (≥10, D16), posts `/api/invites/accept` with the invite token
  (D15), then refreshes claims; the root guard whitelists the route mid-flow. Fallbacks: a
  **paste-the-link rescue** on-screen, and the **web accept page** (now forwards the driver token)
  followed by normal app sign-in. Verified **App Links / Universal Links** upgrade remains a
  Phase-4-era ops task; the scheme redirect is the v1 mechanism.
- **CORS** — add any web-hosted auth-callback origin to `ALLOWED_ORIGINS` on `apps/api`.

### 12.6 File & work breakdown

Migrations `0083_driver_identity.sql`, `0084_driver_scoped_rls.sql` + matrix cases; API invites
(domain relax + `driver_id` + link on accept), contract schema, `GET /api/me/driver`
(`apps/api/src/routes/me.ts` or `meDriver.ts`); web gate (`router/index.ts` + page); app client/session
(`src/lib/{supabase,api,jwt}.ts`, `src/features/auth/*`) and screens (sign-in, set-password/accept,
account-pending, wrong-app).

### 12.7 Exit criteria

- ☐ Admin invites a driver by personal email (non-company domain) — succeeds.
- ☐ Driver sets password + signs in **in the app**; session in secure storage; token auto-refreshes on foreground.
- ☐ On accept, `drivers.user_id` set; `auth_driver_id()` resolves correctly.
- ☐ A driver JWT reads **only** their own fills/vehicle/driver row (matrix asserts allow + deny); managers unaffected.
- ☐ **Security (§21):** a driver **cannot** insert a forged `driver_id`/`vehicle_id`/`source` even via **raw PostgREST** (RESTRICTIVE-insert deny test); the invite-takeover path is closed (token-enforced accept, SB6); tokens stored via `LargeSecureStore`; deep link uses PKCE + verified links; `revokeDriverAccess()` cuts a driver's access (session revoked, `drivers.status` inactive) and `deleteUser` succeeds (FK on-delete).
- ☐ A `driver` signing into the **web** app is redirected out.
- ☐ `GET /api/me/driver` returns driver + assigned vehicle(s).
- ☐ `pnpm typecheck && lint && build && test` green; new migrations in the RLS matrix (X/X); token-lint green.
- ☐ Doc updated: O3 hook confirmation, deep-link decision, verification tally.

### 12.8 Risks & mitigations

Hook not enabled (O3) → verify before building (hard blocker). Personal-email invites weaken the domain
guard → relaxation scoped strictly to `role='driver'` **and** requires a valid `driver_id`; admins
initiate every invite; audit create/accept. Reads leaking beyond scope → RLS enforcement with explicit
deny-cases. Two apps, one Supabase project → web gate + RLS keep drivers out of manager surfaces.

---

## §13. Phase 2 — Offline-first Data Layer & Home

> A trustworthy data spine with no signal: persisted read cache, durable write **outbox** (the queue
> Phase 3 rides on), sync engine, connectivity UX, glanceable Home.
> Depends on: Phase 1 · Blocks: Phase 3

### 13.1 Goal & demoable outcome

Airplane mode: the app loads the driver, assigned vehicle(s), and recent fills **from cache** — no
error. A visible offline banner + pending-sync count communicate state. Reconnect: queued work drains
automatically and the banner clears. No new domain data is written yet (Phase 3), but the outbox/sync/
cache is exercised by a seeded test mutation to prove the machinery.

### 13.2 Read cache

- One `QueryClient`: `networkMode: 'offlineFirst'`, generous `staleTime`/`gcTime`, backoff retry;
  persist to disk and **restore on launch**; `onlineManager`→NetInfo, `focusManager`→`AppState`.
- **Persister choice (RESOLVED — exit criterion):** `@tanstack/query-async-storage-persister` over
  AsyncStorage, wrapped in `PersistQueryClientProvider` (restore completes before first paint),
  `maxAge` 7 days + a `buster` string. **Not** encrypted, deliberately: the read cache only holds
  what the driver may already see and is re-fetchable, whereas the **outbox** holds work that exists
  nowhere else — that one gets SQLCipher (D12). Keeping the persister simple also keeps cold-start
  restore fast, which is the requirement that actually matters here.
- Bootstrap = `GET /api/me/driver` cached under `['me','driver']`; supplementary reads go direct to
  Supabase under the Phase-1 driver policies:

  | Query key | Source | Notes |
  |---|---|---|
  | `['me','driver']` | `GET /api/me/driver` | driver + assigned vehicle(s) |
  | `['vehicles','assigned']` | Supabase `vehicles` (RLS) | picker + capacity/odometer/fuel-type for warnings |
  | `['fuel_transactions','mine', page]` | Supabase `fuel_transactions` (RLS) | recent fills for Home (fuel capture itself removed by D41) |

  Column allow-lists mirror the web hooks so `@fuelguard/shared` types apply unchanged.

### 13.3 The write outbox (core of this phase)

Persisted, ordered queue of pending mutations, in a **SQLCipher-encrypted** expo-sqlite DB (`useSQLCipher`,
key in expo-secure-store — D12/§21) so pending odometer/location/cost PII isn't plaintext on a lost/rooted
device. SQLite table `outbox`:

```
id TEXT PK  -- client UUID; for a fill-up this IS fuel_transactions.id
kind TEXT   -- 'fuel_fillup' (later 'hazmat_doc', 'training_event', …)
payload TEXT(JSON)  -- Zod-validated domain object
file_uris TEXT(JSON) -- local expo-file-system paths for attached media
status TEXT -- 'pending'|'in_flight'|'failed'|'done'
attempts INTEGER · next_attempt_at INTEGER · created_at INTEGER · last_error TEXT
```

**Idempotency:** each `id` is a client UUID (`expo-crypto` `randomUUID`, the RN port of
`apps/web/src/lib/uuid.ts`). Duplicate insert collides on PK and no-ops → retry safely without dedup
bookkeeping. The engine **never regenerates an id on retry** (asserted by test).

> **Build note (encryption is not automatic):** SQLCipher must be compiled in via the config plugin
> `["expo-sqlite", { "useSQLCipher": true }]` (added to `app.config.ts`) **and the dev client
> rebuilt**. Plain SQLite *silently ignores* `PRAGMA key`, which would leave the outbox in
> plaintext — so `db.ts` checks `PRAGMA cipher_version` after opening and warns loudly if the flag
> is missing rather than failing quietly in the field. **Verify this warning is absent on device.**

**Retry policy (pure + unit-tested — `src/data/policy.ts`):** exponential backoff from 2s, capped at
5 min, with **±25% jitter** (without it every phone in the fleet retries in lockstep when a tower
returns). 4xx = permanent → **dead-letter immediately** (a 422 never becomes a 200); network/timeout/
429/5xx = transient → retry to `MAX_ATTEMPTS` 8, then dead-letter. **A dead-lettered record is never
discarded** — it surfaces in "needs attention" with a manual retry.

**Sync engine (`src/data/sync.ts`):** triggers on connectivity regained, foreground, successful
enqueue, and a periodic tick while pending. Takes the oldest eligible record → `in_flight` → executes
by `kind` via a registered handler (upload files → DB/endpoint → side effects) → `done` + invalidate
queries + delete staged files; on failure → `failed` + exponential backoff, surfaced as a badge (never
data loss). Serial processing (or small pool) preserves order. **Optimistic reads:** enqueue
optimistically updates the cache (`onMutate`), rolled back only on permanent failure.

### 13.4 Connectivity & sync UX

Slim token-colored **offline banner** ("Offline — your entries are saved and will sync"); **pending
badge** (count of not-yet-`done` records) on Home and near the sync control; subtle **sync status**
(tap to force); non-alarming failure surfacing ("Couldn't sync yet — will retry") with manual retry;
permanent failures route to a small "Needs attention" list.

### 13.5 Home screen

Glanceable, thumb-zone, one primary action — reframed by **D41** around the driver's **current load**,
not fuel:

- **Header:** greeting + driver name (from `['me','driver']`), org, sync/offline indicators.
- **Current assignment card:** the active load (origin→destination, next stop + appointment window,
  status) with a primary **Continue / Navigate** action; if none is active, the next **Upcoming** load
  with an **Accept** affordance. (Phase 2 renders it from cached `['me','loads']`; Phase 3 wires the
  actions.)
- **Duty card (superseded by D43/D44):** Phase 2 shipped a static *"My truck — Assigned"* line from
  `vehicles.assigned_driver_id`. **Phase 3A replaces it** with the live duty card — *Start your day*
  (no session) · *On duty · Unit 214 · Trailer 5521 · since 06:12* with **Change** (active) · the same
  with a pending badge (checked in offline). The static line stands only until 3A lands. See §14.8.
- **Performance snapshot:** the driver's latest weekly score as a `StatTile` (Phase 5 fills it; a
  placeholder until then).
- **Sync state:** offline banner + a pending photo/action count.
- **States:** cached-first; skeletons only when nothing is cached; offline is normal, not an error.

Everything token-styled; no color literals (token-lint enforced).

### 13.6 File & work breakdown

`src/lib/{queryClient,persist,connectivity}.ts`; `src/data/{outbox,fileStaging,sync}.ts`;
`src/features/home/{useDriverContext,useAssignedVehicles,useMyRecentFills}.ts` + Home UI
(`app/(app)/index.tsx`, `src/features/home/*`); sync UX components
(`OfflineBanner`, `SyncStatus`, `PendingBadge`); tests (outbox CRUD + backoff, idempotent replay,
sync state machine, optimistic rollback).

### 13.7 Exit criteria

- ☐ Cold-start in airplane mode renders driver + assigned vehicle + recent fills from cache (no error).
- ☐ A seeded mutation enqueues offline, survives relaunch, syncs on reconnect.
- ☐ Replaying the same record twice creates no duplicate (idempotency test).
- ☐ Offline banner + pending badge + sync status reflect real NetInfo; force-sync works.
- ☐ Optimistic insert appears immediately, rolls back only on permanent failure.
- ☐ Home token-only (lint:tokens green), ≥48pt targets, Dynamic-Type safe, light + dark.
- ☐ `pnpm -r typecheck && lint && test` green; unit tests for outbox/sync/backoff.
- ☐ Doc updated: final persister choice + verification tally (offline→online on iOS + Android).

### 13.8 Risks & mitigations

Silent data loss → durable SQLite outbox written before UI confirmation; files staged and deleted only
after confirmed sync. Duplicate writes → client-UUID PK (tested). Cache/RLS mismatch → all reads via
Phase-1 policies. Backoff storms → serial + jittered backoff. Scope creep to a full sync DB → outbox +
read cache only; WatermelonDB deferred (D4).

---

## §14. Phase 3 — Assignments: equipment, loads & dispatch

> **What the daily job actually is.** A driver starts their day by confirming **what they are driving**
> — truck and trailer — then sees the loads **dispatch has approved and released to them**, accepts one,
> and works it stop-by-stop, capturing the required proof-of-work photos, all queued offline through
> the Phase-2 outbox. Two halves have to exist for that sentence to be true: an **equipment truth**
> (who is in which truck/trailer, right now) and a **load lifecycle with a dispatch approval gate**
> (nothing reaches a driver's phone that a human did not approve). Phase 3 builds both, plus the
> dispatch surface that operates them.
> Depends on: Phase 2 (outbox/photo staging) + Phase 1 (identity/RLS) · Blocks: Phase 5N/5M (a load is
> what most notifications and threads are about), Phase 6 (hazmat is a step inside the load flow), and
> the deferred navigation programme (D52 — a route launches from an accepted load)

### 14.1 Goal & demoable outcome

**Driver.** Opens the app. Home's first card is **Start your day** — pick the truck (their usual one
pinned first), pick the trailer or say "bobtail / not hooked yet", optionally enter the odometer,
confirm. The card becomes a live **On duty · Unit 214 · Trailer 5521 · since 06:12** row with a
**Change** action, because trucks and trailers change during a day and the app must follow, not fight,
that. They open **Loads** and see only loads dispatch approved and released to them, grouped
**Upcoming · Current · Previous**. They open one, review stops, appointment windows, equipment,
commodity and any hazmat flag, and **Accept** it (owner-operators may also **Decline** with a reason).
Working the load, each stop is a guided photo step; missing a required photo needs an explicit reason,
never a dead-end. Everything works offline and syncs on reconnect.

**Dispatch.** Opens **Dispatch → Loads** on the web dashboard. The default tab is **Needs approval**,
holding manually-created drafts and anything the McLeod feed ingested. Each row shows a **completeness
checklist** — driver, truck, stops, appointment windows, hazmat consistency — and **Approve stays
disabled until the required items are green**, so approval is a real control and not a rubber stamp.
Approve, then **Release to driver**; it appears on the phone. **Dispatch → Assignments** shows who is
on duty right now, in which truck and trailer, since when, on which load — and lets dispatch reassign
equipment or close a stuck session.

### 14.2 Discovery findings (2026-07-27) — what was actually there

> Two discovery passes ran. The first (§14.2a) disproved this section's original premise about loads.
> The second (§14.2b) disproved the plan's implicit assumptions about equipment and about who authorizes
> a load. Both are recorded so nobody re-derives them.

**14.2a — the load domain was greenfield.**

| What was assumed to model loads | What it actually is |
|---|---|
| `driver_vehicle_assignments` (`0051`) | Samsara-keyed telematics history (`vehicle_samsara_id`, `driver_samsara_id`, time ranges) for attributing **idle events**, with a `driver_source` column recording `direct \| inferred \| none` because the inference is unreliable. Excluded from driver-app scope by **D30**. |
| `tms_movements` (`0068`) + `shared/tms.ts` | Exists to answer one question for reefer alerting: *was this a temperature-controlled load?* Columns: `external_id, vehicle_id, trailer_id, started_at, ended_at, temperature_controlled, setpoint_f, commodity, raw`. **No driver, no stops, no addresses, no appointment windows, no status, no proof-of-work.** Read only by `tmsIngest.ts` + the reefer scoring path. |
| `apps/web/src/features/jobs/**` | Background **processing** jobs (import progress: queued/running/done/failed) — unrelated to dispatch. |

A repo-wide search for stops, appointments, pickup/dropoff, consignee, BOL, or proof-of-delivery
returned **nothing**. `0085_driver_loads.sql` therefore created the domain greenfield.

**14.2b — equipment was static, and nothing authorized a load.** Re-checked against the built Phase-3
code:

| Assumption in the plan | What the code actually does | Consequence |
|---|---|---|
| "The driver's truck is known" | `vehicles.assigned_driver_id` (`0003`) — a **static column** a fleet manager sets. `GET /api/me/driver` returns `vehicles[]` filtered by it; the app takes `vehicles[0]` as *the* truck (`primaryVehicle()`). | A driver who slip-seats, takes a shop loaner, or swaps mid-week is attributed to the wrong truck until an admin edits a row. There is **no shift, duty period, or check-in concept anywhere in the schema.** |
| "The driver's trailer is known" | `trailers.assigned_vehicle_id` (`0030`) ties a trailer to a **vehicle**, never to a driver or a point in time. Nothing in the driver app reads or writes it. | Drop-and-hook is unrepresentable. Reefer expectation (the entire point of `tms_movements.temperature_controlled`) has no first-party source. |
| "Loads are assigned by dispatch" | `loads.status` defaults to **`'offered'`**, and `loads_driver_scope` makes any row with a matching `driver_id` **immediately readable by that driver**. There is no `draft`, no `pending_approval`, no `approved_by`, no `released_at`, and no transition guard — the CHECK constraint permits any status to become any other. | **An unreviewed row is on a phone the instant it is inserted** — including anything a future McLeod ingest writes. Approval is not merely un-built; the model has nowhere to put it. |
| "Managers keep their existing assignment surfaces" (§14.5, previous draft) | `apps/web` has features for ai, anomalies, audit, dashboard, drivers, fleet, fuel, fueling, import, jobs, reports, settings. There is **no loads or dispatch surface at all**. The Dispatch nav section contains only Fuel Planning and Truck Stops. | The entire "admin creates a load" story is `supabase/_deploy/seed_driver_load.sql` — a hand-edited SQL file run in the Supabase SQL editor. Nobody can create, assign, approve or release a load through a UI. |

Four concrete defects in the built Phase-3 artifacts were found in the same pass and are fixed here:

| # | Defect | Fix |
|---|---|---|
| **F1** | **`in_transit` is unreachable.** `loadBucket()` treats only `in_transit` as *Current*; the exit criteria say accepting moves a load to Current; `accept` sets `accepted`, which buckets as *Upcoming*; and no endpoint or trigger ever sets `in_transit`. A load can never reach the Current tab. | §14.6 — `accepted → in_transit` is stamped by the first stop arrival/completion (or an explicit **Start trip**), and is in the transition map. |
| **F2** | **Contract drift on the outbox payload.** §14.4 (previous draft) specified `payload:{ assignment_id }`; `0085` has no such column — it is `load_id`. | Payload is `{ load_id, stop_id }` throughout; §14.7 restated. |
| **F3** | **Contract drift on the storage path.** §14.5 (previous draft) wrote `${orgId}/${driverId}/${assignmentId}/…`; `0085` and `stopPhotoPath()` use `${org}/${driver}/${load}/${photoId}.webp`. | The migration/helper form is canonical. |
| **F4** | **Missing driver RESTRICTIVE policies.** `0084` scopes drivers, vehicles, fuel_transactions, driver_performance_weeks, anomalies, memberships and thresholds — but **not** `trailers` (`0030`), `driver_time_off` (`0068`) or `tms_movements` (`0068`), all of which are `select using (org_id = auth_org_id())`. A driver JWT hitting PostgREST directly reads **every trailer in the fleet, every driver's home-time, and every movement**. | §14.4 adds the three missing RESTRICTIVE policies with allow + raw-PostgREST deny cases in the RLS matrix (D10). |

**Why this is the right moment.** `0085` is deployed but **no production loads exist** — the only writer
is the seed script. `loads.status` is a text column with a CHECK constraint, not a PG enum, so widening
it is an `ALTER … DROP/ADD CONSTRAINT`, not a data migration. Changing the model now costs two additive
migrations and a contract edit. Changing it after a released binary caches statuses on drivers' phones
costs a coordinated app + data migration. **This is the last cheap moment.**

### 14.3 The corrected model — three concepts, not one

The word "assignment" was doing three jobs at once. Separating them is the whole fix (**D50**):

| Concept | Answers | Owned by | Lifetime | Where it lives |
|---|---|---|---|---|
| **Equipment assignment** (domicile) | *Which truck is this driver's normally?* | Fleet manager | Months | `vehicles.assigned_driver_id` — **kept, demoted to a default/pin, no longer the truth source** |
| **Duty session** (check-in) | *What is this driver actually in, right now?* | Driver asserts, dispatch sees and can override | A shift | **new** `driver_duty_sessions` + `duty_equipment_segments` |
| **Load assignment** | *What work is this, who is it for, and is it authorized to be dispatched?* | Dispatch | A load | `loads.driver_id` + the lifecycle in §14.5 |

`driver_vehicle_assignments` (`0051`) keeps its job — Samsara-inferred history for idle attribution —
but is documented as **superseded as a truth source wherever a duty segment covers the same instant**.
That is a direct precision win for the detection engine: `driver_source` gains a `confirmed` value that
outranks `direct` and `inferred`, because a human in the cab said so. (Wiring the engine to prefer it is
tracked in §17.3, not built in Phase 3.)

### 14.4 Work package 3A — equipment & duty sessions (backend)

**Decision D43 (LOCKED) — equipment truth is a time-ranged duty session, not a column.**

New migration `0086_duty_sessions.sql`:

```
driver_duty_sessions
  id uuid pk · org_id · driver_id → drivers(id)
  started_at · ended_at (null = ACTIVE) · ended_reason (driver|taken_over|auto_timeout|dispatch)
  start_odometer numeric(10,1) · start_lat/lon · device_id
  source text default 'driver_app'   -- driver_app | dispatch | telematics
  unique (org_id, driver_id) where ended_at is null          -- one active session per driver

duty_equipment_segments
  id uuid pk                          -- CLIENT UUID from the outbox (idempotency, §13.3)
  org_id · session_id → driver_duty_sessions(id) on delete cascade
  driver_id                           -- denormalized: RLS + attribution joins read it directly
  vehicle_id → vehicles(id) · trailer_id → trailers(id)   -- trailer null = bobtail / not hooked
  seat text default 'driver' check in ('driver','co_driver')
  from_at · to_at (null = CURRENT) · confirmed_by (driver|dispatch) · note
  unique (session_id) where to_at is null                                   -- one current segment
  unique (org_id, vehicle_id) where to_at is null and seat = 'driver'       -- one driver per truck
  unique (org_id, trailer_id) where to_at is null                           -- one truck per trailer
```

**Why segments and not two columns on the session.** Drop-and-hook happens mid-shift. A fuel purchase
at 14:10 must attribute to whichever trailer was hooked *at 14:10*, not to whatever is hooked at
end-of-day. Segments make that an exact lookup —
`where from_at <= t and (to_at is null or to_at > t)` — which is precisely the query the detection
engine approximates from Samsara today. The three partial unique indexes *are* the enforcement of
"one truck, one driver": no application-level race window, no silent double-checkout. The `seat`
column keeps team driving representable without weakening the constraint.

**Authorization.** Same posture as loads (**D10**): org members read; `admin|fleet_manager|dispatcher`
write; drivers get a RESTRICTIVE read scope to **their own** sessions and segments and have **no write
policy at all** — every driver write goes through the driver-scoped API, which derives `driver_id` from
the JWT. Plus the three **F4** fixes and one widening:

| Policy | Change |
|---|---|
| `vehicles_driver_scope` | Widen from `assigned_driver_id = auth_driver_id()` to *also* allow the vehicle in the driver's **current duty segment** — otherwise Home breaks the moment a driver slip-seats into a truck that is not theirs on paper. |
| `trailers_driver_scope` | **New** (F4). Driver reads only trailers appearing in their own duty segments. The *picker* list does not come from PostgREST — see the API note below. |
| `driver_time_off_driver_scope` | **New** (F4). Driver reads only their own rows. |
| `tms_movements_driver_deny` | **New** (F4). Drivers read none. |

**API** (`apps/api/src/routes/me.ts`, all `requireRole('driver')`, all audited):

| Endpoint | Purpose |
|---|---|
| `GET /api/me/equipment` | The **pick list**: active vehicles and trailers as a deliberately minimal projection (`id, unit_number, make, model`, plus `in_use_by` when currently held). Service-role, so RLS stays closed — a driver never gets a PostgREST-readable fleet roster with odometers and tank capacities. |
| `POST /api/me/shift/start` | `{ session_id, segment_id, vehicle_id, trailer_id?, start_odometer?, started_at? }`. Opens a session + first segment. Both ids are client UUIDs. |
| `POST /api/me/shift/equipment` | `{ segment_id, vehicle_id?, trailer_id?, from_at? }`. Closes the current segment and opens a new one — this is the **drop-and-hook / truck swap** path, and it does **not** end the shift. |
| `POST /api/me/shift/end` | `{ ended_at?, end_odometer? }`. Closes the session and its open segment. |
| `GET /api/me/shift` | The active session + current segment; folded into the `GET /api/me/driver` bootstrap payload to avoid a launch waterfall (**D29**). |

Contract lives in a new `packages/shared/src/dutyContract.ts`, parse-not-cast (**D24**), consumed by
the app, the API and the dispatch UI.

**Decision D44 (LOCKED) — the check-in is a staged soft gate, never a login wall.** The precise rules:

1. **No blocking modal at login.** A driver may open the app at their kitchen table to look at
   tomorrow's load. Home shows a **Start your day** card; that is the entire pressure.
2. **Vehicle is required** to open a session. **Trailer is optional** at start — *"Bobtail / not hooked
   yet"* is a first-class choice, because the trailer is frequently unknown until the driver reaches
   the shipper.
3. **Trailer becomes required** before completing a **pickup** stop on a load whose `equipment` implies
   a trailer, and before any reefer-relevant action. Blocking *there* is legitimate: the driver is
   physically at the shipper, with a trailer.
4. **Working a load without an active session** prompts inline — "Confirm your truck first" — one tap
   to the sheet, and it returns the driver exactly where they were. Never a dead-end (**D21**).
5. **Auto-close.** A session with no activity for `org.duty_session_timeout_hours` (default **16**, ≈ the
   HOS on-duty maximum plus margin) is closed by a server sweeper with `ended_reason='auto_timeout'`.
   Without this rule the exclusive-vehicle index jams forever on the first driver who forgets to sign
   off — this is a hard requirement of D43, not a nicety.
6. **Take-over, never silent theft.** Choosing a vehicle held by another driver returns **409** with the
   holder and the since-time. The sheet offers **Take over** (closes theirs with
   `ended_reason='taken_over'`, writes an event, notifies dispatch) · **Pick another** · **Tell
   dispatch**. Getting this silently wrong corrupts a week of fuel and idle attribution for two drivers
   at once, so it is surfaced, logged and reversible.
7. **Offline.** `shift_start`, `shift_equipment` and `shift_end` are outbox kinds with client-UUID PKs —
   a replayed record collides on the primary key and no-ops. The pick list is cached under
   `['me','equipment']` and persisted, so a check-in works with no signal. Conflicts are only knowable
   server-side, so an offline check-in is **provisional**: it renders with a pending badge, and a
   server rejection raises a **Needs attention** item (the Phase-2 surface) instead of vanishing.

### 14.5 Work package 3B — load lifecycle & the approval gate (backend)

**Decision D45 (LOCKED) — a load is not driver-visible until a human approves and releases it.**

New migration `0087_load_lifecycle.sql` replaces the `0085` status CHECK:

```
draft ──▶ pending_approval ──▶ approved ──▶ offered ──▶ accepted ──▶ in_transit ──▶ delivered
                                   ▲                        │
                                   └──── decline ───────────┘        (any state) ──▶ canceled
```

| Status | Meaning | Driver sees it? |
|---|---|---|
| `draft` | Created in the dashboard, still being filled in | ❌ |
| `pending_approval` | Submitted manually, **or ingested from McLeod** — awaiting dispatch review | ❌ |
| `approved` | Dispatch confirmed it is real and correctly configured; may sit here for days | ❌ |
| `offered` | **Released** to the assigned driver — the first driver-visible state | ✅ |
| `accepted` | Driver acknowledged / accepted (§14.6) | ✅ |
| `in_transit` | First stop worked, or an explicit **Start trip** — *fixes **F1*** | ✅ |
| `delivered` | All stops completed | ✅ |
| `canceled` | Dispatch canceled | ✅ (with an explanation) |

`status` **default changes from `'offered'` to `'draft'`.** That one line is why an unreviewed row can
no longer land on a phone.

New columns: `created_by`, `submitted_at`, `approved_by`, `approved_at`, `released_at`, `assigned_by`,
`assigned_at`, `declined_at`, `decline_reason`, `cancel_reason`, and `duty_session_id` — the session the
driver was in when they accepted, which is the stable historical join from a load to the equipment
actually used. Nothing about equipment is denormalized onto the load; the segments already hold it
exactly (§14.4).

**The RLS gate — the line that makes approval real at the boundary:**

```sql
create policy loads_driver_scope on loads as restrictive for select using (
  auth_role() <> 'driver'
  or (driver_id = auth_driver_id()
      and status in ('offered','accepted','in_transit','delivered','canceled'))
);
```

…cascaded identically into `load_stops_driver_scope` and `load_stop_photos_driver_scope`. Because RLS
— not the API — is the authorization boundary for this app (§1), the approval gate must be expressed
here or it is not a gate. The RLS matrix gains an explicit deny case: *"driver cannot read a
`pending_approval` load assigned to them (0)"*, exercised through raw PostgREST (**D10**).

**Transition enforcement, three layers:**

1. **`packages/shared/src/loadsContract.ts`** — `LOAD_TRANSITIONS: Record<LoadStatus, LoadStatus[]>`,
   `canTransition(from, to)`, and `approvalChecklist(load)` returning **named** unmet requirements. One
   function, three consumers: the dispatch UI disables **Approve** and renders exactly what is missing,
   the API rejects, the trigger backstops.
2. **API** — every transition is its own endpoint, never a `PATCH status`.
3. **DB trigger `loads_status_guard`** (BEFORE UPDATE) — validates the pair and enforces the gates:
   `pending_approval → approved` requires ≥1 pickup **and** ≥1 dropoff stop, a `driver_id`, a
   `vehicle_id`, appointment windows on every stop, and `approved_by` set (≠ `created_by` when the org
   turns on `require_separate_approver`, default **off**); `approved → offered` requires `driver_id` and
   stamps `released_at`.

**`load_events` — the append-only timeline** (same migration):

```
load_events
  id · org_id · load_id → loads(id) on delete cascade
  actor_user_id · actor_role · actor_driver_id
  kind · from_status · to_status · payload jsonb
  occurred_at (when it happened — may predate sync) · recorded_at (when we learned)
```

Kinds: `created, submitted, approved, rejected, assigned, reassigned, released, accepted, declined,
started, stop_arrived, stop_completed, stop_skipped, equipment_mismatch, amended, canceled, completed`.
**No update or delete policy for any role** — this is evidence, and it is what dispatch reads as the
load's history panel. It complements, and does not replace, the compliance `writeAudit` trail.

**Driver API** (`requireRole('driver')`, server-derived identity, narrow Zod input, never spread the
client body):

| Endpoint | Notes |
|---|---|
| `GET /api/me/loads` | Driver-visible statuses only (the RLS predicate is the same one). Stops + photos nested — one bootstrap payload, no launch waterfall (**D29**). |
| `POST /api/me/loads/:id/accept` | Verifies the load is `offered` and assigned to the caller; stamps `duty_session_id` from their active session; runs the §14.7 equipment comparison. |
| `POST /api/me/loads/:id/decline` | Reason required (§14.6). |
| `POST /api/me/loads/:id/start` | `accepted → in_transit` (also stamped implicitly by the first stop event) — **F1**. |
| `POST /api/me/loads/:id/stops/:stopId` | Status + photo paths; payload `{ load_id, stop_id, … }` — **F2**. |

### 14.6 Decision D46 (LOCKED) — one accept mechanism, two semantics

Company drivers and owner-operators mean different things by "Accept", and a carrier can have both on
the same fleet. Rather than fork the state machine, the **behaviour is resolved per driver** and only
the copy and the auto-unassign rule differ:

`drivers.driver_type text default 'company' check in ('company','owner_operator')`, with an org-level
default; resolution is `driver override ?? org default`.

| | `company` → **acknowledge** | `owner_operator` → **accept / decline** |
|---|---|---|
| Primary CTA | **I'm ready** | **Accept** |
| Secondary | **Can't take this** → reason + note | **Decline** → reason picker + note |
| Reason picker | Hours of service · Equipment · Personal · Other | Hours of service · Equipment · Rate/distance · Personal · Other |
| Effect on the load | Logs a `declined` event, raises a **dispatch exception** — but does **not** auto-unassign. Dispatch decides. | Returns the load to `approved` with `driver_id` cleared, logs the event, raises a dispatch alert. |
| Status written | `accepted` (on the positive path) | `accepted` (on the positive path) |

Both paths write the same `load_events` rows and hit the same two endpoints. There is one code path and
one state machine; the difference is a resolved setting, a label, and whether the unassign runs.

### 14.7 Decision D47 (LOCKED) — planned vs actual equipment: flag, never overwrite, never block

- `loads.vehicle_id` / `loads.trailer_id` are **planned** — dispatch's intent.
- The driver's current duty segment is **actual** — ground truth.
- On accept, and again at the first pickup, the API compares them. A mismatch writes an
  `equipment_mismatch` event, puts a caution chip on the driver's load card ("Dispatch planned Unit 214
  — you're in 219"), and raises a dispatch exception. It does **not** block the driver and does **not**
  rewrite dispatch's plan. Dispatch gets a one-click **Adopt driver's equipment**, which rewrites the
  plan and logs it.

Rationale: fleets swap trucks constantly, so blocking strands drivers; a silent overwrite destroys the
dispatch audit trail. Flagging is the only defensible option — and the flag is exactly the kind of
evidence FuelGuard already sells everywhere else.

### 14.8 Work package 3C — driver app screens

| Screen / surface | Content |
|---|---|
| **Home — duty card** (top of `(tabs)/home.tsx`) | Three states: **Start your day** CTA (no session) · **On duty · Unit 214 · Trailer 5521 · since 06:12** with **Change** (active) · the same with a pending badge (started offline, not yet confirmed). Replaces today's static "My truck / Assigned" row. |
| **Check-in sheet** (`features/duty/CheckInSheet.tsx`) | Truck (searchable; last-used first, the driver's `assigned_driver_id` unit pinned as **Your truck**) · Trailer (searchable; **Bobtail / not hooked yet** first-class) · optional odometer (`NumericField`) · Confirm. Conflict state renders the 409 take-over choices (D44.6). |
| **Change equipment** (same sheet, `mode='swap'`) | Reachable from Home and from inside the stop flow in ≤2 taps — drop-and-hook happens at a dock, in a hurry, in gloves. |
| **End shift** | In Home overflow and **More**; confirm sheet; optional end odometer. |
| **Loads list** (`app/(app)/loads/index.tsx`) | Segmented **Upcoming · Current · Previous** on real data; `LoadCard` — origin→destination, next appointment, stop count, equipment, hazmat badge, status. Equipment shown on the card **only when it differs** from the driver's current segment (otherwise it is noise). FlashList v2 (§22). |
| **Load detail** (`loads/[id].tsx`) | Ordered stops with type, address, appointment window and per-stop required-photo checklist; commodity + equipment; **Accept / I'm ready** CTA with the D46 copy, **Decline / Can't take this** secondary; or a stop progress tracker once current. |
| **Stop capture** (`loads/[id]/stop/[stopId].tsx`) | Guided per-stop flow: each required slot a labeled card; capture → review → complete. A missing required photo needs an explicit reason — kept, never blocked (**D21**). Trailer gate from D44.3 fires here. |

**Outbox kinds registered in Phase 3** (`src/data/handlers.ts`): `shift_start`, `shift_equipment`,
`shift_end`, `load_accept`, `load_decline`, `load_stop`. Every payload carries client UUIDs; photo
staging, EXIF stripping (**D12**) and driver-scoped upload paths are the Phase-2 machinery unchanged —
`${org}/${driver}/${load}/${photoId}.webp` (**F3**).

### 14.9 Work package 3D — Dispatch section on the web dashboard

**Decision D49 (LOCKED) — build the dispatch surface in Phase 3, not "later".** The previous draft
rejected a manager dispatch UI as "a second full feature before the driver side becomes useful." That
reasoning does not survive the approval requirement: an approval gate operated from a SQL editor is not
an approval gate. Loads must be creatable, assignable, approvable and releasable by a human in a
browser, or Phase 3 has no input.

Lives in `apps/web/src/features/dispatch/**` under the **existing** Dispatch nav section — the
capability matrix in `packages/shared/src/auth.ts` already grants `dispatch: manage` to `admin`,
`fleet_manager` and `dispatcher` and `view` to `auditor`, so **no auth changes are needed**.

| Page | Content |
|---|---|
| **Loads** `/dispatch/loads` | Tabs: **Needs approval** (default, badge count) · Approved · Dispatched · Active · Delivered · **Exceptions**. Rows: source badge (**Manual** / **McLeod**), ref, driver + live on-duty status, equipment, first appointment, completeness pill. **Bulk approve** for TMS batches — the same per-row gate applies, and partial success is reported per row, never swallowed. |
| **Load detail / editor** `/dispatch/loads/:id` | Header with status + the action set (Submit · Approve · Reject · Assign · Release · Cancel), each disabled with a reason when `canTransition()` says no. Stops editor: add / reorder / address + geocode / appointment window / **required-photo checklist builder** (writes `load_stops.required_photos`). Planned equipment beside actual-from-duty-segment. Hazmat. **Timeline** rendered from `load_events`. |
| **Create load** `/dispatch/loads/new` | The manual path that retires `seed_driver_load.sql`. Ref, driver, truck, trailer, equipment, commodity, hazmat, stops. Saves as `draft`; **Submit for approval** moves it to `pending_approval`. |
| **Assignments** `/dispatch/assignments` | The page you asked for. Live board: every driver, on-duty or not, their current truck + trailer, since when, current load, last activity. Actions: reassign equipment, end a stuck session, resolve a take-over conflict. Second tab: **History** — duty segments for a driver / vehicle / trailer over a date range, which is the attribution audit trail the detection engine's evidence panels can cite. |
| **Exceptions** (tab on Loads) | Equipment mismatches (D47) · declines (D46) · TMS amendments (D48) · auto-closed sessions (D44.5) · loads aging in `pending_approval` past a threshold. |

**The approval checklist is the product.** `approvalChecklist(load)` renders as named red/green items —
driver assigned · truck assigned · trailer (when equipment implies one) · ≥1 pickup · ≥1 dropoff ·
appointment window on every stop · hazmat flag consistent with commodity · required-photo slots set.
Required items block **Approve**; optional ones show as warnings. Every red item is click-to-fix inline.

**API** — new `apps/api/src/routes/dispatch.ts`, every route
`requireRole(...rolesThatManage('dispatch'))`, every mutation audited and event-logged:
`GET/POST /api/dispatch/loads` · `PATCH /api/dispatch/loads/:id` ·
`POST /api/dispatch/loads/:id/{submit,approve,reject,assign,release,cancel}` · stops CRUD ·
`GET /api/dispatch/assignments` · `POST /api/dispatch/assignments/:sessionId/end` ·
`POST /api/dispatch/assignments/:sessionId/equipment`.

### 14.10 Work package 3E — McLeod → loads ingest

**Decision D48 (LOCKED) — TMS loads land in `pending_approval`, and amendments never overwrite
silently.** May trail 3A–3D; the seam is correct once 3B lands.

- `tmsIngest.ts` gains a `loads` writer: McLeod **MovementService** + **StopService** → `loads` +
  `load_stops` with `source='tms'`, `provider='mcleod'`, `external_id`, and
  **`status='pending_approval'`**. The partial unique index on `(org_id, provider, external_id)` from
  `0085` makes the ingest idempotent, as designed.
- `org_integrations.config.auto_approve_loads`, **default `false`**, per-org and per-provider. A carrier
  may opt in once the field mapping is trusted; enabling it is itself audited.
- **Amendments.** A re-sync touching a load already past `approved` does **not** overwrite. It writes an
  `amended` event carrying the field diff and raises a dispatch banner — *"McLeod changed 2 fields on
  LD-20481 — review"* — which dispatch applies or dismisses. If McLeod cancels a movement the driver has
  already accepted, that is an urgent dispatch exception plus a driver push, never a row that silently
  disappears from a phone mid-run.
- **Prerequisite:** identity mapping (open question 6 in `docs/plans/MCLEOD-TMS-INTEGRATION.md`). If
  McLeod tractor / trailer / driver ids do not equal our unit numbers, add `external_id` columns to
  `vehicles`, `trailers` and `drivers` first. Resolve against real movements during TMS Phase 1.

### 14.11 Build order & parallelism

**3A** and **3B** are backend-only and share no files; they unblock everything else.
**3C** (app) and **3D** (web) then run in **parallel** — they touch disjoint code and meet only at the
shared contracts. **3E** trails.

```
3A duty sessions ─┐
                  ├─▶ 3C driver app ─┐
3B load lifecycle ┘                  ├─▶ Phases 5N · 5M · 6
                  └─▶ 3D dispatch ───┘
                            └─▶ 3E McLeod ingest
```

Demoable checkpoints: after 3A, a driver checks in and dispatch sees it. After 3B, an unapproved load
is provably invisible to a driver (the deny test). After 3D, a load goes from a browser form to a
phone with a human approval in between. After 3C, the full daily job runs offline end-to-end.

### 14.12 Exit criteria

**Equipment (3A / 3C)** — backend items ☑ verified 2026-07-27 (see §18); app items land with 3C.

- ☑ Opening a shift writes a session **and** its first segment in one transaction; trailer optional (`bobtail` stored as null). *(duty matrix)*
- ☑ Changing truck or trailer mid-shift closes the current segment and opens a new one **without ending the session**; a change that changes nothing writes no segment. *(duty matrix)*
- ☑ Picking a truck already held by another driver raises `DG001` → **409** carrying the unit, the holder's name and the held-since time; `take_over` then closes the holder's session with `ended_reason='taken_over'` and releases the truck. *(duty matrix + API tests)*
- ☑ A replayed check-in (the offline outbox draining twice) returns the same shift instead of opening a second one; a replayed sign-off is a no-op, not an error. *(duty matrix)*
- ☑ The sweeper closes a session past `duty_session_timeout_hours` with `ended_reason='auto_timeout'`, releases the truck, and honours a per-org override. *(duty matrix)*
- ☑ **RLS:** a driver reads only their own sessions/segments and writes nothing directly (raw-PostgREST deny on insert, update, delete); dispatch may correct a session; the three **F4** policies have allow **and** deny cases. *(RLS matrix 85/85)*
- ☑ The exclusive-equipment rules are enforced by the **database**, not the application: two drivers cannot hold one truck or one trailer, and one driver cannot have two open shifts. *(RLS matrix)*
- ☐ A driver with no active session sees **Start your day**; picking a truck opens a session and Home switches to the live duty card. *(3C)*
- ☐ A check-in performed offline queues, survives relaunch, syncs on reconnect, and a server-side conflict surfaces in **Needs attention** rather than disappearing. *(3C)*
- ☐ Completing a **pickup** stop on a trailer-equipment load with no trailer on the session prompts for one (D44.3) and does not dead-end. *(3B + 3C)*

**Lifecycle & approval (3B / 3D)** — backend items ☑ verified 2026-07-27 (see §18); dispatch UI lands with 3D.

- ☑ A load inserted as `draft`, `pending_approval` **or `approved`-but-unreleased** with a `driver_id` is **provably invisible** to that driver through raw PostgREST — including its stops and its events. A load inserted with no explicit status defaults to `draft` and is therefore invisible by construction. *(RLS matrix)*
- ☑ The trigger rejects approval with no driver, no truck, no dropoff, or a stop missing its appointment window; with separation of duties on, it rejects a creator approving their own load. `approvalChecklist()` names every blocker at once with a fix hint. *(lifecycle matrix + 26 contract tests; the click-to-fix UI is 3D)*
- ☑ Approve → Release stamps `approved_at` and `released_at` and the load becomes driver-visible. *(lifecycle matrix)*
- ☑ `draft → in_transit` is rejected by the shared map **and** the trigger (`DL010`); `delivered` and `canceled` are terminal and cannot be reopened. *(both matrices)*
- ☑ **F1 closed.** `in_transit` is reachable explicitly (`POST /start`) *and* implicitly — working the first stop moves an accepted load to `in_transit`, and resolving the last stop moves it to `delivered`. A replayed accept or stop-sync is idempotent (no duplicate events, no duplicate photos). *(lifecycle matrix)*
- ☑ Backend half: an owner-operator's decline returns the load to `approved`, clears `driver_id` **and** clears `released_at` so it must be re-released; a company driver's decline records the reason and raises the exception without unassigning. `acceptanceCopy()` supplies the two label sets. *(lifecycle matrix + contract tests; the screens are 3C)*
- ☑ Backend half (D47): accepting in a truck other than the planned one **succeeds**, writes an `equipment_mismatch` event, stamps the duty session onto the load, and leaves dispatch's plan untouched. *(lifecycle matrix; the chip and the Adopt action are 3C/3D)*
- ☑ `load_events` renders as the dispatch timeline on the load page, and is append-only for **every** role including the service role — a trigger blocks UPDATE and DELETE outright, so RLS is not the only thing standing between a bug and rewritten evidence. A driver reads events only on loads they can already see. *(RLS matrix)*

**Dispatch surface (3D)**

- ☑ A load can be created, assigned, approved, released and canceled entirely in the browser — `seed_driver_load.sql` is no longer required for any flow.
- ☐ **Assignments** shows live duty state for every driver and can end a stuck session; History returns segments for a driver/vehicle/trailer over a date range.
- ☑ Bulk approve reports per-row outcomes; a row failing its gate does not silently succeed — the batch continues and returns `{succeeded, failed, outcomes[]}`.
- ☐ Role gating matches `rolesThatManage('dispatch')`; an `auditor` sees everything read-only; a `driver` cannot reach any dispatch route.

**Driver daily job (3C)**

- ☐ A stop's required photos capture offline, survive relaunch, upload on sync, and appear on the dispatch side.
- ☐ Multi-stop runs advance stop-by-stop; a missing required photo needs an explicit reason.
- ☐ Photos are EXIF-stripped and land under `${org}/${driver}/${load}/${photoId}.webp` (deny test proves driver isolation).
- ☐ Screens token-only (`lint:tokens` green), ≥48pt targets, Dynamic-Type safe, light + dark.

**Cross-cutting**

- ☐ `pnpm -r typecheck && lint && test` green; every new policy in `supabase/tests/rls.test.mjs` with allow **and** raw-PostgREST deny cases (**D10**); API tests for every new endpoint.
- ☐ **F2** and **F3** drift closed: no `assignment_id` anywhere; storage path matches `stopPhotoPath()`.
- ☐ Doc updated with the verification tally (offline→online on iOS + Android; a load approved in the browser and worked on a phone).

### 14.13 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Widening `loads.status` after release | It is a text column + CHECK, not a PG enum, and **no production loads exist** (seed script only). Done in Phase 3, this is `DROP/ADD CONSTRAINT` + a default change. §14.2 states why this is the last cheap moment. |
| Exclusive-vehicle index breaks team driving | The `seat` column (`driver` \| `co_driver`) is in the index predicate from day one. |
| Sessions never end → vehicles permanently locked | The auto-timeout sweeper (D44.5) is a **required** part of D43, with `ended_reason` so auto-closes never pollute attribution analysis. |
| Offline check-in conflicts | Provisional state + **Needs attention**; conflicts resolve server-side on drain and are never silently dropped (D44.7). |
| 3D is a second full feature | Ship the queue + approve + release + create form first (it is the gate's minimum viable operator); the richer planning board is explicitly a follow-on in §17.3. It builds on the existing web design system, so it is components, not architecture. |
| TMS overwrites dispatch decisions | Amendments as diffs + review, never in-place writes past `approved` (D48). |
| Terminology drift returns | D50 locks the three names; `driver_vehicle_assignments` is annotated in-place as a non-truth-source. |
| Scope creep into full dispatch optimisation | Phase 3 is: check in → approve → release → accept → work stops. Planning, optimisation, load boards and rating stay out (§17.3). |

---

## §15. Navigation — deferred to its own programme (D52)

> **Not a driver-app phase any more.** Navigation was Phase 4; **D52** moves it out of the critical
> path to be planned separately once the app ships. This section is kept as the handover note so the
> navigation programme starts from what exists rather than rediscovering it.

**What is already built and untouched (the whole server-side brain):**

- **`0059_route_geometries.sql`** + **`0060_route_geometry_steps.sql`** — stored route geometry and
  turn-by-turn steps from HERE Routing v8 on a truck profile (axle/weight/hazmat class/tunnel
  category), cache-keyed so a profile or logic change misses correctly.
- **`0074_fuel_plans.sql`**, **`0058_smart_fueling_spine.sql`**, **`0028_fueling_event.sql`** — the
  price-optimised fuelling plan: which stations, how many gallons, within range and reserve and HOS.
- **`packages/shared/src/smartFueling/`** — the `planFuelStops` solver, `RouteFuelSettings`, alert
  thresholds. `apps/web/src/features/fueling/**` renders all of it for dispatch today.
- **`apps/api/src/lib/here.ts`** + `services/routeGeometry.ts` — the live HERE fetch, retry and parse.

**What was never built** (the audit finding behind D52): `apps/driver/app/(tabs)/navigate.tsx` is a
three-line redirect to `/drive`; **MapLibre is not a dependency** of `apps/driver`; the MapTiler
account (**T8**) is not procured; and no task anywhere covers **HERE SDK Navigate Edition** licensing.

**The decision the programme owns.** The former §8 position locked v1 to *display-only* — render the
HERE polyline with maneuver/corridor cards over MapLibre, with true voice turn-by-turn deferred. That
choice is now open again and belongs to the navigation plan, together with everything it drags in:
SDK licensing and per-driver cost, an Expo config-plugin native bridge, offline map packs, background
location and its Apple/Google declarations, and battery behaviour on an all-day shift.

**The seams left in place.** The center tab slot is designed into the shell but not rendered (§22.1);
`navigate.tsx` and `drive.tsx` stay in the route tree; a load reaching `in_transit` is the natural
trigger; and `loads.hazmat` + the vehicle's routing profile already carry everything a truck-legal
route request needs. Nothing in Phases 3, 5, 5N or 5M depends on navigation existing.

---

## §15A. Remaining phases

Per the incremental rule (§0), these are scoped now and specified in full at build time. Every one of
them is a **module** under **D56**: its own `features/` folder, migration, shared contract, RLS policies
with allow **and** deny cases, and — where sellable — an entitlement key it can be switched off by.

**Order.** `5` (Performance) → `5E` (Entitlements) → `5N` (Notifications) → `5M` (Messages) → `6`
(HazmatGuard) → `7` (Training). Performance is nearly free and closes a half-built surface;
entitlements gate everything after it; notifications must exist before messages are worth anything.

### Phase 5 — Driver Performance (self-view)

**Smaller than this plan used to claim.** The scoring math is already built
(`packages/shared/src/driverPerformance/`: `combineWeek`, `rankTrailing`) and drives the manager web
pages — *and the RESTRICTIVE self-read policy this section listed as backend work already shipped in
`0084` (`dpw_driver_scope`)*. What remains is genuinely only the read path and the screen.

A **My Score** tab shows the driver's latest weekly score, its sub-scores (safety / efficiency /
idling, per `DEFAULT_PERFORMANCE_SETTINGS` weights), a 7-week sparkline each, trailing rank, and a
plain-language coaching line derived from the weakest component. Read-only, self-scoped, cached-first
so it renders offline. **Backend — the one deliberately open item in this plan, and it is a measurement, not a judgement:**
read `driver_performance_weeks` directly through the existing `dpw_driver_scope` policy **unless** that
pushes the cold-start bootstrap above **two** round trips, in which case fold it into the existing
`GET /api/me/driver` payload (D29 forbids a launch waterfall). Count the requests on a cold start and
take whichever the count dictates — no new endpoint unless the measurement demands one. `score.tsx`
exists as a sample-data shell and is wired to real data here.

### Phase 5E — Module entitlements (D55)

The gate every sellable module hangs off, built before the modules that need it.

`org_modules (org_id, module_key, enabled, enabled_at, enabled_by, config jsonb)`, keys
`hazmatguard | training | messages | notifications | dispatch | navigation`. Delivered in the driver
bootstrap payload and the web session so the UI can hide a disabled module, **and** enforced where it
actually matters: a RESTRICTIVE predicate on each module's own tables (`auth_module_enabled('…')`, a
`stable security definer` helper mirroring `auth_driver_id()`), plus an API guard. Absent key =
disabled — a new org gets nothing by accident. Admin toggles live in the platform admin app
(`apps/admin`), audited on every change.

Exit: ☑ a module can be switched off for one org and its surfaces disappear from the app, its API
returns 403, and its tables return zero rows to a raw PostgREST call — with every one of those three
asserted, and no other org affected. *(Layer 1 + isolation proven in the RLS matrix; layer 2 is
`requireModule()` on the dispatch router; layer 3 is `useModules()`. The remaining work is applying
the same three layers to 5N/5M/6/7 as each module lands — the pattern is now one line each.)*

### Phase 5N — Notifications (D53)

**The module that makes the approval flow real.** Dispatch releasing a load is invisible today until a
driver happens to open the app.

- **Schema:** `notification_events (id, org_id, audience_user_id, category, title, body, entity_type,
  entity_id, deep_link, severity, created_at)`; `notification_reads (event_id, user_id, read_at)`;
  `device_push_tokens (user_id, token, platform, app_version, last_seen_at, revoked_at)`.
- **Categories:** `load_offered`, `load_changed`, `load_canceled`, `message_received`,
  `duty_auto_closed`, `performance_week`, `training_due`. Each maps to a deep link that opens the
  exact load, thread or screen — a notification that lands on Home is a wasted notification.
- **Delivery:** Expo Push (`expo-notifications`, dev-build only) from a worker service, with token
  registration on sign-in, rotation handling, and **hard unregistration on sign-out and on
  `revokeDriverAccess()`** so an offboarded driver stops receiving fleet data on their personal phone.
- **Preferences:** per-category opt-out plus **quiet hours**, stored per user and enforced
  server-side, not just on device. Load-critical categories may be marked non-suppressible per org.
- **In-app centre:** the top-bar bell (§22.1) opens a list backed by the same events, so a driver who
  denied the OS permission still gets everything. Unread count is cached and correct offline.
- **Permission priming:** the value-explaining screen *before* the OS dialog (§22.6), triggered the
  first time a notification is actually relevant — never cold on launch.
- **RLS:** RESTRICTIVE driver scope on all three tables (`audience_user_id = auth.uid()` / own tokens
  only), no driver write policy on events, allow + raw-PostgREST deny cases.
- **Store compliance:** Apple/Google push declarations, and a Data-safety entry for the device token.

### Phase 5M — Messages (D54)

Office↔driver communication, and the first surface in this stack that needs **inbound** realtime.

- **Schema:** `message_threads (id, org_id, subject, load_id?, created_by, last_message_at,
  status)`; `thread_participants (thread_id, user_id, role, joined_at, last_read_at)`;
  `messages (id /* CLIENT UUID */, thread_id, org_id, sender_user_id, body, attachment_path?,
  created_at, edited_at, deleted_at)`.
- **Load-bound threads.** `threads.load_id` lets a conversation carry its context — "about LD-20481"
  — so dispatch and driver are provably talking about the same run, and the thread shows up on the
  load detail on both sides. This is the detail that makes internal fleet messaging useful rather
  than a second inbox nobody reads.
- **Offline:** outbound rides the **existing Phase-2 outbox** (`message_send`), client-UUID PK so a
  replayed drain collides and no-ops. A message written in a dead zone is queued, visible as pending,
  and never lost.
- **Inbound:** Supabase **Realtime** subscription on `messages` filtered by the driver's threads, with
  a cache-backed fallback poll on reconnect — D4's model is write-only today, so this is new
  machinery and gets its own verification.
- **Read state:** `thread_participants.last_read_at`, driving the top-bar unread badge and dispatch's
  "driver has seen it" column — which is the whole reason dispatch asks for messaging.
- **Dispatch side:** an inbox in the web **Dispatch** section, thread list + composer, and a "message
  driver" action on the load detail and the Assignments board.
- **RLS:** a driver reads only threads they participate in and writes only messages where
  `sender_user_id = auth.uid()`; cannot add participants, cannot edit or hard-delete another's
  message; soft-delete only, with the audit trail retaining the body. Allow + deny cases throughout.
- **Governance:** retention window and export are admin settings; message content is discoverable in
  a dispute, so nothing is hard-deleted by a driver.
- **Store compliance:** Apple treats in-app user-generated content as needing **report/block**
  affordances even for internal-only apps — a "report message" action and an admin-side block satisfy
  1.2 without inventing moderation the fleet does not need.

### Phase 6 — HazmatGuard (inside the load flow)

Guided hazmat documentation captured as a **step within the Phase-3 load flow** when a load carries a
hazmat commodity (`loads.hazmat`) — the required placard / shipping-paper / securement photos —
**entitlement-gated on `hazmatguard` (D55, now a real gate)**. Reuses the same outbox and driver-scoped
photo Storage as load-step capture; no new capture engine. Reference material (placard lookup,
shipping-paper rules) sits under **More**, behind the same key. Grounds on
`docs/18-HAZMATGUARD-PLAN.md` (API pre-frozen — "zero new endpoints") and
`docs/17-HAZMAT-BOL-COMPLIANCE.md`. **Not a tab** — see D51 for why.

### Phase 7 — Driver Safety Training (micro-LMS)

A video + quiz micro-LMS (`docs/plans/DRIVER-TRAINING-PLAN.md`): a **Training** surface under More with
assigned courses, a media/video-player module boundary, quiz capture, and completion tracking that can
later feed the performance coaching signal. Entitlement-gated on `training`. Self-contained; built
last. Due-date reminders ride the Phase-5N `training_due` category.

---

## §16. Cross-cutting backend changes (summary)

All additive — "we add; nothing above is modified destructively." Migrations from **0083**. **D41
reframed the feature backend** away from fuel capture toward loads/assignments; the identity/RLS spine
is unchanged.

- `0083_driver_identity` — `invites.driver_id`; partial-unique `drivers(org_id,user_id) where user_id is not null`; **`drivers.user_id` → `on delete set null`** (D14); link at accept. **(built)**
- `0084_driver_scoped_rls` — `auth_driver_id()` + **RESTRICTIVE** driver SELECT policies (D9/D10) + raw-PostgREST deny cases in the matrix. **(built)** *(The fuel-transactions INSERT-scoping is moot now drivers don't insert fuel — D41; the SELECT scoping stays.)*
- `0085_driver_loads` — `loads` / `load_stops` / `load_stop_photos` + driver-scoped RLS + the `load-photos` bucket (`${org}/${driver}/${load}/${photoId}.webp`, size/mime limits, no `upsert` — the D13 pattern repurposed from receipts). **(built)**
- **`0086_duty_sessions` (Phase 3A, D43/D44)** — `driver_duty_sessions` + `duty_equipment_segments` with the three partial unique indexes (one active session per driver; one `seat='driver'` holder per vehicle and per trailer); RESTRICTIVE driver self-scope on both; **widen `vehicles_driver_scope`** to include the driver's current-segment vehicle; and the three **F4** gaps closed — new `trailers_driver_scope`, `driver_time_off_driver_scope`, `tms_movements_driver_deny`, all `select using (org_id = auth_org_id())` today and therefore readable fleet-wide by any driver JWT.
- **`0087_load_lifecycle` (Phase 3B, D45)** — widen the `loads_status_check` to the eight-state lifecycle, **change the default from `offered` to `draft`**, add the approval/release actor+timestamp columns + `duty_session_id`, add `drivers.driver_type` (D46), add the `loads_status_guard` trigger, add append-only **`load_events`** (no update/delete policy for any role), and tighten `loads_driver_scope` / `load_stops_driver_scope` / `load_stop_photos_driver_scope` with the driver-visible-status predicate.
- **Driver Performance (Phase 5)** — RESTRICTIVE driver self-read on `driver_performance_weeks`. **Already shipped** as `dpw_driver_scope` in `0084`; Phase 5 is the read path and the screen, not new backend.
- **`00NN_module_entitlements` (Phase 5E, D55)** — `org_modules (org_id, module_key, enabled, enabled_at, enabled_by, config)` + a `stable security definer` `auth_module_enabled(text)` helper mirroring `auth_driver_id()`; a RESTRICTIVE predicate per gated module's tables, an API guard, and the bootstrap payload for the UI. Absent key = disabled.
- **`00NN_notifications` (Phase 5N, D53)** — `notification_events`, `notification_reads`, `device_push_tokens`, `notification_preferences` (per-category + quiet hours); driver RESTRICTIVE self-scope on all four, no driver write on events; push tokens revoked on sign-out **and** in `revokeDriverAccess()` so an offboarded driver's personal phone stops receiving fleet data.
- **`00NN_messages` (Phase 5M, D54)** — `message_threads` (optional `load_id`), `thread_participants` (`last_read_at`), `messages` (**client-UUID PK** for outbox idempotency, soft-delete only); driver reads only threads they participate in, writes only their own messages, cannot add participants or hard-delete; Realtime publication scoped to `messages`.
- API: relax domain for `role:'driver'` invites **(token-enforced accept — D15, built)**; `GET /api/me/driver` **(built)**; `POST /api/me/delete-account` **(built)**; `revokeDriverAccess()` offboarding **(built)**; **Phase 3A:** `GET /api/me/equipment`, `GET /api/me/shift`, `POST /api/me/shift/{start,equipment,end}`; **Phase 3B:** `GET /api/me/loads`, `POST /api/me/loads/:id/{accept,decline,start}`, `POST /api/me/loads/:id/stops/:stopId` (narrow input, server-derived identity, audited); **Phase 3D:** new `apps/api/src/routes/dispatch.ts` — `GET/POST /api/dispatch/loads`, `PATCH /api/dispatch/loads/:id`, `POST /api/dispatch/loads/:id/{submit,approve,reject,assign,release,cancel}`, stops CRUD, `GET /api/dispatch/assignments`, `POST /api/dispatch/assignments/:sessionId/{end,equipment}` (all `requireRole(...rolesThatManage('dispatch'))`); **Phase 5 (optional):** `GET /api/me/performance`.
- Shared contracts: **`dutyContract.ts`** (new, Phase 3A) and `loadsContract.ts` extended with `LOAD_TRANSITIONS`, `canTransition()`, `approvalChecklist()` and the acceptance-mode resolver — one source consumed by the app, the API, the trigger's mirror and the dispatch UI.
- Web: **new `apps/web/src/features/dispatch/**`** (D49) — Loads queue + approval, load editor, create form, Assignments board, Exceptions. No change to `packages/shared/src/auth.ts`; the Dispatch section capabilities already fit.
- ~~`POST /api/me/fillups` + `0085_driver_receipt_storage`~~ — **dropped (D41):** no manual fuel capture in the driver app.
- Web: role guard redirecting `driver` away from the dashboard **(built)**.
- Config (pre-launch, D16): HIBP leaked-password on, `minimum_password_length ≥ 10`, captcha on auth, lower driver `jwt_expiry`, confirm admin MFA enabled.

---

## §17. Testing & verification standard, conventions, and future work

### 17.1 Verification bar (every phase clears it before commit)

`pnpm typecheck && lint && build && test` green (driver app in `pnpm -r`); token-lint green; any new
migration appended to the **offline RLS matrix** with allow+deny assertions; a real-device smoke test
per phase (camera/nav need hardware); the phase records a verification tally in its section and a row
in §18.

### 17.2 Conventions inherited (from `CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md`, `docs/REORG-BACKLOG.md`)

One living plan doc; phased, checkbox-tracked, demoable per phase, one phase per session; pure logic in
`packages/shared` (never duplicate a Zod schema in an app); migrations are the single source of truth
(never edit an applied one; every table gets RLS; append to the matrix); API-first frozen contracts;
design tokens only (linted); 500-line file-size budget; feature-boundary import checks; additive
changes; external integrations get a live verification probe before clients are locked.

### 17.3 Future work (author each as its own §18+ section when v1 lands)

Driver Safety Training (micro-LMS) player; HazmatGuard driver capture (API pre-frozen, "zero new
endpoints"); Smart-fueling "My Plan" read + push alerts/reminders; Fueling navigation (HERE polyline +
fuel-stop overlays, graduating to on-device nav). Each reuses `@fuelguard/shared`, the offline outbox,
the design system, and the identity/RLS model established in v1. Notes and seams are in §3.2.

Two follow-ons created by the Phase-3 re-cut (D43–D50), deliberately **out** of Phase 3:

- **Attribution engine prefers duty segments.** `idle_events.driver_source` gains a `confirmed` value
  outranking `direct` and `inferred`, and the idle / fuel / MPG attribution paths resolve
  driver↔vehicle↔trailer from `duty_equipment_segments` wherever a segment covers the instant, falling
  back to `driver_vehicle_assignments` (Samsara) only when none does. This is the precision payoff of
  D43 — a human in the cab outranks an inference — and it also gives the reefer rules a first-party
  trailer signal instead of depending on `tms_movements`. Touches the detection engine, so it lands as
  its own work package with its own regression tally, not inside a driver-app phase.
- **Dispatch planning board.** Phase 3D ships the *operator* of the approval gate (queue, approve,
  release, create, assignments, exceptions). The richer surface — planning board, drag-assign against
  driver availability and HOS, multi-load trip building, rating — is a separate feature that builds on
  the same tables and the same `load_events` timeline.

---

## §18. Build Log (append a row when a phase is built/verified)

| Date | Phase | Commit(s) | Verification tally | Notes |
|---|---|---|---|---|
| 2026-07-27 | **5E — Module entitlements** | *(working tree)* | RLS **115/115** (+14) · duty 20/20 · lifecycle 42/42 · shared 886/886 · API 158/158 · web vue-tsc 0 errors | `0088_module_entitlements.sql`, `packages/shared/src/entitlements.ts`, `middleware/requireModule.ts`, modules on `GET /api/me/driver`, dispatch router gated, `apps/web/src/composables/useModules.ts`. **The migration-safety call worth noting:** "absent key = disabled" is right for an unsold module but would have taken Dispatch away from every existing customer on deploy — hence the explicit backfill + seed trigger. **Typecheck catch:** supabase-js's `PostgrestBuilder` is a thenable, not a Promise, so `.catch()` did not exist on it |
| 2026-07-27 | **Phase 3 completion — 3D finish + 3E ingest** | *(working tree)* | RLS 101/101 · duty 20/20 · lifecycle 42/42 · shared **886/886** · API **158/158** (+13 ingest) · **web vue-tsc 0 errors** · all design-token lints clean | `packages/shared/src/tms.ts` (+load ingest contract), `services/tmsLoadIngest.ts` + tests, `POST /api/tms/loads`, `POST /api/dispatch/loads/bulk` + `bulkTransition`, load timeline + inline lifecycle actions. **Also fixed during verification:** a missing `ClipboardDocumentListIcon` import that would have broken the web build, and the `/dispatch/*` routes + sidebar entries which had been lost from the working tree |
| 2026-07-27 | **3C — Driver app (duty + loads) ∥ 3D — Dispatch (core)** | *(working tree)* | driver: token-lint clean, every icon/tone/variant/size/haptic + component import verified against the real signatures, `tsc` clean across all 3C files · dispatch: API `tsc --noEmit` clean, **145/145** API tests, web token-check clean | **3C:** `features/duty/{useDuty,DutyCard}`, `app/duty/check-in.tsx` (search, pinned default truck, held units last, bobtail first-class, 409 take-over sheet, optional odometer), Home + Loads on real data, `app/loads/[id].tsx` (itinerary, photo checklist, accept/decline with server-resolved copy), D51 tab shell, outbox handlers for all six driver mutations. **3D:** `routes/dispatch.ts`, `services/dispatchLoads.ts`, `dispatchContract.ts`, `useDispatchLoads.ts`, Loads queue + editor + Assignments board, router + nav. **Two real bugs caught by typecheck:** `ActiveLoad` imported from the wrong module; `updateLoad` taking an actor it never used |
| 2026-07-27 | **3B — Load lifecycle & approval gate** | *(working tree)* | RLS matrix **101/101** (+16 approval-gate + event cases) · lifecycle behaviour matrix **42/42** (new `supabase/tests/load-lifecycle.test.mjs`) · `@fuelguard/shared` **886/886** (+26 `loadsLifecycle`) · `@fuelguard/api` **144/144** · shared + API `tsc --noEmit` clean | `0087_load_lifecycle.sql`, `packages/shared/src/loadsLifecycle.ts` (+ `loadsContract.ts` enum widened to eight states), `apps/api/src/services/driverLoads.ts`, `routes/me.ts` (+4 endpoints). **Typecheck caught a real gap:** the lifecycle was widened in SQL but `LOAD_STATUSES` still listed only the five 0085 states, so the contract could not represent `draft`/`pending_approval`/`approved` — fixed, and `loadBucket` rewritten so only `in_transit` reads as Current |
| 2026-07-27 | **3A — Equipment & duty sessions** | *(working tree)* | RLS matrix **85/85** (was 62/62; +23 duty + F4 cases) · duty behaviour matrix **20/20** (new `supabase/tests/duty-sessions.test.mjs`) · `@fuelguard/shared` **860/860** (+31 `dutyContract`) · `@fuelguard/api` **144/144** (+11 `dutySessions`) · shared + API `tsc --noEmit` clean | `0086_duty_sessions.sql` (tables, 3 exclusivity indexes, RLS + the three F4 fixes, 4 RPCs), `packages/shared/src/dutyContract.ts`, `apps/api/src/services/dutySessions.ts` + `dutySessionSweeper.ts`, `routes/me.ts` (+5 endpoints), `schedulers.ts`. Ran in a Linux container — the repo's `node_modules` are macOS-native, so `pnpm -r` on the dev machine is the confirming run. No ops step; the migrate workflow applies `0086`. Device pass deferred to 3C (no UI yet) |

---

## §19. Sources (code & docs this plan is grounded in)

- Reuse surface: `packages/shared/*` (esp. `auth.ts`, `fuel.ts`, `apiContract.ts`, `smartFueling/`, `driverPerformance/`), `packages/shared/package.json`.
- Auth/invite/identity: `supabase/migrations/0003_core_tables.sql`, `0004_rls.sql`, `0006_auth_hook.sql`, `config.toml`, `apps/api/src/routes/invites.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/auth.ts`, `apps/web/src/pages/auth/AcceptInvitePage.vue`, `apps/web/src/router/index.ts`.
- Driver-facing web flow: `apps/web/src/features/fuel/{FillUpForm.vue,useFuelLog.ts,imageCompress.ts}`, `apps/web/src/pages/FuelLogPage.vue`, `apps/web/src/lib/{supabase.ts,api.ts,uuid.ts}`, `apps/web/src/stores/session.ts`, `apps/web/src/composables/useDrivers.ts`.
- Design system: `packages/ui/src/tokens.css`, `packages/ui/src/components/App{Button,Input,Card}.vue`, `apps/web/scripts/check-design-tokens.mjs`, `scripts/check-token-parity.mjs`, `docs/DESIGN-SYSTEM.md`, `apps/web/src/lib/badges.ts`.
- Performance & planned features: `packages/shared/src/driverPerformance/*`, `docs/16-DRIVER-PERFORMANCE.md`, `docs/plans/DRIVER-TRAINING-PLAN.md`, `docs/18-HAZMATGUARD-PLAN.md`, `docs/17-HAZMAT-BOL-COMPLIANCE.md`, `docs/plans/SMART-FUELING-PLAN.md`, `docs/10-SAMSARA-RECONCILIATION.md`.
- Conventions: `CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md`, `docs/REORG-BACKLOG.md`, `README.md`.
- External UX/design research: Samsara Driver / Workflow Builder, Motive driver experience, Trucker Path, Expo Notifications, WatermelonDB/PowerSync offline-first, NativeWind/Restyle comparisons, HERE SDK + RN, WCAG 2.2 mobile.

---

## §20–§24. Audit rounds — historical provenance

> **Read §9 first; these five sections are history, not instructions.** They record how the locked
> decisions were arrived at (what was verified, what was found wrong, what changed as a result) and
> are kept because that trail is useful when revisiting a decision. **Where any of them conflicts with
> §9, §9 wins** — the 2026-07-27 cleanup pass reconciled every conflict it found, and several rows in
> these sections still describe a world before D41/D51/D52 (fuel capture, the old tab bar, navigation
> as Phase 4). Two subsections are exceptions and remain **live specification**, kept here only for
> numbering stability: **§22.1** (information architecture — rewritten, matches D51) and
> **§22.2–§22.10** (UX library pins, component set, interaction, state matrix, accessibility, visual
> identity, microcopy). Treat those as current; treat the surrounding findings narrative as archive.

---

## §20. Audit Round 1 — Verification Findings & Resolutions

> Four adversarial verification passes checked every claim in this plan against the **current code**
> (`/fgv` snapshot, migrations through 0082) and the **2026 RN/Expo toolchain**. Findings are recorded
> here with a resolution for each (this file's `06-AUDIT-FINDINGS.md`-style changelog). **This section
> governs where it conflicts with an earlier inline statement.** Verdicts: ✅ confirmed · ✏️ corrected ·
> ⛔ blocker · 🆕 new (not previously in the plan).

### §20.1 Blockers to clear before build

| ID | Blocker | Resolution | Owner/when |
|----|---------|-----------|-----------|
| **B1** | ⛔ Custom Access Token hook is **commented out** in `supabase/config.toml:284-286`; without it no `org_id`/`user_role` claims are issued and RLS denies everything. Not verifiable from code. | Enable it in the Supabase Dashboard (Auth → Hooks) for the target project, or uncomment `[auth.hook.custom_access_token]` and point the URI at `public/custom_access_token_hook`. Confirm before any auth work. | **Miki to confirm** |
| **B2** | ⛔ Metro cannot resolve the **134 `.js`-suffixed → `.ts`** import specifiers in `@fuelguard/shared` (Vite/tsc tolerate this; Metro does not). Nothing bundles otherwise. | **D7:** give `@fuelguard/shared` a `tsc` build step emitting `dist/` + a `package.json` `exports` map with `react-native`/`default` conditions. (Fallback: a Metro `resolveRequest` `.js`→`.ts` shim.) Validate in the Phase-0 spike. | Phase 0 |
| **B3** | ⛔ pnpm's symlinked `node_modules` breaks RN/Expo native autolinking; no `.npmrc` exists. | **D8:** add `.npmrc` `node-linker=hoisted` (retest web/admin/api installs after); configure Metro `watchFolders`+`nodeModulesPaths`+`unstable_enableSymlinks`+`unstable_enablePackageExports`. Expo SDK 54+ has isolated-mode support but autolinking there is still flaky — hoisted is the safe call. | Phase 0 |
| **B4** | ⛔ `"type":"module"` collision — every package sets `"type":"module"`, but Expo's `babel.config.js`/`metro.config.js` are CJS. If `apps/driver` inherits/sets it, tooling crashes on start. | `apps/driver/package.json` **omits** `"type":"module"` (or name configs `.cjs`). | Phase 0 |
| **B5** | ⛔ Driver-inserted fills **won't score**: `POST /api/transactions/:id/score` is `requireRole('admin','fleet_manager')` → 403 for a driver, and there is **no INSERT trigger** on `fuel_transactions`. A driver's fill would forever show null MPG/status. | **D5 already covers this** — `/api/me/fillups` inserts **and** calls `scoreWithCascade` server-side (service-role). Confirmed reusable. Scope the cascade + decide whether to suppress the manager notification emails it fires (F7). | Phase 3 |
| **B6** | ⛔ zod 4.4.3 on Hermes has an open Metro **package-exports dual-package hazard** ("expected a Zod schema" on device though it works on web). | Add a Metro `resolveRequest`/package-exports override; **spike on a physical Hermes device in Phase 0**. Documented fallback: pin zod 3.x for the app. (O7) | Phase 0 spike |

### §20.2 Corrections to inline claims (✏️) and confirmations (✅)

**Auth / identity / RLS**

- ✅ `signInWithPassword` + JWKS-verify-only API; hook injects `org_id`/`user_role` (not `role`) from the *earliest* membership; `auth_org_id()`/`auth_role()` read those claims. (`session.ts`, `apps/api/src/lib/auth.ts`, `0006_auth_hook.sql`, `0002_functions.sql`.)
- ✅ `drivers.user_id` is nullable, FK to `auth.users`, **never written anywhere**, **no unique constraint** (grep of migrations/routes/web/seed/samsara sync). Accepting a driver invite creates only a `memberships` row, no `drivers` link.
- ✏️ **Relax the domain check in BOTH handlers.** The plan mentioned the *create* check (`invites.ts:105-109`); there is **also** an accept-time check (`invites.ts:257-261`). Both must be relaxed for `role='driver'` or personal-domain drivers are rejected at accept. → Phase 1 §12.4 updated intent.
- ✏️ **`auth_driver_id()` needs the partial unique index first.** `drivers.user_id = auth.uid()` could match multiple rows without the `unique (org_id,user_id) where user_id is not null` index. Migration order is already correct (0083 index → 0084 policies); make the function tolerant (single-row) regardless.
- 🆕 **F1 — Restrict drivers with RESTRICTIVE policies (D9).** Existing `*_select`/`dpw_select` are PERMISSIVE, so a driver can already read all org fleet data *and* the full performance leaderboard, and adding a scoped SELECT only *broadens*. Use a **RESTRICTIVE** policy `USING (auth_role() <> 'driver' OR <owned>)` on `fuel_transactions`, `vehicles`, `drivers`, `driver_performance_weeks` to tighten drivers **without** touching manager access. → Phase 1 §12.4 and Phase 4 §15.3 adopt RESTRICTIVE policies.
- 🆕 **F-matrix — the RLS test loads a curated migration subset** (`rls.test.mjs:73-91`, not all 82). Every new driver migration (0083/0084/…) must be **added to that array** or it's never exercised. → added to each phase's exit criteria.
- ✅ No Supabase-level domain block (`before_user_created` hook is commented out; `generateLink` uses the admin API), so relaxing the app checks is sufficient at the Supabase layer. `enable_confirmations=false` → invited drivers can sign in immediately.
- 🆕 Ensure `VITE_DEV_BYPASS`/any dev-bypass is **off** in driver builds (it forges an admin session client-side).

**Build / toolchain**

- ✅ `@fuelguard/shared` is pure TS (only dep zod 4.4.3), no Node/browser/Vue. ✏️ **but** it uses `Intl.DateTimeFormat`+`formatToParts` in `efsImport/dateTime.ts`, `driverPerformance/weekWindow.ts`, `anomalyRules/helpers.ts` — some **without a UTC fallback**. Android Hermes has historically weak ICU; **verify tz formatting on a physical Android build** and add fallbacks if needed. (Only relevant if the app imports those modules.)
- ✏️ **Version pins corrected** (see §20.3). The plan's "Expo SDK 54 / RN 0.76" was a mismatched pair.
- 🆕 **F5 — ESLint & lint scripts:** root `eslint .` will lint `apps/driver/**/*.tsx` but has no React/RN plugins and RN globals aren't declared — add an `apps/driver/**` block. `check-file-size.mjs` scans `apps/driver` but matches only `.ts/.vue`, so **`.tsx` escapes the 500-line budget** (add `.tsx` if enforcement wanted). `check-feature-boundaries.mjs` and `check-token-parity.mjs` don't touch the driver app. The web token linter is Vue/CSS-shaped — a NativeWind variant is **new work** (scan `.tsx`, match `className`, handle `style={{}}`).
- 🆕 **F6 — NativeWind does not enforce tokens** (arbitrary values like `text-[#f00]` compile). Token discipline must be enforced by the **custom RN token linter + an ESLint rule banning arbitrary-value classes** (or by stripping the default palette). The linter is therefore essential, not optional.
- 🆕 `apps/driver` scripts must cooperate with `pnpm -r`: `build`=`expo export`/`tsc --noEmit` (never `expo start`), `typecheck`=`tsc --noEmit`; keep `dev` out of `pnpm -r --parallel` (Metro TTY) or accept noise. Audit driver deps for postinstall scripts → add to `pnpm.onlyBuiltDependencies`.

**Capture / storage / scoring / performance**

- ✏️ **F3 — `computeFillUpWarnings` real signature** is `({ gallons, odometer, tankCapacityGal, lastOdometer, fuelType })`, not `(input, vehicle)`. `fuelTxnStatus` takes a `Pick<FuelTransaction, 'has_anomaly'|'max_severity'|'samsara_location_confidence'>`. → §14.4 corrected.
- ✅ Insert columns confirmed; **NOT NULL with no default:** `org_id`, `fueled_at`, `gallons` (must be supplied). No INSERT trigger (→ B5).
- ⚠️ **F4 — Storage (SUPERSEDED by §21 SB2).** Functionally, `receipts` policies (`0005_storage.sql`) are org-scoped + role-agnostic, so a driver JWT *can* already upload — which is why Round 1 said "no migration needed." **The security audit reverses this:** org-scoped + `upsert:true` means a driver could read/overwrite/**delete** another driver's or a manager's receipt (evidence tampering) and upload oversized/malicious files. So a **driver-scoped storage migration `0085` IS required** (path includes `driver_id`, size/mime limits, no driver upsert, signed-URL reads). See §21 SB2 / D13. A private-bucket `createSignedUrl` read path is still needed either way.
- ✏️ **F-WebP** — `expo-image-manipulator` **≥12.0.1 does output WebP on both iOS and Android** (contradicts an early "JPEG/PNG only" reading). Pin ≥12.0.1 and use the new `manipulate().renderAsync().saveAsync()` API (`manipulateAsync` deprecated). (O8)
- ✏️ **F-MPG (O9)** — per-fill MPG is **server-derived** (`computed_mpg`, written by the scoring engine), not computed on the web. RN should **display the server value** (null until scored), not recompute. `fuelTxnStatus` is pure and reusable.
- ✅ `/api/me` exists only as a bare `GET` (not a router); mounting `app.use('/api/me', meRouter())` for `/driver`/`/fillups`/`/performance` is conflict-free (reconcile the existing inline `GET /api/me` if reusing `/`).
- ✅ `driver_performance_weeks` (0055) + `combineWeek`/`rankTrailing` + `DEFAULT_PERFORMANCE_SETTINGS` (safety .5 / eff .25 / idling .25) all confirmed. Its RLS is currently **member-read** (drivers can read the whole org leaderboard) → tighten via D9/F1.
- 🆕 **F7 — `scoreWithCascade` side effects:** it re-scores sibling fills for the vehicle **and** best-effort emails managers on high/critical (`notifyForTransaction`). Confirm this cascade scope is intended for driver-triggered scoring and decide whether to suppress the emails.
- 🆕 **F8 — `fueled_at` tz:** web does `new Date(localDatetime).toISOString()` (device-local → UTC). The RN datetime picker must produce the same correct UTC ISO string.

### §20.3 Version pin sheet (verified July 2026)

Expo **SDK 57** (RN 0.86, React 19.2 — **New Architecture mandatory** since SDK 55; audit every native
dep for New-Arch support) · Node 22 LTS · TypeScript 6.0.3 (spike-verify against NativeWind's typings;
be ready to use a driver-local TS 5.x if the ambient `.d.ts` augmentation breaks) · **NativeWind 4.x** +
**tailwindcss 3.4.17** (NativeWind v5/Tailwind v4 is pre-release — avoid) · @supabase/supabase-js 2.x
(AsyncStorage adapter + `processLock`) · @tanstack/react-query 5.x (+ persist-client +
async-storage-persister; `onlineManager`↔NetInfo, `focusManager`↔AppState) · zod 4.4.3 (Metro
package-exports workaround; zod 3.x fallback) · expo-image-manipulator ≥12.0.1 (WebP) ·
@maplibre/maplibre-react-native 11.x (New-Arch, needs a vector-tile host — O10) · expo-sqlite (SDK-bundled).

### §20.4 Confirmed-good (the plan can rely on these)

Supabase auth model + JWKS verify; `role='driver'` is a first-class enum already accepted by the invite
flow; **drivers can already `insert` fuel_transactions and upload receipts under existing RLS**;
`scoreWithCascade`, `combineWeek`, `rankTrailing`, `fuelTxnStatus`, `derivePricePerGal`,
`DEFAULT_PERFORMANCE_SETTINGS`, `PAYMENT_METHODS` all present and reusable; `apiFetch` Bearer/envelope
contract is portable; native `fetch` isn't subject to CORS; the offline outbox design is a sound 2026
pattern (client-UUID idempotency is the right backbone) — provided it keeps FIFO ordering, backoff +
dead-letter, and ack-before-delete.

### §20.5 What changed in this plan as a result

Added decisions **D6–D9** and open items **O7–O10**; corrected the token-storage design (§12.5),
the `computeFillUpWarnings` signature (§14.4), and version pins (§9); dropped the unnecessary
`0085` storage migration and added a signed-URL receipt-read path + RESTRICTIVE RLS to §12.4/§14.5/§16;
elevated the hook-enablement to blocker **B1**; added "register the migration in `rls.test.mjs`" and
"device tz/Hermes check" to phase exit criteria. **Net:** the plan is now assumption-free to the limit
of what code review can establish; the residual unknowns (B1 hook state, B2/B3/B6 build spike) are
explicitly the first tasks of Phase 0.

---

## §21. Audit Round 2 — Security Findings & Resolutions

> Three security passes (backend/RLS/storage, mobile client, identity lifecycle) reviewed the plan and
> the code it touches under the threat model of **a malicious or compromised low-privilege driver holding
> a valid org JWT + the public anon key**. Findings, severities, and resolutions below. **§21 governs
> over §20 on security matters.** The overriding principle it establishes: **the database (RLS + storage
> policies) is the authorization boundary — not the API endpoints, not the web UI.** A driver ships the
> exact credentials to call PostgREST/Storage directly, so anything guarded only at the endpoint or the
> UI is effectively unguarded.

### §21.1 Security blockers to clear before build

| ID | Sev | Blocker | Resolution (decision) |
|----|-----|---------|-----------------------|
| **SB1** | Critical | **Attribution forgery / IDOR via raw PostgREST.** `ftxn_insert` checks only `org_id`+role, so a driver can POST directly to `/rest/v1/fuel_transactions` (bypassing `/api/me/fillups`) forging `driver_id`/`vehicle_id`/`source`/`entered_by`. | **D9/D10:** RESTRICTIVE **INSERT** policy binding `driver_id=auth_driver_id()`, `vehicle_id∈assigned`, `source='manual'`, `entered_by=auth.uid()`; raw-PostgREST deny tests. Endpoint hardening (narrow Zod, server-derived identity) on top. |
| **SB2** | High | **Receipt tampering + unrestricted upload.** `receipts` bucket is org-scoped only, `upsert:true`, no size/mime cap → a driver can read/overwrite/**delete** others' receipts and upload huge/malicious files. **Reverses §20 F4.** | **D13:** driver-scoped path `${org}/${driverId}/${id}`, per-op policies on `split_part(name,'/',2)=auth_driver_id()`, `file_size_limit`+`allowed_mime_types`, no driver `upsert`, signed-URL reads (migration `0085`). |
| **SB3** | Critical | **Broad org-wide SELECT.** Existing `*_select` policies let any member (a driver) read the whole fleet + all driver PII + anomalies via PostgREST; adding a *permissive* driver policy does nothing. | **D9:** RESTRICTIVE SELECT scoping for the `driver` role across `drivers/vehicles/fuel_transactions/anomalies/memberships/thresholds/driver_performance_weeks`; allow+deny matrix incl. raw-PostgREST. Hard prerequisite of Phase 1. |
| **SB4** | Critical | **Plaintext auth tokens at rest.** Plan used AsyncStorage (unencrypted) → device theft/backup/root leaks the refresh token = durable takeover. | **D6 (upgraded to REQUIRED):** `LargeSecureStore` (AES-256 key in SecureStore, ciphertext in AsyncStorage); refresh rotation + reuse detection; secure global logout + local wipe. |
| **SB5** | High | **Deep-link hijacking.** `fuelguard://` custom scheme for invite/set-password can be squatted → auth-code/token interception. | **D11:** PKCE flow + verified App Links/Universal Links; one-time `?code=` exchanged with the local verifier; never log link/token. |
| **SB6** | Critical | **Invite/account takeover.** Domain relaxation (D1) + `enable_confirmations=false` + open signup + accept-authorizes-by-email (invite token unused) → an attacker who knows a driver's personal email can self-register and accept the invite first. | **D15:** enforce the invite `token` in `POST /invites/accept` (server-verified secret) and/or require email confirmation for the driver flow; keep admin-only + pre-created `driver_id` compensating controls. |

Plus **required-before-launch config** (D16): HIBP leaked-password protection on, `minimum_password_length ≥ 10` + complexity, captcha on sign-in/sign-up, app-level lockout, confirm production MFA is enabled for platform admins.

### §21.2 High/medium findings folded into phases

- **Offboarding (High, D14):** `drivers.status` is inert and membership-delete doesn't revoke live sessions → a fired driver keeps access until token expiry; the new `drivers.user_id` FK (no on-delete) also blocks `deleteUser`. → `revokeDriverAccess()` action + `on delete set null` + lower driver `jwt_expiry`/timebox (Phase 1, §12.4).
- **Rate-limit / spam-DoS (Medium, O14):** `/api/me/*` would sit under only the global per-IP limiter; a driver spamming fills drives DB growth, scoring load, and manager-email floods. → per-`sub` limiter + daily fill cap + email debounce (Phase 3, §14.7).
- **Mass-assignment (Medium, SB1-adjacent):** `/api/me/fillups` must use a narrow Zod input and server-derive identity fields — never spread the client body (Phase 3, §14.7).
- **Audit logging (Low-Med):** no audit trigger on `fuel_transactions`; add one + audit the `drivers.user_id` link and invite accept (Phase 1).
- **Encrypted outbox + EXIF (High/Med, D12):** SQLCipher-encrypted outbox; strip EXIF (re-encode) before receipts touch disk/upload; delete staged files on sync (Phases 2–3).
- **Offline/device hygiene (Low-Med):** background-snapshot masking + screenshot block on the invite/password/PII screens (`expo-screen-capture`); `secureTextEntry` + no autofill cache on the password field; HTTPS-only (assert no cleartext, ATS on); least-privilege permissions (camera + while-in-use location, **no background location**, scoped photos); prod builds with remote debugging off and **EAS Update code-signing** if OTA is used; dependency audit of the New-Arch native set.
- **Multi-org (Low, O-multi):** the token hook pins a user to the earliest membership; enforce one-user-one-org for drivers (reject a driver invite whose email already has a membership elsewhere) or make org selection explicit.

### §21.3 Confirmed-good (keep as-is)

JWT claims are server-injected from `memberships` and unforgeable; tenant isolation (`org_id=auth_org_id()` with-check) holds — all driver risk is **intra-tenant**; service-role key is server-only (never bundled) and callers ownership-check before service-role writes; Supabase calls are parameterized; the **platform-admin plane is well isolated** (separate `admin-api`, `platform_admins`, AAL2/MFA, time-boxed audited impersonation) and drivers cannot reach it. Anon key in the bundle is safe **because RLS is the boundary** — which is exactly why SB1–SB3 must be fixed.

### §21.4 Pragmatism note (don't over-engineer)

Right-sized for a moderate-sensitivity driver app: encrypted token store, PKCE + verified links,
encrypted outbox, EXIF stripping, RLS-as-boundary, background masking + screenshot block on 2–3 screens,
least-privilege permissions, OTA signing. **Optional/judgment:** certificate (public-key) pinning — good
against fleet-device MitM but adds rotation-outage risk; adopt only with a backup pin + documented runbook
(O13). **Skip unless compliance forces it:** root/jailbreak detection, code obfuscation/anti-tamper,
runtime attestation, full-filesystem encryption — high fragility, low marginal value once storage is
encrypted and the server enforces RLS.

### §21.5 What changed in this plan as a result

Upgraded **D6** to required-encrypted storage; added decisions **D10–D16** and open items **O11–O14**;
added **RESTRICTIVE INSERT** scoping + a `fuel_transactions` audit trigger + raw-PostgREST deny tests to
§12.4; **reversed §20 F4** — re-added the driver-scoped storage migration `0085` (§14.5/§16); added
offboarding (`revokeDriverAccess`, FK on-delete, shorter `jwt_expiry`) and invite-token-enforced accept
to Phase 1; added PKCE + verified links + secure logout to §12.5; encrypted outbox + EXIF stripping to
Phases 2–3; per-user rate limits + narrow-input/server-derived identity + audit to §14.7; and a
pre-launch auth-hardening config gate (D16). **Net:** the plan's security model is now explicit
(DB-as-boundary), the invite-relaxation and receipt-storage holes the driver app would have opened are
closed by design, and the residual items are config toggles + the Phase-0/1 implementation of these
policies.

---

## §22. Audit Round 3 — UX & Interaction Design

> Two research passes (modern RN design/motion/a11y; driver-app IA/interaction patterns) plus a critical
> review of the planned screens. Verdict from the review: the plan had a **strong design *system* and the
> right principles, but specified "the paint, not the rooms"** — no navigation shell, screen states named
> but not designed, and everyday flows (first-run, permissions, no/multi-vehicle, correction, logout)
> missing. This section closes those gaps and modernizes the UX. **§22 governs over earlier UX statements.**
> Grounded in Samsara Driver / Motive / DoorDash Dasher / Trucker Path patterns, NHTSA distraction
> guidance, WCAG 2.2, and the 2026 Expo/RN ecosystem.

### §22.1 Navigation shell & information architecture (D17, re-decided by **D51**)

> **This section was stale and is rewritten.** It previously described the fuel-era bar
> (`Home · Fuel Log · (center) Log Fill-Up · My Score · More`) and a route tree full of `fuel-log/`
> and `log-fuel.tsx`. **D41** retargeted the app away from fuel capture and the section was never
> updated, so the built shell already contradicted the doc a fresh session would follow. Corrected
> here, together with the D51 decisions on tabs, the top bar, and where Hazmat lives.

**The shape.** Four bottom tabs, a reserved center slot, and two top-bar icons:

```
┌────────────────────────────────────────────────────┐
│  ☰ Home                        ✉ 3   🔔 5    (MJ)  │  ← top bar: Messages · Notifications · avatar
├────────────────────────────────────────────────────┤
│  On duty · Unit 214 · Trailer 5521 · since 06:12   │
│  Current load · next stop · sync state             │
└────────────────────────────────────────────────────┘
 ┌────────┬────────┬ ─ ─ ─ ─ ┬─────────┬─────────┐
 │  Home  │ Loads  │ ┆ ( ) ┆ │  Score  │  More   │
 │   ⌂    │   🚛   │ ┆reserv┆ │    ⚡   │   ⋯     │
 └────────┴────────┴ ─ ─ ─ ─ ┴─────────┴─────────┘
              reserved for Navigation (D52 — separate program)
```

**Why this and not the six-destination bar.** A driver's bar should hold the things they open
*without a reason* — the places they go to find out what to do. Everything they open *because
something happened* belongs in the top bar or in context. That split decides every slot below.

| Slot | Decision | Reasoning |
|---|---|---|
| **Home** | Tab | The glance surface: duty card, current load, next stop, sync state. First thing opened, every time. |
| **Loads** | Tab | The daily job. Upcoming · Current · Previous. **Labelled "Loads", not "Assignments"** — it is the word drivers use, every comparable app (JB Hunt, Convoy, Uber Freight) uses it, and it fits the 11px tab label without truncating where "Assignments" does not. The *dispatch* side keeps the fuller name; the page header reads **Assignments**. One word to reverse if you disagree. |
| **Score** | Tab | Performance is a habit surface — drivers check their standing repeatedly, unprompted, and that is exactly what makes a scoring programme change behaviour. It earns a permanent slot. |
| **More** | Tab | The growth valve: Settings, profile, Training, HazmatGuard reference, support, app version. New surfaces land here first and are promoted only once daily use proves it. |
| **Navigation** | **Reserved center slot, not rendered yet** | Deferred to its own programme (**D52**). The slot is designed in now because *deciding the bar later is the redesign we are avoiding* — when navigation lands it becomes the elevated center action, launched from an accepted load, which is how a driver actually starts driving. Until then the bar renders four tabs, evenly spaced, with no gap or dead button. |
| **Messages** | **Top bar icon** + full page | Conversational and interrupt-driven. A tab would sit unread-badged and idle most of the day; the top bar puts the badge where the eye already goes without spending a permanent slot. |
| **Notifications** | **Top bar icon** + full page | Same reasoning. Bell with an unread count; the page is the in-app centre that mirrors what push delivered. |
| **Hazmat** | **A step inside the load flow**, plus a reference entry under More | Hazmat is not a place a driver goes — it is something a *load* requires. It appears automatically as a required step when `loads.hazmat = true`, which is the only moment the documentation is correct and complete. A permanent tab would be dead weight on ~95% of loads and, worse, would invite hazmat paperwork detached from the load it belongs to — the precise failure the compliance plan exists to prevent. The reference material (placard lookup, shipping-paper rules) lives under **More**, entitlement-gated (**D55**). |

**Rules that keep it stable.** Cap the bar at five items including the reserved center. Anything new
enters through **More** and is promoted only on evidence of daily use. Contextual work — per-stop photo
capture, the hazmat step, the duty check-in sheet — is a **modal route over the shell**, never a tab, so
it focuses the task and covers the bar during entry.

**Top bar.** Present on every tab root: screen title on the left; **Messages** (envelope + unread
count), **Notifications** (bell + unread count), and the **avatar** (→ Settings) on the right. Badges
are driven by the same cached counts the Notifications and Messages modules maintain, so they are
correct offline and never block a render on the network. Both icons carry ≥48pt touch targets and
`accessibilityValue` announcing the unread count.

**expo-router structure (route groups):**

```
app/
  _layout.tsx                  root Stack; declares groups + modal routes; auth/onboarding guards
  (auth)/                      sign-in, accept-invite/set-password (PKCE), account-pending, wrong-app
  (onboarding)/                welcome + just-in-time permission priming (camera, location, notifications)
  (tabs)/
    _layout.tsx                <Tabs> shell (Home · Loads · Score · More) + reserved center slot
    home.tsx                   Home — duty card, current load, week snapshot
    loads.tsx                  Assignments: Upcoming · Current · Previous
    score.tsx                  My Score (Phase 5)
    more.tsx                   Settings, Training, HazmatGuard reference, support
  loads/[id].tsx               load detail
  loads/[id]/stop/[stopId].tsx presentation:'modal' — guided per-stop photo capture
  loads/[id]/hazmat.tsx        presentation:'modal' — the hazmat step (entitlement-gated, D55)
  duty/check-in.tsx            presentation:'modal' — truck + trailer confirm / swap (D44)
  notifications/index.tsx      the notification centre (top-bar bell)
  messages/index.tsx           thread list (top-bar envelope)
  messages/[threadId].tsx      one conversation
  settings.tsx                 presentation:'modal' (from the top-bar avatar)
  gallery.tsx                  component gallery (dev only)
```

Use `Stack.Protected`/guards for auth + role. Settings hangs off the top-bar avatar, not a tab.

**What changes in the built shell.** `apps/driver/app/(tabs)/_layout.tsx` today renders
`Home · Loads · (center) Navigate · My Score · More`, where the center tab is a stub that redirects to
`/drive`. Phase 3C removes the live center action (navigation is D52) while keeping the slot in the
layout, and adds the top bar. `navigate.tsx` and `drive.tsx` stay in the tree as the seam the
navigation programme picks up.

### §22.2 Modern UX library stack (D18 — pin at `npx expo install`)

| Purpose | Library | Pin |
|---|---|---|
| Animation (native-thread) | `react-native-reanimated` | `~4.5` (New-Arch only) + `react-native-worklets ~0.10` |
| Gestures | `react-native-gesture-handler` | `~2.32` |
| List (fuel log) | `@shopify/flash-list` | `~2.3` (v2, New-Arch; no `estimatedItemSize`) |
| Bottom sheet / confirm | `@gorhom/bottom-sheet` `~5` (locked) | wrap in `GestureHandlerRootView`; used for the vehicle picker + tokenized over-capacity confirm |
| Forms | `react-hook-form ~7` + `@hookform/resolvers` (zod) | reuse the shared Zod schemas |
| Keyboard | `react-native-keyboard-controller ~1` | sticky submit above keyboard; native-synced |
| Haptics | `expo-haptics` | SDK-bundled |
| Icons | `lucide-react-native` (+ `expo-symbols` on iOS) | one set, consistent heavier weight |
| Typeface | one variable font via `expo-font` | tabular numerals (O16) |
| Token pipeline | `style-dictionary ~4` | emit OKLCH ramps → NativeWind/TS, light+dark in sync |
| Custom visuals (gauge/sparkline only) | `@shopify/react-native-skia ~2` | sparingly; not for layout |

**Micro-interaction doctrine:** 120–200ms ease-out for UI chrome; springs only for physical drag (sheets,
swipe). Press = scale ~0.97 + subtle opacity ~100ms. Success = a single quick checkmark, never confetti.
Fast > flashy — a driver taps this 40×/day.

### §22.3 Full component set (two tiers — Phase 0 builds all)

**Primitives:** Button, Input, **NumericField** (large value display + unit suffix), Field, Card, Badge,
StatTile, Screen, **TabBar**, **Sheet/Modal**, **Toast/Snackbar**, **ListRow**, **Skeleton**,
**Banner/InlineNotice**, **SegmentedControl**, **Picker/Select**, **DateTimeField**, **Avatar**, **EmptyState**.

**Compositions:** **OfflineBanner**, **SyncStatus**, **PendingBadge**, **VehicleCard** (+ no-vehicle &
multi-vehicle variants), **FillRow** (date · gallons · odometer · MPG · $/gal · status badge),
**WarningLadder** (inline caution → banner → confirm sheet), **ReceiptThumbnail + ReceiptViewer**,
**ScoreGauge** (weighted safety .50 / eff .25 / idling .25), **PermissionPrimer**, **CoachingCard**.

Every one renders in the Phase-0 gallery in light + dark + large-type + reduce-motion (token + a11y audit).

### §22.4 Core interactions

- **Numeric entry (the app's #1 interaction, D18/O15):** a large tap target showing a **big tabular
  live value** with a unit suffix ("gal", "mi"); native `decimal-pad` by default (accessible, fast),
  `react-native-keyboard-controller` sticky "Save" above the keyboard, auto-advance (`returnKeyType:next`).
  Evaluate a big glove-friendly **custom keypad** for the primary field only if field-testing shows need.
  Pre-fill everything possible (vehicle, odometer estimate, station via GPS, now) so the driver **confirms,
  not types**.
- **Warning ladder (D19):** inline field-level caution (amber, icon+label) → a summary **Banner** → a
  blocking **confirm Sheet** (danger, tokenized — replaces the native `Alert.alert`) for over-capacity.
  `computeFillUpWarnings` drives all three; every state is icon+label, never color alone.
- **Success moment (D20):** on save → `Haptics.notificationAsync(Success)` + an instant optimistic insert
  into Fuel Log + a brief "Saved — will sync" confirmation with a short **undo** window, then return to
  Home. Works identically offline (no "sent" language until synced).
- **Motion + haptics tokens (D20):** durations `{fast:120, base:180, slow:240}`, one ease-out curve;
  Reanimated `entering`/`layout` for list inserts and screen content; haptic map (Success=save,
  Warning=over-capacity confirm, Error=validation fail, Selection=picker/segment tick, Light=primary CTA).
  Reduce-motion → swap for opacity/instant.

### §22.5 Per-screen state matrix (states are the product)

Every screen specifies **loading · empty · error · offline · success · syncing**. Standards:

- **Loading = skeletons, not spinners** (cached-first; first paint is cached data — §13.2).
- **Empty teaches the next action** ("No fill-ups yet — tap ⛽+ to log your first, ~30s").
- **Offline is normal, not an error** — reassuring banner + per-item chips.
- **Error is blameless + recoverable** — keep the data, say what to fix.
- **Sync states per item:** Pending / Syncing / Synced / Failed (color **+ label**), with a "Tap to retry".

### §22.6 Everyday flows the earlier drafts missed

- **First-run / onboarding:** after set-password → 1–2 orientation screens ("here's your truck, log a
  fill in 30s") → **just-in-time permission priming** (a value-explaining screen *before* each OS dialog:
  camera at first receipt, location when auto-detecting a station, notifications when a reminder is first
  relevant) + a graceful **denied-permission recovery** path. Never cold-hit the OS prompt.
- **Equipment check-in (rewritten by D43/D44 — this bullet's original form assumed a static assigned
  truck and is superseded):** Home's no-session state is **Start your day**, not "contact your manager".
  The picker is a bottom sheet over the driver's *whole* selectable fleet — their `assigned_driver_id`
  unit pinned as **Your truck**, last-used next — with the trailer picker offering **Bobtail / not
  hooked yet** as a first-class choice, and a **409 take-over** state when a truck is already held.
  Changing either mid-shift is the same sheet in `mode='swap'`, reachable in ≤2 taps from Home *and*
  from inside the stop flow. Full spec in §14.4/§14.8.
- **Fill correction (D21):** pending items editable/deletable (swipe or detail action); synced items
  read-only with an explained lock. Never a dead-end.
- **Receipt viewer/retake:** pre-submit retake/remove; full-screen pinch-zoom viewer from any thumbnail.
- **Settings/Profile (new, off Home avatar):** identity ("signed in as"), **night-mode toggle** (the
  manual override §11.3 assumes), sync status, permission shortcuts, **logout** (+ confirm), app version/support.
- **Account-pending & wrong-app:** real copy + a next step (pending: "your manager is finishing setup";
  wrong-app: redirect to the correct app).
- **Back-dating & timezone (§20 F8):** show the resolved **local** date/time as an editable human chip;
  "now" is one tap; back-dating is explicit; the UTC conversion is correct so MPG isn't corrupted.
- **In-motion safety (O17):** treat capture as a **parked task** — gate/limit entry when motion is
  detected; in-motion surfaces stay glanceable read-only (NHTSA ≤2s glance, no manual text entry in motion).

### §22.7 Accessibility spec (D22, WCAG 2.2 AA)

Verified contrast ratios in **both** light and dark role maps (≥4.5:1 text, ≥3:1 large/UI — and *well
above* for sunlight); ≥48pt primary targets (glove) audited by the token linter; `accessibilityRole`/
`Label`/`Value`/`State` on every control and metric (a gauge announces "42.3 miles per gallon");
`allowFontScaling` on with reflowing layouts up to large sizes; **reduced-motion** variants via
`useReducedMotion`; **live-region announcements** for offline/sync/save so screen-reader users hear state
changes; focus management on route change; VoiceOver/TalkBack tested each phase.

### §22.8 Visual identity & anti-slop (D23)

One intentional **variable typeface** (bundled via expo-font) with strong **tabular numerals**; the fuel
numbers are the hero — **big tabular hero numerals (36–56pt)** are the app's signature ("instrument," not
"template"). One icon set (lucide) at a consistent slightly-heavier weight. Palette drawn from
fuel/logistics/steel, **not indigo** (the loudest AI tell). Elevation via subtle surface tints, not
decorative shadows/blur/glass. **Night theme** on a near-black neutral (~#0A0C0E, not pure #000 — reduces
OLED halation), grayscale + opacity tiers for hierarchy with one accent used sparingly (Google *Design for
Driving*); **day/sunlight theme** high-contrast with bolder numerals; auto by `useColorScheme` + a manual
override (drivers know their cab). **Banned:** indigo→purple gradients, decorative glass/blur, gradient
text, three-identical-rounded-cards, unchosen Inter, weightless copy.

### §22.9 Microcopy & tone

Plain, reassuring, blue-collar-friendly. Buttons are concrete verbs ("Log fill-up", "Save", "Scan
receipt", "Sync now" — not "Submit"). Errors are blameless + actionable ("Odometer looks lower than last
time (48,210) — double-check the number"). Offline copy reassures ("Saved — we'll sync when you're back
online. Your entries are safe on this phone."). Empty states teach. Success is quick and warm ("Fill-up
saved ✓"). Read every string as if said out loud in a truck cab.

### §22.10 Screen-by-screen refinements

- **Home:** no-vehicle & multi-vehicle vehicle-card variants; skeletons (not spinners); a persistent
  glanceable sync/offline header chip (live-region); a My Score entry + a reserved "My Plan" slot without
  becoming a dashboard (one primary action stays sacred); a teaching empty state for the brand-new driver.
- **Capture:** tokenized over-capacity confirm sheet (not native Alert); the large numeric-entry pattern;
  permission priming before first camera/location; the success moment (haptic + queued + undo + return);
  pre-submit receipt retake/remove/zoom; explicit safe back-dating.
- **Fuel Log:** FillRow anatomy as a reusable ListRow on **FlashList v2**; loading (skeleton rows)/empty/
  error/offline states; pending items correctable; a segmented + date-sheet filter UI; thumbnail→viewer.
- **My Performance:** a **ScoreGauge** showing the weighted three-part score (not three bare numbers); a
  first-class **ineligible-week** explanatory state; a friendly **CoachingCard**; an empty first-week state.
- **Auth/first-run:** designed account-pending & wrong-app screens; a welcome/orientation step; sign-in
  with show-password + inline errors + keyboard avoidance + the screenshot-block/background-mask (§21) as a
  visible-but-unobtrusive treatment; logout in Settings with confirm.

### §22.11 Phase impact / what changed

- **Phase 0** now also stands up the **navigation shell** (tab bar + center capture) and builds the
  **full two-tier component set** in the gallery (§22.3) — not just the primitive subset.
- **Phase 1** adds the **first-run/onboarding + permission-priming** flow and the designed **account-pending
  / wrong-app / Settings(logout, night-mode toggle)** screens.
- **Phase 2** Home gains the no-vehicle/multi-vehicle states, skeletons, and the glanceable sync chip.
- **Phase 3** capture adopts the numeric-entry pattern, tokenized warning ladder, success moment,
  permission priming, receipt viewer, safe back-dating, and in-motion gating; adds **fill correction**.
- **Phase 4** Fuel Log uses FlashList v2 + FillRow + full state matrix + correction; Performance uses the
  ScoreGauge + ineligible/empty states + CoachingCard.
- Added decisions **D17–D23**, open items **O15–O17**, and the UX library pins (§22.2). Every new component
  and state is added to the relevant phase's exit criteria and the Phase-0 gallery/a11y audit. **Net:** the
  plan now specifies the *product* (rooms + flows + interactions), not just the design system (paint).

---

## §23. Audit Round 4 — Backend↔Frontend Contract, Store Compliance & Type Safety

> Three audits: the API/data-layer contract (precise · reliable · fast), Apple/Google store compliance
> (zero-rejection), and enterprise-grade 100% type safety. Findings + resolutions below; **§23 governs
> over earlier statements on these topics.** It adds two **store-submission gates (CG1–CG2)** to do
> before the app is uploaded.

### §23.1 New gates & the two factual corrections

- **CG1 — In-app account deletion** (Apple 5.1.1(v) + Google) is **mandatory** and must ship before
  submission: `POST /api/me/delete-account` + a Settings control + a web deletion URL (D26). Invite-only
  is not exempt.
- **CG2 — Reviewer demo account** (O20): an invite-only app **auto-rejects** without working demo
  credentials + a live backend; seed one and put it in App Review Info / Play App access.
- **Correction 1 (F3):** the plan said the web Fuel Log is keyset-paginated — it is **offset**
  (`.range()` + `count:'exact'`). The driver log uses **true keyset** instead (fixed in §15.2).
- **Correction 2 (F5 / D30):** there are **two** driver↔vehicle assignment models in the DB
  (`vehicles.assigned_driver_id` column and the `driver_vehicle_assignments` table, `0051`); the plan
  used only the column. Reconcile to one authoritative model before Phase 1 RLS.

### §23.2 Backend↔frontend: precise, reliable, fast

**Precision — the typed contract (D24).** Today `packages/shared/apiContract.ts` defines response
schemas that are **never used**, and the web client casts `payload as T` (no runtime validation). Fix:
add `packages/shared/src/driverContract.ts` with **request + response** Zod for `/api/me/driver`,
`/api/me/fillups`, `/api/me/performance` (requests **exclude** server-derived `org_id`/`driver_id`/
`entered_by`/`source` — §21 SB1); the **client parses every response** (extend `apiFetch` to take a
schema; `safeParse` → fail-closed; on drift return a typed `contract_drift` error and **never**
cache/enqueue it); **also parse direct-PostgREST rows** with the same allow-listed schema before caching
(closes the "API validated, direct reads not" asymmetry); the **server** parses outbound payloads in
dev/test via `respond(res, schema, data)`, guarded by a **contract-drift CI test**; and CI runs
`supabase gen types typescript` (drift-checked) so direct-read schemas stay a subset of real tables.

**Reliability.** Shared typed `apiErrorCode` enum + retry policy keyed on code+method: GETs and the
idempotent `POST /me/fillups` (client-UUID PK) retry with exp-backoff+jitter; `401`→refresh-once;
`409`→refetch (no blind retry); `429`→honor `Retry-After`; `4xx invalid/not_assigned`→**permanent,
dead-letter** to "Needs attention"; `5xx`/network→retry. Add `AbortController` **timeouts** (~10s reads,
~30s uploads — RN `fetch` has none). **Offline-boot session** (F9): gate reads on the cached session and
**never sign-out on a refresh network error** (an app launched in airplane mode must not log the driver
out). **Partial-failure compensation** (F12): idempotent server upsert on the client `id`; tolerate a
re-declared `receipt_path`; handle orphan receipts. v1 fills are read-after-sync (D21) → no
edit-concurrency yet; reserve a `version` column for the future correction flow.

**Performance / fast.** Keyset (not offset) fuel log; column allow-lists (the Zod object *is* the
allow-list; never `select('*')`); **parallelize the launch bootstrap** (session → then `me/driver` +
`vehicles` + first fills page concurrently, **or** one `/api/me/driver` bootstrap payload returning
driver + vehicles + first page — kills the waterfall and the cold-start tax on N requests); **decouple
`scoreWithCascade` from the client ack** (insert → respond → score async; score lands on next refetch) +
a Railway **keep-warm** ping; **no Realtime in v1** (confirmed — pull-on-focus via `focusManager` is
enough); add index `vehicles(org_id, assigned_driver_id) where assigned_driver_id is not null` (F4).
Receipt sizing (~200KB WebP / 1600px) is verified sound.

**Observability (F8).** Sentry (api + app) tagged by endpoint + `sub`; a distinct **`contract_drift`**
event on any response parse failure; keep `/healthz` + a build/version stamp so the app can detect a
contract-incompatible server.

### §23.3 Store compliance (Apple + Google, zero-rejection)

**Distribution (D25):** **Apple Custom Apps via Apple Business Manager** *skips App Review entirely*
(strongest zero-rejection posture; Unlisted is the review-required fallback). **Google Managed Play
private app** (org-scoped) — but Google **still runs policy review** on private apps, so everything below
applies on Android regardless.

**Account & login:** in-app **account deletion is mandatory** (CG1/D26) — server-side identity deletion,
not deactivate/email-only; retain fuel records per employer recordkeeping (disclosed); Google needs a
**web deletion URL**. **Sign in with Apple NOT required** (triggered only by third-party/social login;
this app's own email/password + enterprise exemptions apply — **do not add it**). **ATT NOT needed** (no
cross-app tracking; set `NSPrivacyTracking=false`; adding an unused ATT/AdSupport framework can itself
cause rejection).

**Privacy & permissions (D27):** **Apple Privacy Manifest** (`expo.ios.privacyManifests`) declaring
required-reason API categories used by RN libs — UserDefaults `CA92.1`, FileTimestamp `C617.1`, DiskSpace
`E174.1`, SystemBootTime `35F9.1` (verify against `node_modules/*/ios/PrivacyInfo.xcprivacy`); nutrition
labels (Precise Location / Photos / Email / User-ID → **App Functionality, not tracking**); specific iOS
usage strings (`NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, photo-library keys only
if used), **no** background-location key, **no** `UIBackgroundModes`. **Android:** foreground fine/coarse
location only (+ **prominent in-app disclosure before the prompt**); **no** `ACCESS_BACKGROUND_LOCATION`,
**no** broad `READ_MEDIA_*` (use the system **Photo Picker** + `expo-camera`); `POST_NOTIFICATIONS`
contextually; **audit the merged manifest** for stray foreground services; `expo.android.blockedPermissions`
to strip transitive perms. **Both:** privacy-policy URL (O19); Google **Data-safety** must **match** the
permissions actually requested. **Encryption export:** `expo.ios.config.usesNonExemptEncryption:false`.

**Functionality:** private Custom App distribution neutralizes the 4.2/4.3 "thin internal app" risk; keep
metadata accurate (don't show v5 maps/hazmat in v1 screenshots). New-Arch mandatory on SDK 57 — verify
every native dep; dev-build workflow (already pinned).

### §23.4 Enterprise-grade & 100% type safety (D28)

The monorepo is genuinely strict but "100% end-to-end" is **not yet true**: the client **casts**
responses (`as T`), ESLint is **not type-aware** (the `no-unsafe-*` family is off), and the shared
package emits **no `.d.ts`**. Fixes:

- **Parse, never cast** — the runtime `parse` is the guarantee (types are erased); see D24.
- **tsconfig.base:** enable `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
  `noImplicitReturns` (one-time fallout in `env.ts` etc.). Driver tsconfig: `jsx:react-jsx`,
  `lib:["ESNext"]` (**drop DOM** so `window`/`localStorage` can't be referenced), `types:["expo",
  "nativewind/types"]`, include `.expo/types`.
- **Type-aware ESLint** for `apps/driver` (`projectService:true`): `no-explicit-any`, `no-unsafe-*`,
  `no-floating-promises`, `no-misused-promises` (async `onPress`), `switch-exhaustiveness-check`,
  `strict-boolean-expressions`, `consistent-type-imports` + React/RN/a11y plugins + RN globals (closes §20 F5).
- **Shared `.d.ts` emit (refines D7):** `build` off `--noEmit` → `declaration`+`declarationMap`+`outDir`;
  `exports` lists **`types` first** → `dist/index.d.ts`; a CI **`dist`-freshness gate** prevents the
  web-source ↔ RN-dist contract drift.
- **expo-router typed routes** (`experiments.typedRoutes`); **typed env** (Zod over Expo extras); add
  `.tsx` to `check-file-size.mjs` (§20 F5).
- **Validate-at-runtime checklist** (types don't protect I/O): API responses · direct-PostgREST rows ·
  persisted cache on rehydrate · SQLite outbox rows · AsyncStorage/SecureStore values · deep-link params
  (never log) · push payloads · form input (client **and** server) · env/extras · camera metadata ·
  third-party SDK callbacks — all Zod-parsed, never cast.
- **Typed errors:** discriminated `Result<T>` with exhaustive switches (`never` default → new enum member
  is a compile error).
- **Testing:** vitest (pure logic; reuse `@fuelguard/shared` tests as parity oracle) +
  `@testing-library/react-native` (components) + **Maestro** (e2e). **Sentry** RN with **source-map
  upload in EAS/CI** and PII-scrubbed breadcrumbs.

### §23.5 Phase impact / what changed

- **Phase 0:** shared `.d.ts` build + `dist`-freshness gate; type-aware ESLint; tsconfig strict
  additions; `.tsx` in the file-size linter; `supabase gen types` in CI; typed routes.
- **Phase 1:** `driverContract.ts` begins; **reconcile the assignment model (D30)** + the
  `vehicles(assigned_driver_id)` index in `0084`; offline-boot session handling; **account-deletion**
  endpoint + Settings control (CG1).
- **Phase 2:** parse-on-rehydrate for the persisted cache + outbox rows; retry/backoff/timeout taxonomy;
  parallel bootstrap.
- **Phase 3:** keyset fuel log; decoupled scoring + keep-warm; idempotent receipt↔insert compensation;
  the full `/api/me/fillups` typed contract.
- **Pre-submission:** distribution setup (D25); privacy manifest/labels/Data-safety (D27); privacy +
  deletion web pages (O19); demo account (O20/CG2); New-Arch dep verification.
- Added decisions **D24–D30**, open items **O18–O20**, gates **CG1–CG2**. **Net:** the front↔back
  contract is now precise (parsed, typed, drift-tested), reliable (retry/timeout/offline-boot/
  compensation), and fast (keyset, parallel bootstrap, decoupled scoring, keep-warm); the app is on a
  100%-runtime-validated type-safety footing; and it has a concrete zero-rejection path to both stores.

---

## §24. Audit Round 5 — Final decision lock-down (solutions-only)

> Goal of this round: leave **zero decisions for build time.** Every previously-open question was
> resolved into a LOCKED decision using researched enterprise best practice, each with a documented
> fallback. This section is the map from the old open questions to their resolutions. After this round,
> §10 contains only *operational tasks* (configure/seed/host/verify), not choices.

### §24.1 Former open items → locked resolutions

| Was | Question | Locked resolution |
|-----|----------|-------------------|
| O1 | Phone/OTP login | **Email/password only for v1** (D1); phone/OTP deferred, revisit only on measured onboarding friction |
| O2 | Offline store lib | **expo-sqlite SQLCipher outbox** (D4/D12); WatermelonDB not used in v1 |
| O3 | Token hook enabled? | **Operational task T1** (Dashboard verify) — a check, not a decision |
| O4 | Vehicle-assignment UX | Driver's vehicles = `assigned_driver_id = my driver.id`; **single → preselected, multiple → bottom-sheet picker with remembered last-used** (D30) |
| O5 | Push provider | **Expo Notifications + server Expo Push API**; graduate at ~10k devices / analytics need (D33) |
| O6 | My Performance in v1? | **v1 = Phases 0–3; Phase 4 (My Log + My Score) = v1.1** (D39) |
| O7 | zod v4 on Hermes | **Metro package-exports config; fallback zod 3.x** — verified in the Phase-0 spike (T2) |
| O8 | image-manipulator WebP | **Pin ≥12.0.1** (verified in T2); JPEG fallback pre-documented |
| O9 | Per-fill MPG | **Display server-written `computed_mpg`** (null until scored); never client-recompute |
| O10 | Map tile host | **MapTiler Cloud**; fallback self-hosted Protomaps PMTiles (D37) |
| O11 | Email-confirmation posture | **Enforce the invite token in accept** (D15); confirmations may stay off |
| O12 | Session lifetime | **`jwt_expiry=3600`, rotation+reuse-detection on, inactivity 7d, time-box 30d** (D31) |
| O13 | Certificate pinning | **Skip in v1** + compensating controls; dynamic-pinning fallback if threat rises (D34) |
| O14 | Rate limits / caps | **12/min (burst 5), 30/hr per `sub`; 20 fills/driver/day; suppress driver-fill manager emails** (D32) |
| O15 | Numeric keypad | **Native `decimal-pad`** in v1; custom glove keypad deferred (D38) |
| O16 | Typeface | **IBM Plex Sans + IBM Plex Mono** (OFL, variable, tabular); Archivo fallback (D36) |
| O17 | In-motion lockout | **GPS-speed gate, lock > 5 mph** with hysteresis; denied-permission → locked + attestation (D35) |
| O18 | Assignment model | **`vehicles.assigned_driver_id` authoritative**; `driver_vehicle_assignments` stays analytics (D30) |
| O19 | Privacy/deletion web pages | **Operational task T4** (build + host `…/privacy`, `…/delete-account`) |
| O20 | Reviewer demo account | **Operational task T5** (seed + put creds in store review info) |

### §24.2 Inline hedges removed

- **Scoring emails:** driver-triggered `scoreWithCascade` runs the full cascade but **suppresses the
  immediate manager notification email** (anomalies still land in the dashboard + digest) — no "decide
  later" (§14.7).
- **Bottom sheet:** locked to **`@gorhom/bottom-sheet` v5** (vehicle picker + over-capacity confirm) —
  not "or Expo UI" (§22.2).
- **Animation:** **Reanimated 4 native APIs** (`entering`/`layout`/CSS); **Moti not adopted** (§22.2).
- **Shared-package Metro consumption:** locked to a **`.d.ts`-emitting build step** (D7/§20 B2) — the
  resolver-shim alternative is dropped.
- **Storage-at-rest:** **`LargeSecureStore` required** (D6) and **SQLCipher outbox** (D12) — not optional.

### §24.3 Standing rule

The plan is **solutions-only**. A builder should implement straight through §11–§15 using the LOCKED
decisions §9 (D1–D58, plus the §9.1 cleanup record); the audit sections §20–§24 are historical provenance (§9 governs where
noted); §10 is the operational checklist. If a truly new question surfaces, resolve it to a LOCKED
decision with a rationale and a fallback in the same style — never leave a "we'll research this during
build" gap. **Net:** nothing in this plan requires a research detour once construction starts.
