# FuelGuard Driver App — Master Plan (single source of truth)

> Native mobile app (React Native + Expo) for the people who fuel the trucks.
> Owner: Silvicom Inc. · Status: **PLANNING COMPLETE — Phases 0–4 authored; Audit Rounds 1–5 complete; every decision LOCKED, zero open research items; build not started — clear the operational pre-build checklist (§10) first** · Last updated: 2026-07-24
>
> ✅ **Solutions-only.** Every architecture/design/security/UX/compliance choice is a **LOCKED decision
> (D1–D40)** with a rationale and a documented fallback. **There are no "decide during build" items left**
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
> D1–D40); §10 holds only operational pre-build *tasks* (no research required).

---

## §0. How to use this document — and how to resume in a new chat

This plan is designed so you (or a new chat, or a new teammate) can stop and continue with zero loss.
**Resume protocol:**

1. **This file is the single source of truth.** There are no other plan files. If you find old
   `00-…`, `01-…` numbered files, they are superseded copies — ignore them.
2. Read **§1 Progress Ledger** first — it says which phase is current and what the next action is
   ("you are here").
3. Read the **Locked Decisions (§9, D1–D40)** and the **operational pre-build checklist (§10)** before doing any work — they
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
8. Every design/architecture choice is already LOCKED (§9, D1–D40); §24 maps the former open questions
   to their resolutions. If a genuinely new question arises mid-build, record it as a new LOCKED decision
   with a rationale — don't guess, and don't reopen a settled one without cause.

---

## §1. Progress Ledger (you are here)

**Current state:** Planning complete for Phases 0–4; **Audit Rounds 1 (verification, §20), 2 (security,
§21) and 3 (UI/UX, §22) complete** — findings folded in. **No code written yet.** 12 blockers total:
build/verification **B1–B6** (§20.1) + security **SB1–SB6** (§21.1). §22 adds the navigation shell,
modern UX library stack, full component set, screen-state matrix, and the everyday flows the earlier
drafts omitted. §23 adds the end-to-end **typed contract** (client parses, never casts), the
reliability/performance patterns (keyset pagination, retry/timeout taxonomy, decoupled scoring,
parallel bootstrap), the **store-compliance** plan (private distribution + account-deletion + demo
account + privacy manifest), and the **100% type-safety** hardening (type-aware ESLint, `.d.ts` emit,
runtime-validation-at-every-boundary). Next action: clear the blockers
(chiefly confirm the token hook is enabled; land the RESTRICTIVE RLS incl. insert-scoping; fix the
invite-takeover path; make encrypted token/outbox storage the default; define offboarding) — then begin
**BUILD of Phase 0**. **Security note:** the driver app hands a low-trust actor the anon key + a JWT, so
**RLS at the database — not the API endpoints or the UI — is the authorization boundary.**

| Phase | Plan (doc) | Build | Verified | Next action |
|---|---|---|---|---|
| 0 — Foundation & Design System | ✅ authored | ◐ **in progress** — spike ✅ (device) + **15 components + design gallery + ramp-parity/shared-smoke tests (cloud-validated) + type-aware ESLint + CI**; token linter green | ☐ | Remaining: nav shell (tab bar + modal capture), on-device gallery a11y pass, tsconfig.base strict flags, commit CI workflow (protected path) |
| 1 — Identity, Auth & Access Control | ✅ authored | ☐ not started | ☐ | After Phase 0 |
| 2 — Offline-first Data Layer & Home | ✅ authored | ☐ not started | ☐ | After Phase 1 |
| 3 — Fuel Capture (the daily job) | ✅ authored | ☐ not started | ☐ | After Phase 2 |
| 4 — My Fuel Log & My Performance | ✅ authored | ☐ not started | ☐ | Optional v1; after Phase 3 |
| 5+ — Future features (training, hazmat, fueling nav) | ⏳ not authored | ☐ | ☐ | Author each as its own section when v1 lands |

**Locked at kickoff:** driver login = personal email + password · styling = NativeWind (locked token
config + token linter) · v1 = Foundation only (Phases 0–3, Phase 4 optional) · robust offline-first ·
full-stack (app + backend). See §9 for the full decision register.

---

## §2. Why this app exists

Today FuelGuard has **no driver-facing native app**. `docs/10-SAMSARA-RECONCILIATION.md` states it
plainly: *"There is no driver app… drivers never touch FuelGuard."* `docs/00-PRODUCT-OVERVIEW.md`
lists native mobile apps as an explicit non-goal ("the web app will be mobile-responsive instead").
The only driver surface is a mobile-responsive **web** fill-up form buried in the manager dashboard,
and the `driver` role is `none` on every section of the web app.

Drivers are the source of the two numbers the entire product is built on — **odometer** and
**gallons** — yet they have no purpose-built tool. The Driver App turns that thin capture slice into a
first-class, offline-first mobile experience drivers open every day, and becomes the delivery surface
for a wave of already-planned features (training, HazmatGuard, smart-fueling navigation) that only
make sense in the cab.

**Product principles (from `docs/00-PRODUCT-OVERVIEW.md §8`, specialized for mobile):**

1. **Simple to use, serious underneath.** A driver logs a fill-up in under 30 seconds; the platform keeps an enterprise audit trail.
2. **Glanceable over comprehensive.** Big numbers, one primary action per screen, status by color + label. Readable in 1–2 seconds at a fuel island.
3. **Offline by default.** Drivers lose signal constantly. Core capture never blocks on the network.
4. **Design from tokens, never from literals.** No hardcoded colors, no inline styles — enforced in CI, exactly like the web app.
5. **Reuse the brain, rebuild only the skin.** Domain logic, validation, and rules come from `@fuelguard/shared`; only the UI is new.

---

## §3. Scope

### 3.1 v1 — Foundation (LOCKED)

v1 proves the entire pipeline end-to-end — invite → install → log in → capture a fill-up offline →
sync → see it in the manager dashboard — and lays clean seams for every later feature. It is
deliberately **not** a feature land-grab.

**In v1 (Phases 0–3, optionally 4):** Expo app in the monorepo (`apps/driver`) sharing
`@fuelguard/shared`; the design system ported to RN as NativeWind tokens with CI enforcement; driver
identity (invite via personal email + password, sign-in, secure session, "account pending", the
`drivers.user_id` link, web-dashboard gating, driver-scoped RLS); an offline-first data layer (read
cache + write outbox + sync) and a glanceable Home; **fuel capture** replicating the web flow with
offline queueing; and (optional) **My Fuel Log** + **My Performance** read screens.

### 3.2 Explicitly out of v1, but designed-for (extension seams)

Not built in v1. v1's architecture must leave clean, documented seams so each slots in later as its
own plan section without rework:

| Future feature | Current state | Seam v1 must leave |
|---|---|---|
| **Driver Safety Training (micro-LMS)** — `docs/plans/DRIVER-TRAINING-PLAN.md` | Doc-only. *(Note: "Samsara training" = a self-built video/quiz LMS; "Samsara" is only an example course name, not an integration.)* | A "Training" tab slot; secure-storage token pattern; a media/video-player module boundary; deep-link scheme `fuelguard://`. |
| **HazmatGuard** — `docs/18-HAZMATGUARD-PLAN.md` | Doc-only, but **API pre-frozen** ("zero new endpoints" for the native app, §H10). | A camera-capture + guided-photo module; offline photo queue keyed by client UUID; entitlement gate (`hazmatguard`); a "Hazmat" tab slot. |
| **Smart-fueling alerts/reminders** — `docs/plans/SMART-FUELING-PLAN.md` | Solver + HERE truck routing **built** server-side; driver alerts **greenfield**. | Push-notification infra (Expo) + a notifications module; a "My Plan" read screen consuming `POST /fueling/plan`. |
| **Fueling navigation** — same plan | Truck-safe route + turn-by-turn maneuvers **built** server-side; live in-cab nav **greenfield** (plan notes true turn-by-turn "parity is not achievable" — target corridor guidance). | A maps module boundary (MapLibre/react-native-maps) rendering a HERE polyline + fuel-stop overlays; room to graduate to an on-device nav SDK behind a dev build. |
| **My Performance** (driver self-view) | Scoring math **built** in `packages/shared/src/driverPerformance/`. | Delivered in **Phase 4** (optional v1). |

### 3.3 Non-goals (v1)

Live in-cab turn-by-turn voice navigation; the training video player; hazmat capture; real push
delivery; multi-language. All are later phases.

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

v1 builds none of the map UI — it only reserves the module boundary and adopts the dev-build workflow.

---

## §9. Locked decisions register

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | Driver login = **personal email + password**; relax `allowed_domains` for `role:'driver'` invites only | Drivers lack company email; keeps one auth mechanism; minimal backend change (phone/OTP deferred, O1) |
| **D2** | Styling = **NativeWind** + locked token config + token linter | Parity with web Tailwind v4 + lint-based token enforcement (`check-design-tokens.mjs` model) |
| **D3** | Driver invites carry a **`driver_id`**; on accept, set `drivers.user_id` | Deterministic attribution; avoids fragile email/phone matching |
| **D4** | Offline = **read cache (TanStack Query persisted) + durable SQLite outbox**; WatermelonDB deferred | Only hard need is reliable offline writes; less machinery, easier to verify |
| **D5** | Fuel capture syncs via a **driver-scoped server endpoint** (`POST /api/me/fillups`) that scores server-side | Existing scoring route is manager-only (403s for drivers); keeps scoring server-authoritative |
| **D6** | Auth token storage = **`LargeSecureStore` (REQUIRED, not optional)** — AES-256 key in expo-secure-store, ciphertext in AsyncStorage — with `processLock` + AppState autorefresh + refresh-token rotation & reuse detection | Plain AsyncStorage is unencrypted (device theft/backup/root = refresh-token takeover); expo-secure-store's ~2KB limit rules out the raw session. Upgraded from "optional" by the security audit (§21 SB4) |
| **D7** | `@fuelguard/shared` gets a **real build step** (tsc emit to `dist/` + an `exports` map with a `react-native`/`default` condition); web/api keep consuming source | Metro cannot resolve the 134 `.js`-suffixed→`.ts` specifiers; a build step is the clean fix (§20 B2). Additive; does not change web/api behavior |
| **D8** | Monorepo wiring: add root **`.npmrc` `node-linker=hoisted`**; `apps/driver/package.json` **omits `"type":"module"`**; Metro configured for the workspace | pnpm symlinks break RN autolinking; Expo config files are CJS (§20 B3, F5) |
| **D9** | Restrict drivers at the DB with **RESTRICTIVE RLS policies** (AND-combined) scoped to `auth_role()='driver'` — covering **SELECT and INSERT** on `fuel_transactions`, `vehicles`, `drivers`, `anomalies`, `memberships`, `thresholds`, `driver_performance_weeks` — leaving existing manager PERMISSIVE policies untouched | Existing `*_select` policies are permissive (OR); adding a scoped policy only *broadens*. RESTRICTIVE tightens drivers without touching managers. **Extended by the security audit to INSERT** (attribution forgery — §21 SB1) |
| **D10** | **DB is the authorization boundary.** RLS must hold even against **raw PostgREST** (a driver has the anon key + JWT and can bypass `/api/me/*`). Every driver policy gets an allow **and** a raw-PostgREST **deny** test in `rls.test.mjs` | The driver app ships the exact credentials to call PostgREST/Storage directly; the API endpoints and web gate are convenience/UX, not security (§21) |
| **D11** | Invite/set-password deep link = **PKCE flow** (`flowType:'pkce'`) + **verified App Links / Universal Links** (not just the `fuelguard://` custom scheme); never log deep-link URLs/tokens | Custom schemes can be hijacked (scheme squatting) → auth-code interception; PKCE + OS-verified links neutralize it (§21 SB5) |
| **D12** | **Encrypt data at rest on device:** SQLCipher-encrypted offline outbox (expo-sqlite `useSQLCipher`, key in SecureStore); staged receipts kept in-sandbox, **deleted on sync**, min dwell; **EXIF stripped** before any receipt is written/uploaded | Outbox holds odometer/location/cost PII + receipts on a device that can be lost/rooted; camera EXIF leaks driver home GPS (§21 SB adjacent, F3/F4) |
| **D13** | **Driver-scoped receipt storage** (reverses §20 F4): path `${orgId}/${driverId}/${id}`, per-op policies enforcing `split_part(name,'/',2)=auth_driver_id()`, bucket `file_size_limit` + `allowed_mime_types`, **no `upsert` for drivers**, signed-URL reads | Existing `receipts` RLS is only org-scoped with `upsert:true` → a driver could read/overwrite/delete others' receipts (evidence tampering) and upload huge/malicious files (§21 SB2) |
| **D14** | **Offboarding is an explicit atomic action:** deactivate/delete membership **+** `auth.admin.signOut(userId,'global')` **+** `drivers.status='inactive'`; add `on delete set null` to `drivers.user_id`; **lower driver `jwt_expiry`** (~15–30 min) + session timebox | Today `drivers.status` is inert and membership-delete doesn't revoke live tokens → a fired driver keeps access until token expiry; the new FK also blocks `deleteUser` (§21 SB3) |
| **D15** | **Prove email ownership for driver invites:** enforce the (currently unused) invite **token** in `POST /invites/accept` (bind acceptance to a server-verified secret), and/or require email confirmation for the driver flow | Domain relaxation + `enable_confirmations=false` + accept-by-email = an attacker who knows a driver's personal email could self-register and accept the invite first (§21 SB6) |
| **D16** | **Supabase auth-hardening config gates (pre-launch):** leaked-password protection (HIBP) on, `minimum_password_length ≥ 10` + complexity, captcha on sign-in/sign-up, app-level lockout after N fails; confirm production **MFA is actually enabled** for platform admins | Personal-email drivers → weaker passwords; current config is min-length 6, no HIBP, per-IP-only limits, captcha off (§21 SB adjacent) |
| **D17** | **Navigation = bottom tab bar + elevated center capture.** Tabs: **Home · Fuel Log · (center) Log Fill-Up · My Score · More**; capture is a full-screen **modal route** over the shell (one thumb-tap from anywhere). Future features (Training, HazmatGuard, Fueling/Nav) live under **More** until daily-use. expo-router route groups `(auth)`/`(onboarding)`/`(app)`/modals | The plan reserved "tab slots" but never defined the shell — a redesign risk. Mirrors Dasher/Samsara/Motive; leaves clean room for the roadmap without re-teaching the bar (§22.1) |
| **D18** | **Modern UX library stack** (pins in §22.2): Reanimated 4 + worklets, gesture-handler, **FlashList v2**, @gorhom/bottom-sheet v5 (or Expo UI native sheet), **react-hook-form + zod resolver**, **react-native-keyboard-controller**, expo-haptics, **lucide-react-native** (+ expo-symbols on iOS), one bundled **variable typeface** via expo-font, **style-dictionary** token pipeline; Skia only for a gauge/sparkline | Native-thread motion, buttery lists, sticky-keyboard fast entry, and a real identity — the difference between "web app in a shell" and premium (§22.2) |
| **D19** | **Warning ladder is tokenized, never a native `Alert`.** Inline field caution → summary banner → blocking **confirm sheet** (danger) for over-capacity; every warning pairs **icon + label** (never color alone) | Native `Alert` breaks the design system; color-only warnings fail accessibility + sunlight (§22.4) |
| **D20** | **Motion + haptics tokens.** 120–200ms ease-out; springs only for physical drag; haptic map (Success on save, Warning on over-capacity confirm, Selection tick on pickers, Light impact on primary CTA). **Visual feedback is always primary; haptics enhance** (silent in iOS Low-Power/off); honor reduce-motion | Undefined motion is where an app drifts generic/janky; haptics can't be the only signal (§22.4) |
| **D21** | **Fill correction model.** A **pending (unsynced)** fill is **editable/deletable**; after sync it's read-only with an explained "locked — contact your manager" (correction-request is a later enhancement). Never a dead-end | Fuel-island fat-fingers are inevitable; a locked read-only detail with no recourse is a real failure (§22.6) |
| **D22** | **Accessibility spec (WCAG 2.2 AA).** Verified contrast in **both** themes; ≥48pt primary targets; live-region announcements for offline/sync/save; reduced-motion variants; `allowFontScaling` on; screen-reader `role`/`label`/`value` on every control + metric; token linter also audits target size | Earlier drafts *asserted* a11y; §22 *specifies* it — the only way it doesn't silently fail (§22.7) |
| **D23** | **Visual identity (anti-slop).** One intentional variable typeface with **tabular numerals**; **big glanceable tabular hero numerals** as the signature; lucide icons at one consistent (slightly heavier) weight; palette from fuel/logistics — **no indigo→purple gradients, no decorative blur/glass, no gradient text**; night theme on near-black (not pure #000), high-contrast day theme for glare | Turns the named anti-AI rules into concrete artifacts — where genericness actually enters (§22.8) |
| **D24** | **End-to-end typed contract.** Shared **request + response** Zod schemas in `packages/shared/src/driverContract.ts` for every driver endpoint; the client **parses every response — API *and* direct-PostgREST — fail-closed** (never `as T`; never cache/enqueue an unparsed payload). Shared typed `apiErrorCode` enum + a documented **retry/backoff/timeout** policy (GETs + idempotent `POST /me/fillups` retryable; 4xx→dead-letter; `AbortController` timeouts) | The existing web client casts `payload as T` with zero runtime validation and the response schemas are dead code — an offline app that caches to disk for hours must not trust drifted shapes (§23.2 F1/F2) |
| **D25** | **Distribution = private/internal, not public.** Apple **Custom Apps via Apple Business Manager** (skips App Review) with an Unlisted fallback; Google **Managed Google Play private app** (org-scoped). Store *guidelines still apply* — this reduces friction, not compliance | Single-company fleet app, invite-only; private distribution removes the 4.2/4.3 "thin app" rejection vectors and keeps it out of public discovery (§23.3) |
| **D26** | **In-app account deletion + web deletion URL.** `POST /api/me/delete-account` (deletes the Supabase auth user + unlinks `drivers.user_id` + purges device data); a Settings "Delete account" control (not email-only); a public `…/delete-account` web page for Google Data safety. Fuel records may be retained per employer recordkeeping, disclosed | Apple 5.1.1(v) **mandates** in-app deletion for any app with account creation; Google requires in-app + web URL. Invite-only is **not** exempt (§23.3) |
| **D27** | **Store config: declare only what's used.** Privacy Manifest (`privacyManifests`: UserDefaults/FileTimestamp/DiskSpace/BootTime reasons; `NSPrivacyTracking=false`); specific iOS usage strings; `usesNonExemptEncryption:false`; **no SIWA** (own-account exemption), **no ATT** (no cross-app tracking), **no background location**, **no broad media perms** (system Photo Picker); Android foreground-service audit; privacy-policy URL; nutrition labels + Data-safety matching requested permissions | These are the deterministic 2026 rejection traps; adding SIWA/ATT you don't need can itself cause rejection (§23.3) |
| **D28** | **Type-safety hardening.** Client **parses, never casts**; type-aware ESLint for `apps/driver` (`no-unsafe-*`, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions`, `consistent-type-imports`); `@fuelguard/shared` build **emits `.d.ts`** + a CI **`dist`-freshness gate** (prevents web-source↔RN-dist drift); enable `exactOptionalPropertyTypes`/`noPropertyAccessFromIndexSignature`/`noImplicitReturns` in `tsconfig.base`; `supabase gen types` + drift check; **expo-router typed routes**; add `.tsx` to the file-size linter | The "100% type-safe" claim is currently false (casts + non-type-aware lint + no `.d.ts` emit). Runtime validation at every I/O boundary is the real guarantee (§23.4) |
| **D29** | **Reliability & performance patterns.** True **keyset pagination** (no `count:'exact'`); **decouple `scoreWithCascade` from the client ack** (respond-then-score) + Railway keep-warm; **parallelize the launch bootstrap** (or one `/api/me/driver` bootstrap payload); offline-boot session handling (gate reads on cached session; never sign-out on a refresh network error); idempotent receipt↔insert compensation; **Sentry** + a `contract_drift` event + a contract-drift CI test | Kills the launch waterfall, cold-start tax, and silent contract rot; makes sync fast and reliable on spotty connectivity (§23.2) |
| **D30** | **Driver↔vehicle scope = `vehicles.assigned_driver_id` (LOCKED, resolves O18).** It's the model the existing fuel-capture flow already uses for attribution (`FillUpForm`, fleet UI). `driver_vehicle_assignments` (`0051`) stays a **telematics/idle-analytics history** table (used by scoring/Samsara/idle only) — **not** used for driver-app scope. Align RLS `0084` + the direct read + the server assignment-check on `assigned_driver_id`; add index `vehicles(org_id, assigned_driver_id) where assigned_driver_id is not null` | Verified in code: `assigned_driver_id` drives fuel attribution; `driver_vehicle_assignments` is analytics. One authoritative model, consistent with existing behavior (§24) |
| **D31** | **Driver session lifetime:** `jwt_expiry = 3600s` (1h — the fired-driver revocation window); refresh-token **rotation + reuse-detection ON**; **inactivity timeout 7 days**; **absolute time-box 30 days**. High-security fallback: `jwt_expiry 1800s` | Active drivers effectively never re-login; a revoked driver's token dies ≤1h after `admin.signOut`. Balances security vs field UX (§24, resolves O12) |
| **D32** | **Rate limits (driver write):** per-JWT-`sub` token bucket **12/min (burst 5), 30/hr** on `POST /api/me/fillups`; **business cap 20 fills/driver/day** (server-counted); `429 + Retry-After`, distinct codes for cap vs rate | A real driver logs ≈1–5/day; generous headroom that still stops runaway retries / token abuse. Keyed on `sub`, not IP (drivers share NAT) (§24, resolves O14) |
| **D33** | **Push = Expo Notifications + server-side sends via the Expo Push API** for v1; store both the Expo push token and the native FCM/APNs token. **Graduate** to a managed provider (OneSignal/Courier) at ~**10k+ devices** or the first need for delivery analytics / web push / cross-channel | Free, first-class, covers hundreds–low-thousands of drivers (Expo ceiling 600 notif/sec/project) with a non-breaking migration path (§24, resolves O5) |
| **D34** | **No certificate pinning in v1.** Compensating controls: TLS 1.3 + HSTS, system-trust-store only (Android `networkSecurityConfig`, iOS ATS), short JWT (D31), server-side anomaly/geo monitoring, MDM CA control. Fallback if threat rises: dynamic pinning (Approov) or intermediate-CA SPKI + backup pin behind a remote kill-switch | A static pin can't be OTA-patched; a mis-timed cert rotation bricks every install. OWASP treats static pinning as a liability at moderate sensitivity (§24, resolves O13) |
| **D35** | **In-motion lockout:** gate capture on **GPS speed (`expo-location`), lock > 5 mph (2.2 m/s)** with ~3–5s hysteresis; in-motion → full-screen "pull over to log fuel" interstitial (no text fields). Permission denied/unavailable → **default LOCKED** + an "I've parked" attestation tap | Fuel logging is manual entry → NHTSA per-se lockout in motion; GPS Doppler speed is the reliable low-friction signal (§24, resolves O17) |
| **D36** | **Typeface = IBM Plex Sans (UI) + IBM Plex Mono (numeric readouts)**, SIL OFL 1.1, variable, genuine **tabular figures** — bundled via `expo-font`. Fallback: Archivo (OFL, grotesque, tabular) | Industrial/engineered identity (not generic Inter/Roboto), license-clean to bundle, tabular numerals for jitter-free fuel/odometer columns (§24, resolves O16, satisfies D23) |
| **D37** | **Map tiles/styles = MapTiler Cloud** (vector tiles + hosted styles + MapLibre offline packs) for the Phase-5 nav feature; fallback/cost-optimization: self-hosted **Protomaps PMTiles** (a single `.pmtiles` on object storage = an offline pack, no per-tile fees, no lock-in) | Managed, predictable per-MAU pricing for a bounded driver roster, offline support, OpenMapTiles schema → self-host escape hatch is real (§24, resolves O10) |
| **D38** | **Numeric entry = native `decimal-pad`** in v1 (accessible, fast, familiar) with the large-value display + sticky submit; a custom glove keypad is deferred unless post-launch field data shows a need | Removes the build-time keypad question; native pad is the accessible default (§24, resolves O15) |
| **D39** | **v1 = Phases 0–3** (foundation → identity → offline+home → fuel capture). **Phase 4 (My Fuel Log + My Score) = v1.1**, the first post-launch increment | Ships the proven pipeline first; the read screens are cheap and follow once capture is validated (§24, resolves O6) |
| — | v1 = **Foundation only** (Phases 0–3; Phase 4 = v1.1) | Prove the pipeline end-to-end before feature breadth |
| — | Delivery = **one living plan doc**, built one phase per session, each phase demoable | Matches team conventions; resumable across chats |

**Version pins (verified 2026 — supersede any earlier "SDK 54/RN 0.76"):** Expo **SDK 57** (RN 0.86,
React 19.2; New Architecture mandatory) · Node 22 · TypeScript 6.0.3 (spike-verify vs NativeWind
typings) · **NativeWind 4.x** + tailwindcss **3.4.17** · @supabase/supabase-js 2.x (AsyncStorage
adapter) · @tanstack/react-query **5.x** + persist-client + async-storage-persister · netinfo · **zod
4.4.3** (with a Metro package-exports workaround; zod 3.x is the documented fallback) ·
expo-image-manipulator **≥12.0.1** (WebP both platforms) · @maplibre/maplibre-react-native 11.x ·
expo-sqlite (SDK-bundled). Full rationale in §20.3.

---

## §10. Operational pre-build checklist (tasks, not decisions)

**Every design/architecture/security/UX/compliance choice is now a LOCKED decision (D1–D40).** What
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
| T8 | **Procure the MapTiler account** (D37) + choose the bundled font files (D36: IBM Plex Sans/Mono) | Phase 0 (font) / Phase 5 (tiles) | Both choices are locked; this is provisioning, not selection |

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
  | `driver_performance_weeks` | `driver_id = auth_driver_id()` (reserved for Phase 4) |

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
  acceptance to that server-verified secret) and/or require `email_confirmed`. Keep invites admin-only
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
- Bootstrap = `GET /api/me/driver` cached under `['me','driver']`; supplementary reads go direct to
  Supabase under the Phase-1 driver policies:

  | Query key | Source | Notes |
  |---|---|---|
  | `['me','driver']` | `GET /api/me/driver` | driver + assigned vehicle(s) |
  | `['vehicles','assigned']` | Supabase `vehicles` (RLS) | picker + capacity/odometer/fuel-type for warnings |
  | `['fuel_transactions','mine', page]` | Supabase `fuel_transactions` (RLS) | recent fills for Home + Phase 4 |

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
bookkeeping.

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

Glanceable, thumb-zone, one primary action: header (driver name from `['me','driver']`, sync/offline
indicators); **assigned vehicle card** (unit + make/model, current odometer, tank capacity, fuel type
as big legible values); large (≥56pt) **"Log fill-up"** CTA in the bottom thumb zone (placeholder in
Phase 2; Phase 3 wires it); **recent activity** (last few fills from cache — date, gallons, odometer,
MPG/status via `@fuelguard/shared` `fuelTxnStatus`); cached-first empty/loading/error states (offline
is normal, not an error). Token-only.

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

## §14. Phase 3 — Fuel Capture (the daily job)

> Let a driver log a fill-up in under 30 seconds, offline, with the same validation and anti-theft
> warnings the web uses — then queue → sync → score through the Phase-2 outbox.
> Depends on: Phase 2 (outbox) + Phase 1 (identity/RLS) · Blocks: Phase 4

### 14.1 Goal & demoable outcome

In airplane mode, a driver taps **Log fill-up**, picks their vehicle, enters odometer + gallons + cost
(seeing live `$/gal` + warnings), snaps a receipt, submits. It appears instantly (optimistic), sits in
the outbox as `pending`, and on reconnect uploads the receipt, inserts the `fuel_transactions` row, and
is **scored server-side**, showing in the manager dashboard like a web-entered fill. Over-capacity
fills trigger a hard confirm and are flagged for review, identical to web.

### 14.2 Fidelity principle

This flow exists on the web (`apps/web/src/features/fuel/FillUpForm.vue` + `useFuelLog.ts`) and its
rules live in `@fuelguard/shared`. **Reuse the brain, rebuild the skin** — same Zod schema, warning
function, derivation, idempotency — so a mobile and a web fill-up are byte-equivalent domain objects.

### 14.3 The form (full screen, thumb-zone, numeric keyboards)

| Field | Control | Default / behavior | Source |
|---|---|---|---|
| Vehicle | large picker | driver's assigned vehicle (from cache); if one, pre-selected as a card | Phase-2 cache |
| Date/time | native picker | now (local) → ISO on submit | — |
| Odometer | decimal keypad | optional; drives odometer warnings | — |
| Gallons | decimal keypad | **required, > 0** | `fillUpInputSchema` |
| Total cost | decimal keypad | optional; drives live **`≈ $/gal`** via `derivePricePerGal` | `@fuelguard/shared` |
| Location | text | optional station/city | — |
| Payment method | picker | `PAYMENT_METHODS` (cash, efs_check, personal_card, fleet_card, fuel_voucher, other) | `@fuelguard/shared` |
| Receipt photo | camera/library | optional; single image | §14.4 |

**`driver_id` is not a field** — it is the logged-in driver (`auth_driver_id()`), server-resolved.
**Validation:** `fillUpInputSchema.safeParse` from `packages/shared/src/fuel.ts` — the same schema web
and API use → offline validation with server parity.

### 14.4 Live warnings (anti-theft, reused)

Via `computeFillUpWarnings({ gallons, odometer, tankCapacityGal, lastOdometer, fuelType })` from
`@fuelguard/shared` — a **flat args object**, not `(input, vehicle)` (§20 F3); the RN form assembles it
from the selected vehicle's `tank_capacity_gal`/`current_odometer`/`fuel_type`, exactly as
`FillUpForm.vue` does. Reactively as the driver types: **odometerMissing** (amber), **odometerBelowLast**
(red, vs `current_odometer`), **exceedsCapacity** (red, vs `tank_capacity_gal`). **Over-capacity hard-confirm:** on submit, if
`exceedsCapacity`, block with a **tokenized confirm sheet** (D19/§22.4 — *not* a native `Alert.alert`,
which breaks the design system) → "…flagged for review. Submit anyway?"; cancel aborts, confirm proceeds
(row naturally flagged downstream) with a `Warning` haptic. Preserve this anti-theft gate. All three
warnings are **icon + label**, never color-only (accessibility + sunlight).

### 14.5 Receipt capture (RN rewrite of the web WebP path)

Web's `createImageBitmap`+`<canvas>` is DOM-only. Rebuild: capture with `expo-image-picker`/
`expo-camera` (rear camera); resize/compress with `expo-image-manipulator` **≥12.0.1** (WebP on both platforms; new `manipulate().renderAsync().saveAsync()`
API — `manipulateAsync` is deprecated; longest edge ~1600px, ≤~200KB — matching web
`maxDim=1600 / maxBytes=200_000`). **Re-encoding also strips EXIF** — required so receipt photos don't
leak the driver's home GPS (D12/§21). **Stage** the processed file in the app sandbox and record its URI
on the outbox record; upload happens in the sync handler (offline photo never lost) and the staged file
is **deleted on successful sync** (min dwell).
**Storage security (D13 — corrects §20 F4):** existing `receipts` RLS is only *org*-scoped with
`upsert:true`, so a driver could read/overwrite/delete **others'** receipts and upload oversized/malicious
files. A **driver-scoped storage migration IS required** — path `${orgId}/${driverId}/${id}.webp`, per-op
policies enforcing `split_part(name,'/',2)=auth_driver_id()`, bucket `file_size_limit` (~5MB) +
`allowed_mime_types` (`image/webp,image/jpeg,image/png`), **no `upsert` for drivers**. Reads via
short-lived **`createSignedUrl`** (none exists in web — add it).

### 14.6 Submit → outbox → sync → score

Capture builds the `FillUpInput` (client UUID `id` generated once on mount via `expo-crypto`, the row
PK **and** receipt path prefix), validates, enqueues `{kind:'fuel_fillup', id, payload, file_uris}` +
optimistically inserts into `['fuel_transactions','mine']`, closes → toast "Fill-up saved" (works
offline; no "sent" language until synced).

**Sync handler (registered for `kind:'fuel_fillup'`):** per **D5**, uploads staged receipt(s) to the
`receipts` bucket (client-direct, RLS-scoped), then calls **`POST /api/me/fillups`** (new,
`requireRole('driver')`) with the validated row + `receipt_path`. The server verifies the driver is
assigned the vehicle, inserts `fuel_transactions` (`source:'manual'`, `entered_by`, derived
`price_per_gal`, `driver_id = auth_driver_id()`), and runs `scoreWithCascade` server-side. Idempotent
upsert on the client `id`. Why a server endpoint: the existing `POST /api/transactions/:id/score` is
manager-only (403s for drivers), so client-side scoring is impossible; the endpoint keeps scoring
server-authoritative and centralizes side effects (API-first invariant).

### 14.7 Backend additions (additive)

`POST /api/me/fillups` (`apps/api/src/routes/meFillups.ts`) — **narrow** Zod input (gallons/odometer/
cost/location/payment/vehicle_id/receipt_path/client-id only); **server-derive `org_id`, `driver_id`
(=`auth_driver_id()`), `entered_by`, `source='manual'`** — never spread the client body (mass-assignment,
§21 SB1); verify `vehicle.assigned_driver_id = auth_driver_id()`; insert → `scoreWithCascade` (reuse
`services/scoring/*`; **driver-triggered scoring runs the full cascade but SUPPRESSES the immediate
manager notification email** (anomalies still surface in the dashboard + digest — a driver's own fills
can't become manager email spam) — §20 F7); **`writeAudit` on insert** (actor = `sub`); **rate-limit
keyed by JWT `sub`: 12/min (burst 5), 30/hr, + a 20-fills/driver/day business cap** (D32). **Storage migration `0085_driver_receipt_storage` IS required** (driver-scoped
path + size/mime limits — D13, corrects §20 F4). The DB RESTRICTIVE insert policy (Phase 1) is the real
guard; the endpoint is convenience — a driver could otherwise POST to PostgREST directly.

### 14.8 File & work breakdown

Screen `app/(app)/fillup.tsx`, `src/features/fuel/FillUpScreen.tsx`; pieces
`{VehiclePicker,ReceiptCapture,WarningList,PriceHint}.tsx`; logic `useCaptureFillUp.ts`; receipt
`receipt.ts`; sync handler `src/data/handlers/fuelFillup.ts`; shared imports (`fillUpInputSchema`,
`computeFillUpWarnings`, `derivePricePerGal`, `PAYMENT_METHODS`, `FuelTransaction`); API
`meFillups.ts` + schema; migration `0085` + matrix; tests (schema-parity fixture, warning cases,
over-capacity gate, idempotent replay, handler upload→post sequence).

### 14.9 Exit criteria

- ☐ Driver logs a complete fill-up **offline**; it appears in recent fills immediately.
- ☐ Live `$/gal` and all three warnings match web outputs for the same inputs (shared-fixture test).
- ☐ Over-capacity submit triggers the hard-confirm; confirmed fills flagged downstream.
- ☐ On reconnect: receipt uploads, `POST /api/me/fillups` inserts + scores, row appears in the dashboard with a score.
- ☐ Retried sync creates no duplicate (idempotency test).
- ☐ Offline-captured receipt never lost (staged file survives relaunch, uploads on sync), **EXIF stripped**, staged file **deleted after sync**.
- ☐ **Security (§21):** a driver **cannot** read/overwrite/delete another driver's receipt (driver-scoped storage policy deny test); receipt upload rejects oversized/disallowed mime; `/api/me/fillups` uses narrow input + server-derived identity + per-`sub` rate limit + audit; the outbox DB is SQLCipher-encrypted.
- ☐ Screen token-only, ≥48pt targets, decimal keypads, Dynamic-Type safe, light + dark.
- ☐ `pnpm -r typecheck && lint && test` green; migration in the storage/RLS matrix; API tests for the endpoint.
- ☐ Doc updated: storage-policy outcome + verification tally (offline→online on iOS + Android, fill visible in the web dashboard).

### 14.10 Risks & mitigations

Scoring silently skipped (web's 403 trap) → driver-scoped endpoint scores server-side (D5; tested).
Lost receipts offline → staged before confirmation, deleted only after confirmed upload. Domain drift →
same shared schema/warnings (fixture test). Duplicate fills → client-UUID PK + upsert (tested). Wrong
attribution → server-resolved `driver_id` + assignment check + RLS.

---

## §15. Phase 4 — My Fuel Log & My Performance (optional v1)

> The driver's read surfaces: their own fill history (MPG/status) and their weekly performance
> score/rank. Cheap, because the derivations and scoring math already live in `@fuelguard/shared`.
> Depends on: Phase 3 · Blocks: nothing (v1 tail)

### 15.1 Goal & demoable outcome

A driver opens **My Fuel Log** and sees their own fills (date, gallons, odometer, computed MPG,
`$/gal`, status) with simple filters, paginated, working offline from cache. They open **My
Performance** and see their latest weekly score, its sub-scores (safety / efficiency / idling), their
rank, and a plain-language coaching line — all read-only, scoped to themselves.

### 15.2 My Fuel Log

- **Data:** `['fuel_transactions','mine', filters, cursor]` — Supabase `fuel_transactions` under the
  Phase-1 driver `select` policy (own rows only), served from cache offline. **Use true keyset
  pagination** (seek on `(fueled_at desc, id desc)`, `LIMIT n+1`, **no `count:'exact'`**) — note the web
  Fuel Log actually uses *offset* `.range()` + exact count (§23.2 F3); the driver app does it right since
  it's a fresh build. `keepPreviousData`/placeholder for smooth paging on **FlashList v2** (§22).
- **Row content & derivations reused from `@fuelguard/shared`:** computed **MPG** (from consecutive
  odometer readings), **`$/gal`** (`derivePricePerGal`), and **status** (`fuelTxnStatus` →
  Alert/Review/Verified/Clear) rendered with the `Badge` `txnStatusTone` mapping. No new domain logic.
- **Filters:** vehicle (their assigned set), date range — mirroring the web's filter components,
  rebuilt as RN `SearchInput`/`DateRangeFilter` equivalents. Tap a fill → a read-only detail
  (fields + receipt thumbnail from the `receipts` bucket + why it's flagged, if flagged).
- **Empty/loading/error:** cached-first; a friendly empty state for a new driver.

### 15.3 My Performance (driver self-view)

The math is already built (`packages/shared/src/driverPerformance/`: `combineWeek`, `rankTrailing`,
types) and used by the manager-facing web pages — it's **manager-only today**, so this phase adds a
**driver self-read** (own row only), not new math.

- **Backend — `0085_driver_perf_self_read.sql`:** `driver_performance_weeks` is currently
  **member-readable** (`dpw_select` grants any org member — so a driver can already read the whole
  leaderboard, §20). Add a **RESTRICTIVE** policy `USING (auth_role() <> 'driver' OR driver_id =
  auth_driver_id())` so drivers see only their own week while managers are unaffected. Optionally a thin
  **`GET /api/me/performance`** returning the driver's latest settled week + trailing rank. **Register in
  `rls.test.mjs`** with allow **and** deny cases (a driver cannot read another driver's week).
- **App — `src/features/performance/`:** a "My Score" screen showing `weekFinal` and the trailing
  `trailingFinal`/`rank`, the normalized sub-scores (safety 0.50 / efficiency 0.25 / idling 0.25 — the
  weights from `DEFAULT_PERFORMANCE_SETTINGS`), eligibility/coverage note when a week is ineligible
  (exposure gates), and a plain-language coaching line derived from the weakest component. Rendered with
  `StatTile`/`Card`/`Badge` primitives; big glanceable numerals; token-only.
- **Placement:** a "My Score" entry on Home + its own screen. Reserve, but do **not** build, the future
  join to training-completion % (a coaching signal per `docs/16-DRIVER-PERFORMANCE.md`).

### 15.4 File & work breakdown

App: `src/features/fuel/MyFuelLogScreen.tsx` + `useMyFills.ts` (pagination/filter), a read-only
`FillDetail`; `src/features/performance/MyPerformanceScreen.tsx` + `useMyPerformance.ts`. Shared:
import `driverPerformance` types + `combineWeek`/`rankTrailing` (display only), `fuelTxnStatus`/MPG
derivations, `Badge` tone maps. Backend: `0085_driver_perf_self_read.sql` (RESTRICTIVE) + matrix;
optional `apps/api/src/routes/mePerformance.ts` + Zod shape in `packages/shared`. Display the
server-written `computed_mpg` (per-fill MPG is server-derived — §20 O9), not a client recompute.

### 15.5 Exit criteria

- ☐ Driver sees a paginated, filterable list of **only their own** fills with correct MPG/`$/gal`/status (matching web derivations — fixture test); works offline from cache.
- ☐ Fill detail shows fields + receipt + flag reason (if any).
- ☐ Driver sees their latest weekly score, sub-scores, and rank; **cannot** read another driver's performance (RLS deny-case in the matrix).
- ☐ Coaching line renders from the weakest component; ineligible weeks explained.
- ☐ Screens token-only, ≥48pt targets, Dynamic-Type safe, light + dark.
- ☐ `pnpm -r typecheck && lint && test` green; `0086` in the RLS matrix (X/X).
- ☐ Doc updated: whether My Performance shipped in v1 or deferred (O6) + verification tally.

### 15.6 Risks & mitigations

Performance data leaking across drivers → RLS own-row policy with an explicit deny-case (matrix).
Derivation drift vs web → same `@fuelguard/shared` functions (fixture test). Scope creep (leaderboards,
comparisons) → v1 shows the driver **their own** numbers only; fleet leaderboards stay manager-side.
MPG needs consecutive odometers → reuse the web's derivation exactly; handle gaps gracefully ("—").

---

## §16. Cross-cutting backend changes (summary)

All additive — "we add; nothing above is modified destructively." Migrations from **0083**.

- `0083_driver_identity` — `invites.driver_id`; partial-unique `drivers(org_id,user_id) where user_id is not null`; **`drivers.user_id` → `on delete set null`** (D14); link at accept.
- `0084_driver_scoped_rls` — `auth_driver_id()` + **RESTRICTIVE** driver SELECT **and INSERT** policies (D9/D10; attribution-forgery close) + `fuel_transactions` audit trigger + raw-PostgREST deny cases in the matrix.
- `0085_driver_receipt_storage` — **RE-ADDED for security (D13, corrects §20 F4):** driver-scoped receipt path `${org}/${driverId}/${id}`, per-op policies (`split_part(name,'/',2)=auth_driver_id()`), bucket `file_size_limit` + `allowed_mime_types`, no driver `upsert`.
- `0086_driver_perf_self_read` — **RESTRICTIVE** driver self-read on `driver_performance_weeks` (Phase 4).
- API: relax domain for `role:'driver'` invites **(with token-enforced accept — D15)**; `GET /api/me/driver`; `POST /api/me/fillups` (narrow input, server-derived identity, audited, rate-limited, scores server-side); optional `GET /api/me/performance`; **`revokeDriverAccess()` offboarding action (D14)**.
- Web: role guard redirecting `driver` away from the dashboard.
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

---

## §18. Build Log (append a row when a phase is built/verified)

| Date | Phase | Commit(s) | Verification tally | Notes |
|---|---|---|---|---|
| — | — | — | — | *(no build yet — planning only)* |

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

### §22.1 Navigation shell & information architecture (D17)

The core is **one action (log a fill-up)** plus a few sections. Adopt a **bottom tab bar with an elevated
center capture action** — the Dasher/Instagram/Samsara pattern — so the 80% action is one thumb-tap from
anywhere and future features grow behind **More** without re-teaching the bar.

```
┌──────────────────────────────────────────────┐
│  HOME (glance): vehicle · next action · sync  │
│  reminders · My Score summary                 │
└──────────────────────────────────────────────┘
 ┌───────┬────────┬─────────┬────────┬─────────┐
 │ Home  │  Fuel  │ ┌─────┐ │ Score  │  More   │
 │  ⌂    │  Log ▤ │ │⛽ +│ │  ★     │  ⋯      │
 │       │        │ └─────┘ │        │         │
 └───────┴────────┴─────────┴────────┴─────────┘
              elevated center = full-screen modal capture
```

- **v1 tabs:** Home · Fuel Log · **(center) Log Fill-Up** · My Score · More. (Even if My Score ships in
  v1.1, reserve the slot now — deciding the bar later *is* the redesign we're avoiding. Cap the bar at ~5.)
- **Capture is not a tab** — it's a full-screen **modal route** presented over the shell (native sheet
  physics), so it focuses the task and covers the tab bar during entry.
- **More = the roadmap parking lot:** Training, HazmatGuard, Fueling/Nav land here first, plus Settings,
  vehicle details, support. Promote to a tab only once daily-use.

**expo-router structure (route groups):**

```
app/
  _layout.tsx                 root Stack; declares groups + modal routes; auth/onboarding guards
  (auth)/                     sign-in, set-password (PKCE), account-pending, wrong-app
  (onboarding)/               welcome + just-in-time permission priming
  (app)/
    _layout.tsx               <Tabs> shell (Home · Fuel Log · Score · More) + center capture button
    index.tsx                 Home
    fuel-log/ index.tsx, [id].tsx
    score.tsx
    more.tsx
  log-fuel.tsx                presentation:'modal' (capture) — declared at root so it covers the tabs
  receipt/[id].tsx            presentation:'modal' (full-screen receipt viewer)
  settings.tsx                presentation:'modal' (from Home header avatar)
```
Use `Stack.Protected`/guards for auth+role. Settings hangs off the Home header avatar, not a tab.

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
- **No-vehicle-assigned:** an explicit Home state (replaces the vehicle card + CTA with "No truck assigned
  yet — contact your manager") and capture is blocked with the same guidance. **Multi-vehicle:** a
  bottom-sheet/segmented picker with a remembered last-used default.
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
decisions §9 (D1–D40); the audit sections §20–§23 are folded-in provenance (later sections govern where
noted); §10 is the operational checklist. If a truly new question surfaces, resolve it to a LOCKED
decision with a rationale and a fallback in the same style — never leave a "we'll research this during
build" gap. **Net:** nothing in this plan requires a research detour once construction starts.
