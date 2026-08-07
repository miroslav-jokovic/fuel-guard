# Driver App — Release Gate

**The repeatable check that must pass before any driver-app release.** Phase 9 of the hardening
plan. Run Gate A on every commit (CI does), Gates B–D before shipping a build to drivers.

Nothing here is aspirational: every automated item runs today, and every manual item names the
exact steps and the pass criterion. If a check cannot be run, it is marked **BLOCKED** with the
reason rather than assumed passing — that habit is what this phase exists to enforce (see
*Findings*, below, for what the previous absence of it cost).

---

## Gate A — automated (CI, every commit)

```bash
pnpm typecheck && pnpm lint && pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm test
```

`pnpm test` now runs `pnpm -r test` **and** `pnpm test:rls`. As of 2026-08-07 `test:rls` runs **all
four** behavioural matrices, with these real, executed counts:

| Matrix | Assertions | What it proves |
|---|---|---|
| `rls.test.mjs` | **159** | Tenant + driver RLS: who can read and write what. |
| `hazmat_rls.test.mjs` | **16** | Hazmat module gating and driver scope. |
| `load-lifecycle.test.mjs` | **42** | The transition guard, its approval gates, and the four driver RPCs. |
| `duty-sessions.test.mjs` | **20** | Shift open/close, equipment segments, take-over. |

The last two had **never executed**. They referenced three migration filenames that never shipped
(`0083_driver_identity`, `0084_driver_scoped_rls`, `0016_vehicle_fuel_level`) and aborted on load,
while this document and the ledger quoted "42/42" and "20/20" as though they had passed. Both counts
turned out to be honest — but only after **six behaviours the matrices specified were found to be
unimplemented** and built (migrations 0141–0143). Two of those were live defects: the driver load RPCs
and the duty-session error codes both had contracts the API could never have satisfied.

If a matrix count in this table changes, the change is either a new assertion or a regression. There
is no third possibility, and that is the point of writing the numbers down.

| Check | What it actually proves |
|---|---|
| `typecheck` | shared · api · admin-api · driver (tsc) and web · admin (vue-tsc) all compile. |
| `lint:boundaries` | Feature isolation holds; hazmat packages stay dependency-free; the engine stays deterministic; **sample data is importable only by the dev gallery** (the real-data guarantee). |
| `lint:tokens-parity` | Design tokens stay in step across web + driver. |
| `pnpm -r test` | Unit suites. Driver-app-relevant: `driverContract` (bootstrap `modules`/`features` are required — the regression guards), `featureCatalog` (the resolver's prerequisite / no-widening / released-axis / core.app-pin properties), `check-in-model` (the wizard), `deep-link` (notification routing is total and closed over app routes), plus shared/api/web suites. |
| `routeAuth.test.ts` | **Fitness function.** Discovers every `/api` router mounted in `app.ts` and asserts each 401s unauthenticated. A new router wired without auth fails CI automatically. |
| `test:rls` → `rls.test.mjs` | 158 assertions over a real Postgres (PGlite) as a **non-privileged role** — the only way RLS is genuinely exercised. Covers tenant isolation, driver scoping, the load-lifecycle gate, duty sessions, entitlements, notifications, **the driver-app control plane (0134)** and **messages participation (0096)**. |
| `test:rls` → `hazmat_rls.test.mjs` | 16 assertions: hazmat module gating + storage path scoping. |

**Definition of done for Gate A:** every command exits 0, and `rls.test.mjs` prints
`RESULT: 158 passed, 0 failed` (the number rises as cases are added; it must never fall).

---

## Gate B — device matrix (before shipping a build)

Run on a physical Android device (min-spec is the one that matters) and, when the iOS build
exists, an iPhone. Each row: do the steps, confirm the criterion.

### B1 · Cold start and the offline spine
1. Airplane mode ON, force-quit, relaunch → **Home renders real cached data, not spinners** (the persisted query cache).
2. Still offline: check in, complete a stop, capture a hazmat BOL, send a message → each queues; **Settings → Data shows the pending count**.
3. Force-quit and relaunch while still offline → **the queue survives** (SQLCipher outbox on disk).
4. Airplane mode OFF → **queue drains, count returns to 0, no duplicates** anywhere (idempotent on client UUIDs).
5. Settings → Data → the SQLCipher warning is absent → **the outbox is encrypted**.

### B2 · Check-in wizard (the Phase 1 fix — regression-critical)
1. Home → *Start your day* → type a unit number in search → tap the truck → **you land on the trailer step**. (This is the reported defect; it must never regress.)
2. On the trailer step, type a query matching nothing → **an empty state appears** ("clear the search, or go bobtail") — never a blank list.
3. Back → **the truck selection is preserved**.
4. Pick a truck already held by another driver → **the take-over sheet names who holds it and since when**; confirm → advances.
5. Dashboard → set *Odometer* to **required** → reopen check-in → **Start my shift stays disabled until a valid reading is typed**. Set to **off** → the field is gone.
6. Dashboard → turn *Equipment take-over* off → tap a held unit → **an explanatory notice, no take-over sheet**.
7. The primary button is **pinned at the bottom** with the keyboard up.

### B3 · Dashboard control plane (the Samsara model, end to end)
1. apps/admin → the customer → **Entitlements** → grant `hazmatguard` → web → Settings → Driver App → the Hazmat row is no longer "Not in your plan".
2. Toggle *Driver score* off → pull-to-refresh Home → **the Score tab AND Home's weekly tiles disappear together** (never half-off). Toggle back.
3. Toggle *Loads* off → **the Loads tab and Home's assignment section both go**.
4. Per-driver exceptions → disable *Hazmat checks* for this driver with a note → **the More entry disappears for them only**; remove it → returns.
5. Set *Minimum version* above the installed build → relaunch → **the blocking update screen**; clear it → normal. (Queued offline work must still be intact afterwards.)

### B4 · Hazmat (needs `hazmatguard` granted + the driver's certifications entered in web → Compliance)
1. More → *Hazmat checks* → **Capture BOL** → photograph a real BOL → a bad shot is **rejected with a plain-language reason** (blur/glare/cut-off), not silently accepted.
2. A good shot → verdict screen → outcome with **CFR citations**.
3. Leave, relaunch, reopen More → Hazmat → **the check is still in history** and reopens (the Phase 3 fix).
4. Offline capture → reconnect → **submits exactly once**.

### B5 · Notifications
1. Bell on Home → centre opens; rows carry time + unread state.
2. Tap a hazmat-verdict notification → **it opens that verdict**, not Home (deep-link translation).
3. Mute a category → **it stops arriving**; the safety-critical ones (`load_canceled`, `system`) are **locked, not mutable**.
4. Sign out → sign in as another driver on the same device → **no notifications from the previous driver** (token revoked on sign-out).

### B6 · Messages
1. Home mail icon → *Message dispatch* → send → web → Messages → **it appears in dispatch's inbox**.
2. Reply from web → **it reaches the device** (realtime) and the unread badge increments.
3. Airplane mode → reply → reconnect → **sends once**.
4. Long-press a received message → **report flow** with reasons.
5. Web → compose to 3 drivers → **each gets a private thread**, and any driver without an app account is **reported, not silently dropped**.

### B7 · Presentation and accessibility
1. Light and dark, in direct sunlight if possible → **text legible, status never conveyed by colour alone**.
2. OS font size at maximum → **no clipped or overlapping text** on Home, check-in, stop capture.
3. TalkBack (Android) / VoiceOver (iOS) through Home → check-in → stop capture → **every icon-only control announces a label**; tab bar announces selected state.
4. Every primary action reachable **one-handed, gloves-on** (44pt+ targets, pinned footers).

---

## Gate C — DCE-0 hardware checks (hazmat capture, once per native change)

1. **No-egress:** capture a network trace on the device during a scan + OCR. **ML Kit must make no outbound request** — BOLs are PII and the capture engine is specified as on-device.
2. **OCR latency + confidence** on the min-spec Android: record both. Confidence is secondary in the quality gate; latency drives whether drivers will actually use it.
3. Native module builds cleanly via `expo prebuild` on both platforms.

---

## Gate D — store readiness

| Requirement | State |
|---|---|
| In-app account deletion (Apple 5.1.1(v)) | ✅ built — Settings → Delete account, with confirmation |
| UGC report affordance (Apple 1.2) | ✅ built — long-press a received message → report, audited |
| Camera permission string | ✅ declared, purpose-specific (proof-of-work photos) |
| Photo-library / microphone | ✅ deliberately NOT requested (least privilege) |
| Location permission string | present for the deferred nav programme — **confirm it is not requested by a build that ships without navigation** |
| Push permission | requested only when the `notifications` feature is on |
| Privacy labels (camera, photos, push token, coarse identifiers) | ☐ **owner action** — fill from the above before submission |
| Crash reporting discloses no PII | ✅ shared scrubber (`sentryScrub`), user reduced to id; verify once with a real DSN by triggering a test crash and inspecting the event |

---

## Findings from the first Phase 9 run (2026-08-07)

Recorded because the *absence* of a working gate is what allowed them, and the ledger had been
quoting pass counts for a suite that could not execute.

1. **The RLS matrix could not run at all — and had not for months.** It referenced two migrations
   under names they never shipped with (`0083_driver_identity` / `0084_driver_scoped_rls` vs the
   actual `_rls_matrix` / `_rls_writes`), so it aborted before its first assertion. Behind that:
   an under-shimmed `storage.buckets`, a missing `storage.foldername()`, a missing `service_role`,
   and load fixtures that inserted a status the D45 approval gate now forbids. All repaired; the
   suite runs green (158) and is now wired into `pnpm test`, so CI holds it.
2. **Driver fuel-write gap (fixed — migration 0135).** `0084` narrowed driver inserts on
   `fuel_transactions` to "your own driver_id" and stopped there. A driver JWT could insert a fill
   on **any** truck with **any** `source`, including `'efs_feed'` — poisoning MPG, idle and score
   attribution and able to paper over exactly what theft detection looks for. Since D41 removed
   manual fuel logging from the app (verified: `apps/driver` has zero `fuel_transactions`
   references), the fix denies driver inserts outright, matching 0084's own stated pattern for a
   pathless table.
3. **Two of the "three F4 leaks" were never actually closed (fixed — migration 0136).** The 0086
   ledger entry records trailers + `driver_time_off` + `tms_movements` as closed; only `trailers`
   shipped a policy. Any driver could read **every colleague's time-off calendar** and the org's
   **whole TMS movement feed**. Both now driver-scoped (own rows / denied).
4. **An ended shift did not have to say why (fixed — 0136).** `ended_reason` had its values
   constrained but never its presence, so a shift could be closed with no reason — defeating the
   documented guarantee that an auto-close stays distinguishable from a real sign-off. Added as a
   `not valid` CHECK so it binds all new writes and grandfathers history.
5. **A router escaped the auth fitness function (fixed).** `/api/me/notifications` was mounted as
   `app.use(path, requireAuth, router())`; the detector's pattern required the factory to follow
   the path immediately, so the mount was invisible and the router was never auth-tested. The mount
   now uses the house shape (auth applied inside the router) **and** the detector was widened so no
   middleware-in-between mount can hide again.

**Still BLOCKED in this environment (not assumed passing):** vitest cannot execute here (the
checkout's native bindings are macOS; this VM is Linux), so `pnpm -r test` is Devon's Mac step.
Gates B–D require a device and are unrun.

---

## Sign-off

| Gate | Run by | Date | Result |
|---|---|---|---|
| A — automated | | | |
| B — device matrix | | | |
| C — DCE-0 hardware | | | |
| D — store readiness | | | |
