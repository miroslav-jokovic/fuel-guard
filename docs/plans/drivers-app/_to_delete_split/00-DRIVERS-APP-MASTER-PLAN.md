# FuelGuard Driver App — Master Plan

> Native mobile app (React Native + Expo) for the people who fuel the trucks.
> Owner: Silvicom Inc. · Status: **PLANNING — v1 scope LOCKED (Foundation)** · Last updated: 2026-07-24
>
> This is the single source of truth for the Driver App initiative. It is written to be followed
> from a fresh chat with zero prior context. Every decision below is either **LOCKED** (with
> rationale) or **OPEN** (tracked in §12). Read this doc first, then the phase docs in order.

---

## 0. Read order

| # | Doc | What it covers | State |
|---|-----|----------------|-------|
| 00 | **This doc** | Vision, scope, architecture, identity model, design-system port, phase map, conventions. | ✅ written |
| 01 | [Phase 0 — Foundation & Design System](./01-PHASE-0-FOUNDATION.md) | Expo app in the monorepo, NativeWind token port, shared-package wiring, app shell, base components, CI/lint. | ✅ written |
| 02 | [Phase 1 — Identity, Auth & Access Control](./02-PHASE-1-IDENTITY-AUTH.md) | Driver invites (relaxed domain), `drivers.user_id` link, web-dashboard gate, driver-scoped RLS, sign-in, secure session. | ✅ written |
| 03 | [Phase 2 — Offline-first Data Layer & Home](./03-PHASE-2-OFFLINE-DATA-HOME.md) | Read cache, durable write outbox, sync engine, connectivity UX, glanceable Home. | ✅ written |
| 04 | [Phase 3 — Fuel Capture (the daily job)](./04-PHASE-3-FUEL-CAPTURE.md) | The core flow: fill-up form, reused warnings, receipt capture, enqueue → sync → server-side score. | ✅ written |
| 05 | Phase 4 — My Fuel Log & My Performance | *(written after 00–02 are verified)* | ⏳ pending |

> **Incremental discipline (why this doc set is delivered in slices).** We write and verify the
> master + Phase 0 + Phase 1 first, confirm the direction against reality, then expand the remaining
> phase docs. No segment is written on top of an unverified one.

---

## 1. Why this app exists

Today FuelGuard has **no driver-facing native app**. `docs/10-SAMSARA-RECONCILIATION.md` states it plainly: *"There is no driver app… drivers never touch FuelGuard."* The only driver surface is a mobile-responsive **web** fill-up form buried in the manager dashboard, and the `driver` role is `none` on every section of the web app.

Drivers are the source of the two numbers the entire product is built on — **odometer** and **gallons** — yet they have no purpose-built tool. The Driver App turns that thin capture slice into a first-class, offline-first mobile experience that drivers open every day, and becomes the delivery surface for a wave of already-planned features (training, HazmatGuard, smart-fueling navigation) that only make sense in the cab.

**Product principles (inherited from `docs/00-PRODUCT-OVERVIEW.md §8), specialized for mobile:**

1. **Simple to use, serious underneath.** A driver logs a fill-up in under 30 seconds; the platform keeps an enterprise audit trail.
2. **Glanceable over comprehensive.** Big numbers, one primary action per screen, status by color + label. Readable in 1–2 seconds at a fuel island.
3. **Offline by default.** Drivers lose signal constantly. Core capture never blocks on the network.
4. **Design from tokens, never from literals.** No hardcoded colors, no inline styles — enforced in CI, exactly like the web app.
5. **Reuse the brain, rebuild only the skin.** Domain logic, validation, and rules come from `@fuelguard/shared`; only the UI is new.

---

## 2. Scope

### 2.1 v1 — Foundation (LOCKED)

v1 proves the entire pipeline end-to-end — invite → install → log in → capture a fill-up offline → sync → see it in the manager dashboard — and lays clean seams for every later feature. It is deliberately **not** a feature land-grab.

**In v1 (Phases 0–3, optionally 4):**

- Expo app inside the existing monorepo (`apps/driver`), sharing `@fuelguard/shared`.
- The FuelGuard design system ported to React Native as tokens (NativeWind) with CI enforcement.
- Driver identity: invite (personal email + password), sign-in, secure session, "account pending", the `drivers.user_id` link, web-dashboard gating, and driver-scoped RLS.
- Offline-first data layer (local persistence + sync queue) and a glanceable Home.
- **Fuel capture** — the daily job — faithfully replicating the web flow with offline queueing.
- (Optional in v1) **My Fuel Log** + **My Performance** read screens.

### 2.2 Explicitly out of v1, but designed-for (extension seams)

These are **not built in v1**. v1's architecture must leave clean, documented seams so each slots in later as its own phase/feature plan without rework:

| Future feature | Current state | Seam v1 must leave |
|---|---|---|
| **Driver Safety Training (micro-LMS)** — `docs/plans/DRIVER-TRAINING-PLAN.md` | Doc-only. *(Note: "Samsara training" = a self-built video/quiz LMS; "Samsara" is only an example course name, not an integration.)* | A "Training" tab slot; secure-storage token pattern; a media/video-player module boundary; deep-link scheme `fuelguard://`. |
| **HazmatGuard** — `docs/18-HAZMATGUARD-PLAN.md` | Doc-only, but **API pre-frozen** ("zero new endpoints" for the native app, §H10). | A camera-capture + guided-photo module; offline photo queue keyed by client UUID; entitlement gate (`hazmatguard`); a "Hazmat" tab slot. |
| **Smart-fueling alerts/reminders** — `docs/plans/SMART-FUELING-PLAN.md` | Solver + HERE truck routing **built** server-side; driver alerts **greenfield**. | Push-notification infrastructure (Expo) + a notifications module; a "My Plan" read screen consuming `POST /fueling/plan`. |
| **Fueling navigation** — same plan | Truck-safe route + turn-by-turn maneuvers **built** server-side; live in-cab nav **greenfield** (plan notes true turn-by-turn "parity is not achievable" — target corridor guidance). | A maps module boundary (MapLibre/react-native-maps) rendering a HERE polyline + fuel-stop overlays; room to graduate to an on-device nav SDK behind a dev build. |
| **My Performance** (driver self-view) | Scoring math **built** in `packages/shared/src/driverPerformance/`; no driver-facing view. | A driver self-read (own row only) + a "My Score" screen. |

### 2.3 Non-goals (v1)

Live in-cab turn-by-turn voice navigation; the training video player; hazmat capture; real push delivery; multi-language. All are later phases.

---

## 3. Architecture

### 3.1 Where it lives

The app is a new workspace package in the existing monorepo — **not** a separate repo. This is what makes "modular and reusable" real: one `pnpm install`, one `@fuelguard/shared`, one set of types.

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

### 3.2 Data & auth topology (unchanged backbone, new client)

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

The driver app authenticates **exactly like the web app** — Supabase `signInWithPassword`, then a Bearer JWT carrying `org_id` + `user_role` claims (injected by the Custom Access Token hook, `supabase/migrations/0006_auth_hook.sql`). No new auth mechanism. `apps/api` verifies the JWT locally against JWKS (`apps/api/src/lib/auth.ts`); no server changes needed to *authenticate* a driver.

### 3.3 The reuse contract (verified in audit)

`@fuelguard/shared` is pure TypeScript with a single runtime dependency (`zod`): **no Vue, no browser globals, no Node built-ins.** The driver app imports the same modules the web app and API use:

- `auth.ts` — `USER_ROLES`, `SECTION_ACCESS`, `canViewSection`, `claimsToContext`, `isEmailDomainAllowed`.
- `fuel.ts` — `fillUpInputSchema`, `computeFillUpWarnings`, `derivePricePerGal`, `FuelTransaction`.
- `apiContract.ts` — shared request/response Zod schemas (invites, members, org).
- `smartFueling/` — the `planFuelStops` solver, `RouteFuelSettings`, alert thresholds.
- `driverPerformance/` — `combineWeek`, `rankTrailing`, scoring types.

**Consumption caveat (handled in Phase 0):** `@fuelguard/shared` ships raw `.ts` (its `exports` point at `src/index.ts`, no build step). Metro (Expo's bundler) does not transpile workspace TS by default. Phase 0 wires this via Metro `watchFolders` + `monorepo` config (the low-friction path; no build step added to shared). See `01-PHASE-0-FOUNDATION.md §4`.

### 3.4 Modularity model (how features stay isolated)

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

Rules (enforced, §11): screens never contain colors or business logic; features never import each other's internals; all domain logic comes from `@fuelguard/shared`; every color is a token.

---

## 4. Identity & access-control model (LOCKED)

**Decision D1 — Driver login = personal email + password.** Drivers rarely have company email, so driver-role invites relax the `organizations.allowed_domains` restriction that gates office users. One auth mechanism (Supabase email/password), reused invite flow, minimal backend change. *(Rationale: chosen over phone/OTP to avoid an SMS provider dependency and a second auth path in v1; phone auth remains a future option — see §12 O1.)*

The three precise backend gaps the audit surfaced (all addressed in Phase 1):

1. **`drivers.user_id` is dead.** The column exists (`supabase/migrations/0003_core_tables.sql`) but is never written and has no unique constraint. Phase 1 wires it at invite-accept and enforces uniqueness, so a logged-in driver deterministically resolves to their `drivers` row (their fills, their assigned vehicle, their score).
2. **The web dashboard does not gate out drivers.** The web router only enforces `requiresAdmin/requiresManage/requiresAuditAccess`; a `driver` login would land on `/` and read most data. Phase 1 adds a role redirect so drivers cannot use the web app — they get the driver app only.
3. **RLS is too broad for a driver.** Every org member can `select` all fleet data today. Phase 1 adds driver-scoped policies (own `driver_id` / assigned vehicle) and a driver-scoped capture path (the current `POST /api/transactions/:id/score` is manager-only and 403s for a driver).

**Invite flow (reused, one change):** Admin invites a driver from the dashboard exactly as today (`POST /api/invites` with `role:'driver'`) → branded email link → driver sets password (`AcceptInvitePage` equivalent, in-app) → `POST /api/invites/accept` upserts the membership. The single change is relaxing the domain check for `role:'driver'` and linking/creating the `drivers` row on accept. Full spec in Phase 1.

---

## 5. Design system port (LOCKED)

**Decision D2 — Styling = NativeWind with a locked token config + a token linter.** This mirrors the web app's Tailwind v4 mental model and its enforcement approach (a CI script that fails on raw palette classes, hex, or inline color styles), so web and mobile stay one visual system.

The web design system is a three-layer OKLCH architecture (`packages/ui/src/tokens.css`, byte-parity-checked against `apps/web/src/style.css`): **primitive ramps** (`neutral/brand/danger/caution/warning/success/info`, brand = indigo) → **semantic roles** (`surface`, `ink`, `edge`, …) → utilities. The port reproduces this by value:

- **Tokens** live in `apps/driver/src/theme/` as a NativeWind/Tailwind config: the same ramps (OKLCH → precomputed hex for RN compatibility), the same semantic role names, and a **light + dark** role map (the web ships light only; the driver app builds dark now — night driving needs it).
- **Components** consume only semantic roles (`bg-surface`, `text-ink`, `ring-edge`) — never `indigo`/`#hex`. Variant taxonomy matches the web primitives (`Button`: primary/secondary/danger/soft/ghost; `Input`; `Card`; `Badge` with severity tones).
- **Enforcement:** a `check-design-tokens.mjs`-equivalent for RN (bans hex, raw palette classes, inline `style` colors) wired into `pnpm lint:tokens` and CI. This is what operationally guarantees "no inline designs, no hardcoded colors."
- **Typography:** system font stack (matches web — no custom font to bundle), same size/weight scale (`xs 12 / sm 14 / base 16`, weights 500/600/700), with Dynamic Type support.
- **Anti-"generic-AI" rules (encoded in the design doc):** one purposeful brand color used functionally; disciplined neutrals; reserved semantic colors carrying meaning; real typographic hierarchy via size/weight, not gradients; flat honest surfaces; motion restraint. No purple gradients, no decorative blur, no gradient text.

Full token tables (actual OKLCH values), component specs, and the RN theme shape are captured in `01-PHASE-0-FOUNDATION.md` and will graduate into a standalone `DRIVER-APP-DESIGN-SYSTEM.md` once Phase 0 is built.

---

## 6. Offline-first strategy (LOCKED direction)

Robust offline is a v1 requirement (drivers lose signal). The model:

- **Reads:** TanStack Query (React) with an AsyncStorage persister + `onlineManager` wired to NetInfo, so cached context (vehicles, driver, recent fills) is available offline.
- **Writes:** a durable **local write queue**. A fill-up is captured to a local store immediately (optimistic), then replayed to Supabase/API when connectivity returns.
- **Idempotency is already solved:** the fill-up primary key is a **client-generated UUID** (web pattern, `apps/web/src/lib/uuid.ts`), generated once per form. Replaying a queued insert is safe — a duplicate PK insert fails rather than double-writing. The queue is designed around this.
- **Receipt photos:** captured with `expo-camera`/`expo-image-picker`, compressed with `expo-image-manipulator` (the web's canvas/WebP path does not exist in RN), stored locally until the queue uploads them to the `receipts` bucket.

Library choice for the local store (WatermelonDB vs a lighter SQLite/AsyncStorage queue) is finalized in Phase 2; v1 capture only needs a small, well-tested queue, so we start minimal and grow.

---

## 7. Maps & navigation approach (LOCKED direction)

Aligned to the existing HERE investment and Expo constraints:

1. **Routing stays server-side on HERE** (already built: truck profile + hazmat class + tunnel category, `apps/api` + `smartFueling`). The app requests a plan/route and receives geometry + maneuvers + fuel stops.
2. **On-device display** with **MapLibre RN / react-native-maps**: render the HERE polyline, maneuver cards, and **fuel-stop overlays** in fully-branded UI. Expo-friendly, no second vendor.
3. **True offline voice turn-by-turn** (if field testing proves drivers need it) graduates later to a **HERE SDK Navigate Edition** native bridge behind an Expo **config plugin / dev client**. Consequence for v1: **use Expo dev builds from day one** (nav SDKs and several native modules don't run in Expo Go).

v1 builds none of the map UI — it only reserves the module boundary and adopts the dev-build workflow.

---

## 8. Phase map

Dependency-ordered. Each phase ends in something runnable and demoable (team convention). `☐` = not started.

| Phase | Outcome (demoable) | v1? |
|---|---|---|
| ☐ **0 — Foundation & Design System** | `apps/driver` boots on a device via Expo dev build; NativeWind tokens live; `@fuelguard/shared` imports work through Metro; a themed component gallery renders; token-lint + CI green. | ✅ |
| ☐ **1 — Identity, Auth & Access Control** | An admin invites a driver (personal email); driver installs the app, sets a password, signs in; driver resolves to their `drivers` row; a driver is blocked from the web dashboard; driver-scoped RLS verified in the matrix. | ✅ |
| ☐ **2 — Offline-first Data Layer & Home** *(doc written)* | App works fully offline; Home shows the driver's assigned vehicle + recent activity from cache; reconnect syncs. | ✅ |
| ☐ **3 — Fuel Capture** *(doc written)* | Driver logs a fill-up offline (vehicle, odometer, gallons, cost, receipt photo, live warnings, over-capacity confirm); it queues and syncs; it appears in the manager dashboard and gets scored. | ✅ |
| ☐ **4 — My Fuel Log & My Performance** | Driver views their own fills (MPG/status) and their weekly performance score/rank. | ◐ optional v1 |
| ☐ **5+ — Future features** | Training, HazmatGuard capture, smart-fueling plan + alerts + nav — each its own feature plan, slotting into the seams from §2.2. | ✕ post-v1 |

---

## 9. Cross-cutting backend changes (summary; detail in Phase 1)

All additive — "we add; nothing above is modified destructively" (team invariant). Migrations start at **0083**.

- `0083_driver_identity` — enforce/populate `drivers.user_id` (unique), link at invite-accept.
- `0084_driver_scoped_rls` — driver-scoped `select`/`insert` policies (own fills, assigned vehicle, own driver record, own performance week) + additions to the offline RLS matrix (`supabase/tests/rls.test.mjs`).
- API: relax domain check for `role:'driver'` invites; add a driver-scoped fill-up capture endpoint that runs scoring server-side; add a `GET /api/me/driver` context read.
- Web: role guard redirecting `driver` away from the dashboard.

---

## 10. Testing & verification standard (mirror the team bar)

Every phase clears the same gate the web app does before commit:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green (driver app added to `pnpm -r`).
- Token-lint (`lint:tokens`) green — no hex/inline colors.
- Any new migration appended to the **offline RLS matrix** with assertions (drivers can read only their own scope; cannot read others').
- Phase records its verification tally back into its doc (e.g. "*Verified: N tests, RLS matrix X/X, typecheck/lint/build green, ran on iOS + Android dev build*").
- Native specifics: unit tests (Jest/vitest) for hooks/queue logic; a smoke test on a real device per phase (nav SDKs and camera need real hardware).

---

## 11. Conventions this initiative follows (inherited)

From `CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md`, `docs/REORG-BACKLOG.md`, and observed practice:

- **One doc per feature**, phased, checkbox-tracked, demoable per phase, "one phase per working session."
- **Pure logic in `packages/shared`**; never duplicate a Zod schema in an app.
- **Migrations are the single source of truth**; never edit an applied migration; every table gets RLS; append to the RLS matrix.
- **API-first, frozen contracts** so clients reuse endpoints unchanged.
- **Design tokens only**, enforced by a linter; **500-line file-size budget**; feature-boundary import checks.
- **Additive changes**; external integrations get a live verification probe before parsers/clients are locked.

---

## 12. Open items (to resolve before or during the phase that needs them)

| ID | Item | Needed by | Proposed default |
|----|------|-----------|------------------|
| O1 | Phone/OTP login as a future driver path | Post-v1 | Keep email/password for v1; revisit if driver onboarding friction is high. |
| O2 | Offline store library (WatermelonDB vs light SQLite queue) | Phase 2 | Start with a minimal SQLite/AsyncStorage queue for capture; adopt WatermelonDB only if read-sync complexity grows. |
| O3 | Confirm the Custom Access Token hook is **enabled** in the target Supabase project (it's commented out in `supabase/config.toml`). | Phase 1 | Verify in Supabase Dashboard before Phase 1 auth work; without it, no `org_id`/`user_role` claims are issued. |
| O4 | Driver↔vehicle assignment UX for capture (assignment lives on `vehicles.assigned_driver_id`, not on the driver) | Phase 3 | Driver picks from vehicles they're assigned to; allow override with a flag, mirroring web. |
| O5 | Push-notification provider (raw Expo push vs a service layer) | Phase 5 (alerts) | Defer; reserve the notifications module boundary now. |
| O6 | Whether **My Performance** ships in v1 or v1.1 | End of Phase 3 | Decide after capture lands; math is free, only a scoped read + screen needed. |

---

## Sources (code & docs this plan is grounded in)

- Reuse surface: `packages/shared/*` (esp. `auth.ts`, `fuel.ts`, `apiContract.ts`, `smartFueling/`, `driverPerformance/`), `packages/shared/package.json`.
- Auth/invite/identity: `supabase/migrations/0003_core_tables.sql`, `0004_rls.sql`, `0006_auth_hook.sql`, `apps/api/src/routes/invites.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/auth.ts`, `apps/web/src/pages/auth/AcceptInvitePage.vue`, `apps/web/src/router/index.ts`.
- Driver-facing web flow: `apps/web/src/features/fuel/{FillUpForm.vue,useFuelLog.ts,imageCompress.ts}`, `apps/web/src/lib/{supabase.ts,api.ts,uuid.ts}`, `apps/web/src/stores/session.ts`.
- Design system: `packages/ui/src/tokens.css`, `packages/ui/src/components/App{Button,Input,Card}.vue`, `apps/web/scripts/check-design-tokens.mjs`, `scripts/check-token-parity.mjs`, `docs/DESIGN-SYSTEM.md`, `apps/web/src/lib/badges.ts`.
- Planned features: `docs/plans/DRIVER-TRAINING-PLAN.md`, `docs/18-HAZMATGUARD-PLAN.md`, `docs/17-HAZMAT-BOL-COMPLIANCE.md`, `docs/16-DRIVER-PERFORMANCE.md`, `docs/plans/SMART-FUELING-PLAN.md`, `docs/10-SAMSARA-RECONCILIATION.md`.
- Conventions: `CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md`, `docs/REORG-BACKLOG.md`, `README.md`.
- External UX/design research: Samsara Driver / Workflow Builder, Motive driver experience, Trucker Path, Expo Notifications, WatermelonDB offline-first, Shopify Restyle / NativeWind comparisons, HERE SDK + RN, WCAG 2.2 mobile. (Full URLs in the research brief attached to this initiative.)
