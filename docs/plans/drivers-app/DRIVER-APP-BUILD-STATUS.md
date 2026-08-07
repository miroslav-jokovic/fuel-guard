# Driver App Hardening — Build Status

**Rewritten every session. "Where are we" — the spec is `DRIVER-APP-HARDENING-PLAN.md`, decisions in
`DRIVER-APP-DECISIONS-2026-08-07.md`, findings in `DRIVER-APP-AUDIT-2026-08-07.md`.**

## Position — 2026-08-07 (5)

**All nine phases of the hardening plan are BUILT.** The driver app is functionally complete except
the Loads module (a dashboard toggle away when it ships), with enterprise ops and a repeatable
release gate in place. Typecheck clean across shared · api · admin-api (tsc) and web · admin
(vue-tsc); `lint:boundaries` green. Driver tsc has exactly FIVE expected errors — the new
`expo-notifications` and `@sentry/react-native` dependencies aren't installed yet; all clear with
`pnpm install` on the Mac. Phase 0 (Mac unblock) was run by Miki.

| Phase | State | Key artifacts |
|---|---|---|
| 1 — Check-in wizard | ☑ built | `checkInModel.ts` (pure, 14 tests) + rebuilt `duty/check-in.tsx`; per-step search, auto-advance, empty states, pinned footer (`Screen` `footer` slot), take-over kind fix, recent-first ranking (`lastEquipment.ts`) |
| 2 — Real-data guarantee | ☑ built | Navigate tab removed (D52; route = dev-only seam), gallery `__DEV__`-gated, `RoutePreview` deleted (in `_to_delete/`), boundary linter enforces sample-data = gallery-only |
| 3 — Hazmat standalone route | ☑ built | `GET /api/me/hazmat/loads` (list) + `app/hazmat/index.tsx` hub (capture + re-findable history), More entry gated, modal Stack declarations |
| 4 — Feature system | ☑ built | Migration **0134** (`driver_app_features` + overrides, RLS-on/zero-policy) · shared `featureCatalog.ts` (catalog + ONE pure resolver, tested incl. no-widening + prerequisite props) · resolved `features` on the bootstrap (required contract field, like `modules`) · app consumption: tab blocks (loads/score + Home sections together), hazmat gate, `duty.odometer` / `duty.takeover` config, `core.app` min-version blocking screen (fails open) |
| 4.1 — Entitlement regression | ☑ fixed | `modules` restored on `GET /api/me/driver`; contract field REQUIRED (the old `.default([])` masked the regression); tests pin it |
| 5 — Dashboard control | ☑ built | API `/api/driver-app/*` (settings: fleet-manage; overrides: dispatch-manage incl. dispatcher — D-PM6; config validated vs catalog; unreleased keys rejected; all audited) · web **Settings → Driver App** page (module grouping, "Not in your plan" states, odometer selector, min-version card, per-driver exceptions) · admin-api + admin **Entitlements** (org_modules grant/revoke, dual-audited); old "Modules" card renamed **Integrations** |

| 6 — Notifications | ☑ built | Router MOUNTED at `/api/me/notifications` (was dead code) · `startNotificationPushScheduler` (60s Expo Push delivery loop — `deliverPending` finally has a caller) · producers added: `duty_auto_closed` (sweeper, dedupe-keyed per session) + `performance_week` (snapshot freeze, dedupe-keyed per week+driver); load/message/hazmat producers were already wired · D-PM7 org governance in `notify()` (feature row can kill the channel or pin categories; fail-open) · app: Home bell + unread badge, centre screen (list, mark-read, category mutes with NON_MUTABLE lock), push registration/revocation (revoke-first sign-out + delete), tap → deep link via `resolveDeepLink` (total, closed over app routes — tested) · `notifications` flipped `released: true` |

| 7 — Messages | ☑ built | Backend was already complete (audience resolution, participation RLS, realtime publication, notify producer) — Phase 7 built the two UIs. **Web dispatch inbox** (`/messages`, D-PM4 Samsara model): thread list + conversation pane, compose-to-one-or-MANY (one private thread per driver, partial-failure reported), Seen/Sent receipts, 90-day window, no delete; nav item + unread badge in the Dispatch group. **Driver app**: inbox + thread screens (modal), outbound via two new outbox kinds (`message_thread_create` / `message_send`, client-UUID replay-safe, optimistic cache), inbound via Supabase Realtime with the 60s poll as fallback, long-press REPORT with the shared reason vocabulary (Apple 1.2), Home top-bar Messages button with unread badge, `resolveDeepLink` now routes `/messages/*` live. `messages` flipped `released: true` |

| 8 — Enterprise polish | ☑ built (scoped) | **Crash reporting**: PII scrubber PROMOTED to `@fuelguard/shared` (one implementation for API + app; API path kept as a re-export shim so nothing moved for its callers/tests) · driver `lib/crash.ts` — JS-layer Sentry init, no-op without `EXPO_PUBLIC_SENTRY_DSN`, errors-only, `sendDefaultPii:false`, user = id only, release-tagged; wired first in `_layout` module load + user set/cleared on session change. Native crash capture + sourcemaps deliberately deferred to the EAS plugin step (below) so an unconfigured plugin can never break prebuild. **OTA**: `expo-updates` dep + `runtimeVersion: appVersion` policy (inert until `eas update:configure`). **UX**: pinned ActionBar footers adopted on end-shift and stop-capture (check-in already had it) — every task screen's primary action now reachable without scrolling. **DEFERRED, honestly**: the D-PM2 telematics odometer cross-check (assignments board lacks session-vehicle + odometer data; needs a contract + query + UI slice — backlogged for Phase 9/next, not half-built) |

| 9 — Verification & release gate | ☑ built | **Repaired the offline RLS matrix, which had been un-runnable for months** (stale migration filenames, under-shimmed storage schema/`foldername()`/`service_role`, load fixtures using a status the D45 gate forbids) — it now runs green at **158/0** and is WIRED INTO `pnpm test`, so CI holds it. Added Phase-9 coverage: the 0134 control plane (nobody in-tenant reads or writes it — not even the org's admin; no driver self-grant) and messages participation (a manager outside a thread reads nothing; no self-join; no forged sender). **Three real security/integrity findings fixed** — `0135` driver fuel-write gap (any truck, any `source` incl. `efs_feed`), `0136` `driver_time_off` + `tms_movements` read leaks that 0086's ledger claimed were closed but never were, plus the ended-shift-needs-a-reason invariant. **Closed a fitness-function blind spot**: `/api/me/notifications` was invisible to the route-auth test (middleware between path and router); mount normalised + detector widened. Deliverable: `RELEASE-GATE.md` (Gate A automated · B device matrix · C DCE-0 hardware · D store readiness) |

## Required actions before live (owner: Miki, Mac)

1. Apply migrations **0134**, **0135**, **0136** (all additive; 0133 already applied). 0135/0136
   are the Phase-9 security fixes — apply them with the rest, they are not optional.
2. `pnpm install` — links the new `expo-notifications` dep (clears the 2 expected driver tsc errors),
   then `npx expo install --fix` in `apps/driver` to pin the SDK-exact version, then
   `expo prebuild` + `expo run:android` (new native module).
3. `pnpm test` — now also runs both RLS matrices (`pnpm test:rls`). New unit suites:
   `driverContract`, `featureCatalog`, `check-in-model`, `deep-link`. The RLS matrix must print
   `158 passed, 0 failed`; vitest could not be run in the cloud VM (macOS native bindings), so this
   is its first real execution.
4. **Push prerequisites (in-app centre works WITHOUT any of this — poll is the fallback):**
   EAS projectId in `app.config.ts` (`extra.eas.projectId`) or push-token minting is skipped
   (logged, non-fatal); Android FCM credentials via EAS for real device push.
5. Device pass: check-in wizard (search→select→trailer flow, take-over, both odometer configs),
   hazmat hub end-to-end (needs `hazmatguard` entitlement row + driver certifications in Compliance),
   feature-toggle flip observed live, bell + centre + a hazmat verdict notification arriving.
6. Optional for testing per D-PM1: Settings → Driver App → toggle **Loads** off org-wide.

## Verification state (honest)

- Typecheck clean everywhere touched; vitest NOT run in the cloud VM (native-binary limitation) —
  run on the Mac.
- RLS-matrix additions for the 0134 tables (raw-PostgREST deny, every role) are AUTHORED AS A NOTE
  in the migration header but not yet added to the matrix test files — Phase 9 item.
- The route-auth fitness test auto-discovers `/api/driver-app` (same mechanism as `/api/dispatch`);
  confirm it asserts 401 on the Mac test run.

## Owner (Mac / EAS) steps added by Phase 8

- `pnpm install` (clears all 5 expected driver tsc errors), then prebuild/run (expo-updates +
  sentry native modules are new).
- Sentry: create the project, set `EXPO_PUBLIC_SENTRY_DSN` in `.env`/EAS — until then crash
  reporting is a silent no-op. For native crash capture + sourcemaps later: add the
  `@sentry/react-native/expo` config plugin with org/project + `SENTRY_AUTH_TOKEN` on EAS builds.
- OTA: `eas init` + `eas update:configure` (adds the updates URL; runtimeVersion policy is already
  set).
- Repo litter still present (bridge can't delete): `rm -rf _probe.txt _probes _tmp_6_*`.

## Next

- **Run the gate.** `docs/plans/drivers-app/RELEASE-GATE.md` — Gate A is automated (CI); Gates B–D
  need a device and an owner. Nothing ships until B–D are signed off.
- Backlog: D-PM2 telematics odometer cross-check (assignments board slice), stale-data chips,
  Home off-duty CTA emphasis, validating `duty_ended_needs_reason` after a data check.
- Remaining unreleased blocks: `training` (Phase 7 of the master plan) and `nav.preview`
  (the navigation programme).
