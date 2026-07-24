# FuelGuard Driver App

React Native + Expo app for drivers. Part of the FuelGuard monorepo; reuses `@fuelguard/shared`.
See the full plan: `docs/plans/drivers-app/DRIVER-APP-PLAN.md`.

## Phase 0 — Foundation (build spike)

This scaffold is the **spike** that de-risks the three integration points the plan flags as blockers
before we build the full component gallery:

- **B2** — `@fuelguard/shared` consumed through Metro (via its built `dist`, not raw `.ts`). ✅ already
  verified in CI/cloud: the build emits a working `dist/index.js` + `.d.ts`.
- **B3** — pnpm's hoisted `node_modules` works with Metro + native autolinking.
- **B6** — zod 4 runs on Hermes on a real device.

### One-time setup

```bash
# 1. From the repo root — hoisted linking is required for RN (a new root .npmrc was added).
pnpm install

# 2. Build the shared package to dist (Metro consumes this; re-run whenever shared changes).
pnpm --filter @fuelguard/shared build:rn

# 3. Align every Expo/RN dependency to the exact versions Expo SDK 57 expects.
#    (The package.json pins are approximate; this reconciles them.)
cd apps/driver
npx expo install --fix

# 4. Create a development build (Expo Go can't load our native modules).
#    Requires an Apple/Google dev account for a device build, or run a local prebuild:
npx expo prebuild            # generates ios/ + android/
#   then either:
npx expo run:ios             # needs Xcode + a simulator/device
npx expo run:android         # needs Android SDK + an emulator/device
#   or build via EAS:
#   eas build --profile development --platform ios   (or android)
```

### Run

```bash
cd apps/driver
pnpm start          # Metro dev server; open the dev build on your device
```

### ✅ Spike success criteria

On a physical device (iOS **and** Android), `app/index.tsx` should show:

1. **"$3.00/gal"** — proves `@fuelguard/shared` math ran through Metro (**B2**).
2. **"fillUpInputSchema.safeParse → valid ✓"** + the roles list — proves shared **Zod on Hermes** (**B6**).
3. Themed cards/buttons that flip between **light and dark** when you tap the toggle — proves the
   NativeWind token pipeline.

If all three hold on both platforms, Phase 0's spike passes and we build out the full component gallery,
token linter CI wiring, and tests.

### Notes / expected follow-ups

- Version pins in `package.json` use `*`/approximate ranges on purpose — `npx expo install --fix` sets
  the SDK-57-correct versions. Commit the updated lockfile after.
- The app is **not yet wired into root `eslint .`** — its type-aware ESLint config lands in the next
  increment. Run `pnpm --filter @fuelguard/driver typecheck` and `... lint:tokens` for now.
- `packages/shared/dist/` is git-ignored; it's a build artifact (rebuild with `build:rn`).
- No secrets in `app.config.ts` `extra` — only `EXPO_PUBLIC_*` values (plan §12.5/§21).

### Token discipline

Every color comes from a **semantic role** (`bg-surface`, `text-ink`, `border-edge`, `bg-brand`…) defined
in `global.css` + `tailwind.config.js`. Raw hex, raw palette classes (`bg-red-500`), and inline color
styles are **rejected** by `pnpm --filter @fuelguard/driver lint:tokens`. Only `src/theme/*` may hold raw
color values.
