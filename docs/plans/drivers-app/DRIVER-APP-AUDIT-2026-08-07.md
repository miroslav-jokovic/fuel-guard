# FuelGuard Driver App — State Audit & Fix Plan (2026-08-07)

Scope: `apps/driver` analyzed against `docs/plans/drivers-app/DRIVER-APP-PLAN.md` (the master plan,
D41–D56), `docs/HAZMATGUARD-STATUS.md`, and the HazmatGuard reference build. Goal per Miki: **a fully
functional drivers app except the Loads module, with hazmat reachable on its own route for testing**
(decoupled from Loads until Loads is finished).

---

## 1. What is currently built and working

### Solid — wired to real APIs, offline-safe, done

| Area | State |
|---|---|
| **Foundation / design system** (Phase 0) | Complete. ~30 components, tokens, light/dark theme, Hanken Grotesk, HugeIcons adapter, custom TabBar, component gallery. |
| **Auth & identity** (Phase 1) | Complete. Sign-in, accept-invite (multi-step, paste-link rescue), pending, wrong-app, session state machine, root routing guard, Settings with sign-out + delete-account. |
| **Offline data spine** (Phase 2) | Complete and well-engineered. Persisted React Query cache (cold start in airplane mode renders real data), SQLCipher-encrypted outbox, serial sync engine with retry policy + dead-letter ("Needs attention"), file staging for photos, DB corruption recovery (tested), OfflineBanner/SyncStatus UX. |
| **Duty / equipment** (3A + 3C) | Complete. Check-in (start/swap modes), take-over confirmation ("never a silent steal"), bobtail, odometer, end-shift, duty card on Home and More — all on real `/api/me/shift|equipment` through the outbox. |
| **Score** (Phase 5) | Complete. `GET /api/me/score` (real, not sample data), ring + sub-score sparklines + coaching line, ineligible-week handling; Home "This week" tiles read the same cache. |
| **Loads driver screens** (3C) | Built on real `GET /api/me/loads`: list (Upcoming/Current/Previous), detail with accept/decline/start, stop-capture with photo slots + skip reasons — all outbox-queued and idempotent. Functional but tied to the unfinished Loads/dispatch module — explicitly out of scope for this pass. |
| **Hazmat capture vertical** (M6, code-complete) | Capture engine (`@fuelguard/capture-engine`) with §5 quality gate, native scanner module + JS fallback, capture screen → outbox (`hazmat_capture`, replay-safe create→register→upload→submit) → verdict screen polling `/api/me/hazmat/loads/:id/runs` with CFR citations. All typechecked; unit tests exist. |

### Key architectural fact for your ask

**Hazmat is already decoupled from the Loads module at the data level.** `app/hazmat/capture.tsx`
creates the driver's **own** hazmat load via `POST /api/me/hazmat/loads` (driver_id forced to caller,
driver-scope RLS 0092) — it does not touch dispatch loads, `useLoads`, or the load lifecycle at all.
The only "coupling" left is cosmetic (a `hazmat` badge on load cards) and the fact that **nothing in
the UI links to the hazmat screens**. So the separate-route work is small.

---

## 2. Gaps and defects — what to fix

### A. Hazmat standalone route (your explicit ask) — small, high-value

1. **No entry point anywhere.** No screen navigates to `/hazmat/capture`. The More tab shows
   "HazmatGuard — Soon" as a dead row with no `onPress`. The two hazmat screens are orphaned routes.
2. **No way back to a verdict.** The API has only `GET /loads/:id` and `GET /loads/:id/runs` — there
   is **no list endpoint** (`GET /api/me/hazmat/loads`). Once the driver leaves the verdict screen
   (or relaunches), the check is unreachable forever. For testing you need a "My hazmat checks"
   history list, which needs that list endpoint first.
3. **Entitlement gating not consumed.** `meDriverResponseSchema` already carries `modules` (D55),
   but the app never reads it — the hazmat entry should show/hide on the `hazmatguard` module (with
   the server-side `org_module_enabled` gate as the real boundary, which is already in place).
4. **Hazmat routes not declared in the root Stack** (`app/_layout.tsx`). They work by file
   convention, but get default (push) presentation while every other contextual surface is a modal —
   declare them for consistency.
5. **Single-page capture only.** The scanner supports `maxPages: 10`, but `decideCapture` uses
   `pages[0]` and the payload posts page 1 only. Fine for testing; flag it so nobody thinks
   multi-page BOLs work.
6. **Test-data prerequisite:** the §5 qualification gate **fail-closes every hazmat load until
   `certifications` are populated** for the test driver (documented in HAZMATGUARD-STATUS). Without a
   roster entry via the web Compliance screen, every capture will come back
   `driver_unqualified:*` / in-review. Seed certifications for your test driver before app testing.
7. Known accepted stub: Ed25519 config verifier is reject-all (bundled config only) — intentional
   fail-closed until Slice E; no action needed for testing.

### B. Navigate tab — sample data presented as real (plan violation)

- `NavigationScreen` shows a hardcoded load ("LD-20481 · Joliet → Columbus"), two hardcoded fuel
  stops, and a hardcoded route polyline (the NP0 map spike). It renders as a **real tab** today.
- The plan explicitly locked this out: **D51 = four tabs** (Home · Loads · Score · More) and **D52 =
  navigation is deferred to its own programme; the center slot is designed-in but NOT rendered**.
  The current 5-tab shell contradicts both the plan and `DESIGN.md`.
- **Fix:** remove `navigate` from the tab bar (keep `navigate.tsx`/`drive.tsx` as the seam per D52),
  or at minimum gate it behind `__DEV__`.

### C. More tab — dead and dev-only rows

- "Design system — Component gallery (dev)" is visible in **production** builds (not `__DEV__`-gated,
  unlike the Settings dev row which is gated correctly).
- Three dead "Coming soon" rows: Training, HazmatGuard, Ask FuelGuard. The HazmatGuard row becomes
  the real entry point (item A); decide whether Training / Ask FuelGuard rows should stay as teasers.

### D. Notifications (5N) — planned, not built; API router is dead code

- Plan D51/D53: top-bar bell + notification centre, push tokens, per-category prefs. **Nothing in
  the app** — no bell, no push-token registration, no centre.
- Backend: migration `0089_notifications.sql` exists and `routes/notifications.ts` is written, but
  the router is **never mounted in `app.ts`** — the entire notifications API is unreachable dead
  code. (The plan's own rationale: without push, dispatch releasing a load is invisible, which
  defeats the approval flow.)
- This is the biggest functional gap for "fully functional except loads."

### E. Messages (5M) — backend live, zero driver UI

- `/api/messages` **is mounted** and migration `0096_messages.sql` exists (threads, participants,
  read state, report endpoint). The driver app has no messages surface at all — no thread list, no
  composer, no outbox kind, no Realtime subscription. Plan D51 puts Messages in the top bar next to
  the bell.

### F. Housekeeping / verification (from HAZMATGUARD-STATUS blockers — all Mac-side)

1. `pnpm install` (links new `@fuelguard/capture-engine` workspace package).
2. Apply migration **0133** to Supabase (0127–0132 already applied).
3. `expo prebuild` + `expo run:android|ios` to compile the native `capture-native` module (it has
   never been compiled anywhere).
4. Run `pnpm test` + web build on the Mac (cloud VM can't — native binary mismatch).
5. DCE-0 on-hardware checks (ML Kit no-egress, OCR latency on min-spec Android).
6. `rm -f .git/index.lock .git/tmp_ci*`.
7. Repo-root litter: `_probe.txt`, `_probes/`, `_tmp_6_*` files should be cleaned up.

---

## 3. Recommended work order

**WS0 — Unblock the build (Mac, ~1 session).** Section F items 1–4. Nothing else is verifiable
until the app runs on a device with the new package + migration.

**WS1 — Hazmat standalone route (the testing ask, small).**
- API: add `GET /api/me/hazmat/loads` (list, created_by = caller, driver scope; id + status +
  created_at + latest outcome).
- App: new `app/hazmat/index.tsx` — "Hazmat checks" hub: primary "Capture BOL" button + history list
  rows → `/hazmat/[loadId]` verdict.
- Wire the More-tab HazmatGuard row to `/hazmat` (drop the "Soon" badge), gated on
  `modules.includes('hazmatguard')` from the driver bootstrap (with a dev override for testing).
- Declare `hazmat/index`, `hazmat/capture`, `hazmat/[loadId]` in the root Stack (modal presentation
  to match the other contextual surfaces).
- Seed `certifications` for the test driver (web → Compliance) so verdicts can actually clear.
- Later, when Loads ships: add the "hazmat step inside the load flow" (plan Phase 6 / D51) on top of
  this same vertical — the standalone route stays as the testing/fallback surface.

**WS2 — Shell alignment (small).** Remove the Navigate tab per D52 (keep files as the seam);
`__DEV__`-gate the gallery row; tidy the Coming-soon rows.

**WS3 — Notifications (medium).** Mount the notifications router; app-side: Expo push token
registration + revocation on sign-out/offboarding, top-bar bell + centre screen, deep links to
load/hazmat/thread. This is the piece that makes the app feel "live" without opening it.

**WS4 — Messages (medium-large).** Driver thread list + thread screen; outbound through the existing
outbox (new kind), inbound via Supabase Realtime with cache-backed fallback poll; bell-adjacent
entry per D51.

**WS5 — Device verification pass.** The plan's outstanding device checklist: cold start offline,
queue → relaunch → reconnect drain, invite flow end-to-end, duty take-over, hazmat capture → verdict
on hardware, light/dark/a11y sweep.

With WS0–WS2 done, the app is honest end-to-end: Home, Duty, Score, Settings, More, and Hazmat all
real; Loads present but understood as in-progress; nothing rendering sample data as if it were live.
WS3–WS4 complete the "fully functional except loads" definition per the plan's own IA (D51).
