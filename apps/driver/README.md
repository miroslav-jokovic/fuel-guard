# FuelGuard Driver App

React Native + Expo app for drivers. Part of the FuelGuard monorepo; reuses `@silvicom/shared`.

**UI contract:** read [`DESIGN.md`](./DESIGN.md) before creating or changing any driver UI. It is the
source of truth for the FuelGuard visual language, Apple-inspired layout rules, component contracts,
states, accessibility, and AI implementation constraints.
The Design System 2.0 redesign track starts with the
[`Phase 1 operating model`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2.md), including
the task hierarchy, compact-density rules, Today templates, research protocol, and decision gates.
Its implemented token and accessibility foundation is recorded in
[`Phase 2 foundations`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-2.md).
The production primitive and screen migrations are recorded in
[`Phase 3`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-3.md) and
[`Phase 4`](../../docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2-PHASE-4.md).
See the full plan: `docs/plans/drivers-app/DRIVER-APP-PLAN.md`.

The app uses a **custom development build** (dev client), not Expo Go — several native modules
(`expo-sqlite` with SQLCipher, `expo-secure-store`, `react-native-reanimated`, worklets, haptics,
…) are not present in the Expo Go binary.

---

## One-time setup

```bash
# 1. From the repo root — pnpm's hoisted linker is required for React Native (root .npmrc pins it).
pnpm install

# 2. macOS only — install watchman so Metro doesn't fall back to a slow full-tree crawl every start.
brew install watchman

# 3. Build the shared package to dist. `pnpm start` / `android` / `ios` do this automatically;
#    this line is just for the very first install.
pnpm --filter @silvicom/shared build:rn

# 4. Align every Expo/RN dependency to the exact versions Expo SDK 57 expects.
cd apps/driver
npx expo install --fix

# 5. Copy .env.example to .env and fill in EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY.
#    Leave EXPO_PUBLIC_API_URL at its default (http://localhost:8080) — the dev scripts handle the
#    port forwarding automatically. Only change it for iOS devices testing over wifi (see below).
cp .env.example .env
```

---

## The commands you'll actually run

All commands assume you're at the repo root. Under the hood, every one of these runs
`driver-doctor.mjs` first — a 14-check preflight that catches the class of problems that used to
turn into "Metro is stuck" or "app crashes with 'Cannot find native module'" on the device. Run
`pnpm driver:doctor` on its own to see what it checks and what it found.

### Physical Android device connected by USB (the enterprise path)

```bash
# ── First time on this device, or ANY time apps/driver/package.json's native deps changed:
pnpm driver:android
# → doctor → build shared → adb reverse ports → build & install a fresh dev-client on the device
#   → start Metro. Takes 3–5 minutes for the native build; that's expected.

# ── Every other time (JS-only changes):
pnpm driver:start:usb
# → doctor → build shared → adb reverse ports → start Metro pinned to localhost only.
#   Reload the app on the device (shake → Reload) to pick up your JS changes.
```

**Why `adb reverse` is the enterprise-grade choice, not a workaround:** `adb reverse tcp:8081
tcp:8081` makes the connected phone treat your Mac's `localhost:8081` as its own — Metro is
reachable regardless of wifi network, wifi disconnect, coffee shop guest wifi, or IP-lease changes.
The `adb:reverse` script forwards ports 8081 (Metro), 8080 (API), and 54321 (Supabase local, if
you use it) in one go. It's what the Android team at every major RN shop uses; it's not a hack. If
`adb devices` shows no device, plug the cable in and accept the RSA fingerprint on the phone.

### Physical iOS device connected by USB

```bash
# ── First time on this device, or any time apps/driver/package.json's native deps changed:
pnpm driver:ios
# → doctor → build shared → build & install a fresh dev-client on the device via Xcode.
#   Requires you to have configured a signing team in Xcode once (open apps/driver/ios/*.xcworkspace).

# ── Every other time (JS-only changes):
pnpm driver:start
# → doctor → build shared → start Metro on the LAN.
#   The iOS device MUST be on the same wifi as the Mac. Reload the app to pick up JS changes.
```

**iOS-specific: there is no `adb reverse` equivalent.** iOS Simulator can use `localhost`; iOS
device cannot. Two ways to make wifi reliable:

1. Standard enterprise setup: a dedicated 2.4 GHz dev SSID that both the Mac and the iPhone
   auto-join. No client isolation. If your office wifi has client isolation on, your device won't
   see Metro even on the "same" network.
2. If you must test on cellular / off-wifi, you're in tunnel territory — but at that point you're
   fighting the platform. Prefer wifi.

For a dev iPhone that lives at your desk, method 1 is the answer and stays reliable indefinitely.

### Simulators / emulators (fastest iteration)

```bash
# Android emulator — needs adb reverse for the API to be reachable at localhost.
pnpm driver:start:usb    # same script; `adb reverse` also works against a running emulator.

# iOS simulator
pnpm driver:start        # localhost works natively in Simulator.
```

### When things go wrong

```bash
pnpm driver:doctor              # 30-sec preflight; run this FIRST when anything is odd.
                                # Its 14 checks include: port 8081 taken, dev client out of date,
                                # stale shared build, iCloud-evicted node_modules files,
                                # cloud-sync conflict copies, missing watchman, dirty xattrs, etc.

pnpm --filter @silvicom/driver clean    # Nuclear reset: removes ios/build, android/build,
                                          # android/.gradle, .expo, node_modules/.cache; deletes
                                          # watchman state. Follow with `driver:android`/`ios`.

bash apps/driver/scripts/metro-bisect.sh # Isolate Metro startup hangs to one of 4 config layers
                                          # (no config / no NativeWind / current / pre-today).
                                          # Only reach for this when Metro won't start at all.
```

---

## What causes "works on emulator, fails on cable device" — the two real culprits

1. **Dev-client binary drift.** The `.apk` / `.ipa` on the physical device was built against an
   older `package.json`. You then added or updated a native module and the emulator got a fresh
   build (because you re-ran `expo run:android` for the emulator), but the device still has the
   old binary that doesn't contain the new module. The JS bundle imports it, the app crashes on
   load with `Cannot find native module 'X'`. **`driver-doctor.mjs` check #11 catches this** by
   comparing `ios/Podfile.lock` against `apps/driver/package.json` — this is why the scripts above
   run doctor before every native build.

   **Fix:** `pnpm driver:android` (or `driver:ios`) — that command rebuilds the native binary and
   installs it to the device, which is the only way to update the on-device dev client.

2. **Metro URL / API URL mismatch.** The device tried to reach Metro or the API at an address it
   can't resolve. On Android USB with `adb reverse`, this never happens. On iOS device, this means
   the phone is on a different wifi than your Mac, OR the office wifi has client isolation, OR
   `.env`'s `EXPO_PUBLIC_API_URL` is set to a stale IP.

   **Fix:** either the `adb:reverse` script (Android) or same-wifi with a correct LAN IP in `.env`
   (iOS).

Everything else — dead port 8081 waiting for a "use 8082?" prompt, iCloud-evicted files in
`node_modules`, cloud-sync conflict copies, stale git locks, sync-folder curses — is caught
proactively by `driver-doctor.mjs`.

---

## Token discipline

Every color comes from a **semantic role** (`bg-surface`, `text-ink`, `border-edge`, `bg-brand`…)
defined in `global.css` + `tailwind.config.js`. Raw hex, raw palette classes (`bg-red-500`), and
inline color styles are **rejected** by `pnpm --filter @silvicom/driver lint:tokens`. Only
`src/theme/*` may hold raw color values.

---

## Notes

- `packages/shared/dist/` is git-ignored; it's a build artifact (rebuild with `build:rn` — the
  driver scripts do this for you).
- No secrets in `app.config.ts` `extra` — only `EXPO_PUBLIC_*` values (plan §12.5 / §21).
- The app is **not yet wired into root `eslint .`** — run `pnpm --filter @silvicom/driver
  typecheck` and `... lint:tokens` for now.
