# Phase 0 — Foundation & Design System

> Stand up `apps/driver` (Expo/React Native) inside the monorepo, port the FuelGuard design system
> to NativeWind tokens with CI enforcement, wire `@fuelguard/shared`, and ship a themed component
> gallery on a real device.
> Status: **☐ not started** · Depends on: nothing · Blocks: Phase 1
> Parent: [00-DRIVERS-APP-MASTER-PLAN.md](./00-DRIVERS-APP-MASTER-PLAN.md)

---

## Goal & demoable outcome

At the end of Phase 0, a developer can run an Expo **dev build** on iOS and Android and see a
**component gallery** screen rendering the ported design system (buttons, inputs, cards, badges,
stat tiles) in **light and dark**, all colors coming from tokens, with `@fuelguard/shared` imported
successfully and `pnpm typecheck && pnpm lint && pnpm test` (incl. token-lint) green.

No auth, no data, no features — just a correct, themed, monorepo-wired shell. This de-risks the two
things most likely to bite later: the shared-package/Metro wiring and the token discipline.

---

## 1. App scaffold & placement

Create `apps/driver` as an Expo app using **expo-router** (file-based routing; matches the team's
"routes contain no logic" separation).

- Expo SDK: latest stable (SDK 54+), React Native 0.76+ (New Architecture on).
- Package name: `@fuelguard/driver`, `private: true`, `type: module`, Node 22 (repo `.nvmrc`).
- Use a **dev build** (`expo-dev-client`) from day one — not Expo Go — because later phases add
  native modules (camera, secure store, maps/nav) that Expo Go can't load. Establish the
  `eas build --profile development` workflow now.
- Directory shape (from master §3.4):

```
apps/driver/
├── app/                    expo-router screens (gallery in Phase 0)
├── src/
│   ├── theme/              tokens + NativeWind config (ONLY place colors exist)
│   ├── components/         design primitives
│   ├── lib/                (placeholders; filled in later phases)
│   └── features/           (empty in Phase 0)
├── app.config.ts           Expo config (scheme: "fuelguard", dev-client)
├── metro.config.js         monorepo + shared-package transpile (see §4)
├── tailwind.config.js      token config (see §3)
├── babel.config.js         nativewind/babel
├── tsconfig.json           extends ../../tsconfig.base.json
├── eslint.config.js        extends root + RN + token rules
└── package.json
```

---

## 2. Toolchain alignment

- **TypeScript:** extend `tsconfig.base.json` (already `strict`, `moduleResolution: bundler`,
  `verbatimModuleSyntax`). Add RN/JSX libs. Keep `noUncheckedIndexedAccess` etc. — parity with the repo.
- **ESLint:** extend the root flat config; add `eslint-plugin-react`, `react-native`, `react-hooks`.
  Add the **token rule** (§5). Add `apps/driver` to the root `pnpm -r` lifecycle so `pnpm lint`,
  `typecheck`, `test`, `build` include it.
- **Prettier:** inherit root config.
- **Testing:** Jest + `@testing-library/react-native` (or vitest if RN preset cooperates) for
  hooks/components; add a `test` script so `pnpm -r test` covers it.
- **CI:** extend `.github/workflows` so the driver app is typechecked/linted/tested. Native builds
  (EAS) run out-of-band, not on every PR.

---

## 3. Design tokens (the port, by value)

Reproduce the web's three-layer system (`packages/ui/src/tokens.css`) as a NativeWind config. Keep
**FuelGuard's semantic names** — screens never see `indigo`/`red`.

### 3.1 Primitive ramps

Same ramps as web (brand = indigo; `neutral/brand/danger/caution/warning/success/info`). RN target
supports modern color spaces, but for maximum device compatibility **precompute OKLCH → hex** once
in the theme (the ramps are the Tailwind v4 defaults, so hex equivalents are exact). Representative
brand ramp (full tables for every ramp are transcribed into `src/theme/ramps.ts` during build):

| Step | brand (indigo) | Step | neutral (gray) |
|---|---|---|---|
| 50 | `#eef2ff` | 50 | `#f9fafb` |
| 100 | `#e0e7ff` | 100 | `#f3f4f6` |
| 200 | `#c6d2ff` | 200 | `#e5e7eb` |
| 300 | `#a3b3ff` | 300 | `#d1d5db` |
| 400 | `#7c86ff` | 400 | `#9ca3af` |
| 500 | `#6366f1` | 500 | `#6b7280` |
| 600 | `#4f46e5` | 600 | `#4b5563` |
| 700 | `#4338ca` | 700 | `#374151` |
| 800 | `#3730a3` | 800/900 | `#1f2937` / `#111827` |

> The source of truth remains `packages/ui/src/tokens.css` (OKLCH). `src/theme/ramps.ts` is the
> transcribed hex mirror; a small parity test asserts the brand/neutral anchors match the web values
> so the two never silently drift.

### 3.2 Semantic roles (light + dark)

Screens/components use **only** these. Light values mirror web; dark is new (built now for night
driving — the web ships light only but documents the dark plan in `docs/DESIGN-SYSTEM.md §4`).

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

Status roles map to the ramps: `brand`→brand-600, `danger`→danger-600, `caution`→caution-500,
`warning`→warning-400, `success`→success-600, `info`→info-600 (severity: critical→danger,
high→caution, medium→warning, low→neutral — matches `apps/web/src/lib/badges.ts`).

Dark-mode mechanism: NativeWind `dark:` variant driven by `useColorScheme` + a manual override
toggle (drivers may want to force night mode regardless of OS). Both themes point at the **same
ramps**; only role values change — identical to the web architecture.

### 3.3 Scales

- **Radius:** `md 6` (controls), `lg 8` (cards), `xl 12`, `full` (pills/avatars). (Web: `rounded-md`
  controls, `rounded-lg` cards.)
- **Spacing:** Tailwind 4px base; section rhythm `space-y-6` equivalent; card padding `p-5`/`p-4`.
  **Driver ergonomics override:** primary touch targets ≥48pt (gloves/one-hand), above the web's density.
- **Typography:** system font (no bundle). Sizes `xs 12 / sm 14 / base 16`; weights 500/600/700.
  Support Dynamic Type (don't hardcode sizes that break at 200%). Big numerals for glanceable data.
- **Elevation:** `shadow-sm` cards, `shadow-lg` sheets/menus — RN shadow + elevation tokens.

---

## 4. Wiring `@fuelguard/shared` into Metro (the known gotcha)

`@fuelguard/shared` exports raw `.ts` from `src/index.ts` with no build step. Metro must be told to
watch and transpile it:

- `metro.config.js`: set `watchFolders` to the repo root (so Metro sees `packages/shared`), enable
  `resolver.unstable_enableSymlinks`/monorepo node-modules resolution, and ensure the transformer
  compiles TS from the workspace package (Metro handles `.ts` via `@react-native/metro-babel-transformer`;
  the package's `.js`-suffixed ESM specifiers + `moduleResolution: bundler` must resolve — validate
  by importing a pure function).
- **Acceptance:** `import { USER_ROLES, fillUpInputSchema, derivePricePerGal } from '@fuelguard/shared'`
  compiles and runs in the app; a test calls `derivePricePerGal` and `computeFillUpWarnings` and gets
  the same result the web app does.
- **Fallback (only if Metro friction is high):** give `@fuelguard/shared` a real build (tsup → ESM+CJS
  + `.d.ts`) and an `exports` map. Avoid unless needed — it adds a build step to a package that
  currently has none, affecting web/api too. Decide during Phase 0, record the outcome here.

---

## 5. Token enforcement (no hardcoded colors — the guarantee)

Port the web's enforcement so the rule is mechanical, not cultural.

- Add `scripts/check-driver-tokens.mjs` (sibling to `apps/web/scripts/check-design-tokens.mjs`).
  It walks `apps/driver/src` and **fails** on:
  - hex literals `#[0-9a-fA-F]{3,8}` outside `src/theme/` (the token definition dir — the allowlist),
  - raw palette utilities (`bg-|text-|border-|ring-…-(red|indigo|gray|…)-\d+`),
  - inline color styles (`style={{ …color|backgroundColor… }}`).
- Wire as `pnpm --filter @fuelguard/driver lint:tokens` and into CI.
- Escape hatch: a single-line `token-check-disable-line` comment, same as web.
- Parity test: assert `src/theme/ramps.ts` brand/neutral anchors equal the web OKLCH anchors.

This is the operational answer to "avoid inline designs, hardcoded colors, and so on."

---

## 6. Base component set (the gallery)

Build the minimum primitives, matching the web variant taxonomy so the two apps read as one product.
Each is token-only and accessibility-annotated (`accessibilityRole`, ≥48pt targets, focus/press states).

| Component | Variants / props | Web parity |
|---|---|---|
| `Button` | primary / secondary / danger / soft / ghost; sizes sm/md; `block`; loading; disabled | `AppButton.vue` |
| `Input` | text/decimal/number keyboards; invalid state; 16pt text (no zoom) | `AppInput.vue` |
| `Field` | label + required marker + error + hint | `FormField` |
| `Card` | padding md/sm/none; `ring-edge` | `AppCard.vue` |
| `Badge` | tones danger/caution/warning/success/info/brand/neutral; `severityTone` mapping | `badges.ts` |
| `StatTile` | big numeral + label + optional trend (glanceable) | dashboard stat cards |
| `Screen` | safe-area + canvas background + scroll wrapper | `AppShell` layout |

The gallery route renders all of these in both themes and at large Dynamic Type, doubling as a visual
regression surface.

---

## 7. File & work breakdown

| File / area | Purpose |
|---|---|
| `apps/driver/package.json`, `app.config.ts`, `babel.config.js`, `metro.config.js`, `tsconfig.json`, `eslint.config.js` | Scaffold + toolchain + Metro monorepo wiring |
| `src/theme/ramps.ts`, `src/theme/roles.ts`, `tailwind.config.js` | Token definitions (light+dark) — the only color source |
| `src/theme/ThemeProvider.tsx` + `useTheme` | Color-scheme + manual dark override |
| `src/components/*` | Base primitives (§6) |
| `app/_layout.tsx`, `app/index.tsx` (gallery) | Shell + gallery screen |
| `scripts/check-driver-tokens.mjs` | Token linter |
| `src/theme/__tests__/parity.test.ts` | Ramp-parity + a `@fuelguard/shared` import smoke test |
| `.github/workflows/*` | Add driver app to CI lint/typecheck/test |

---

## 8. Exit criteria (all must pass before Phase 1)

- ☐ `apps/driver` runs on an iOS **and** Android dev build; gallery renders in light + dark.
- ☐ `@fuelguard/shared` imports and executes in-app (smoke test passes).
- ☐ Every color traces to a token; `lint:tokens` green; ramp-parity test green.
- ☐ `pnpm -r typecheck && pnpm -r lint && pnpm -r test` include and pass the driver app.
- ☐ Base components accessible (≥48pt targets, labels/roles) and Dynamic-Type safe.
- ☐ CI runs the driver app's checks.
- ☐ This doc updated with: Metro-vs-build decision (§4), the final token tables location, and a
  **verification tally** (e.g. "*Verified: N component tests, ramp-parity green, ran on iOS 18 +
  Android 15 dev builds, typecheck/lint/build/tokens green*").

---

## 9. Risks & mitigations

- **Metro + workspace TS friction** → validated first thing (§4); documented fallback to a shared build step.
- **OKLCH on older devices** → precomputed hex mirror (§3.1) sidesteps it entirely.
- **Token drift web↔mobile** → parity test on ramp anchors; both consume the same OKLCH source of truth conceptually.
- **Expo Go dead-end** → dev-build workflow adopted now, before native modules arrive.

---

## Sources

`packages/ui/src/tokens.css`, `packages/ui/src/components/App{Button,Input,Card}.vue`,
`apps/web/scripts/check-design-tokens.mjs`, `scripts/check-token-parity.mjs`, `apps/web/src/lib/badges.ts`,
`docs/DESIGN-SYSTEM.md`, `packages/shared/package.json`, `tsconfig.base.json`, root `package.json`,
`pnpm-workspace.yaml`; Expo Router / dev-client / NativeWind docs; WCAG 2.2 mobile targets.
