# EFS card control — recon report
Date: 2026-08-12
Commit: 5b28b20eecd726ce49e99808fb4954acb5628aa5
Branch: recon/efs-baseline

## Summary
- Gates passing: 6 of 12
- Gates failing: `lint`, `lint:filesize`, `lint:funcsize`, `typecheck`, `test`, `build`
- Claims CONFIRMED: D3 (the boundary checker does not inspect `apps/api/src`), D4 (function-size scanning excludes route paths)
- Claims REFUTED: D1, D2
- Anything alarming: `routeAuth.test.ts` does not discover the mounted `/api/fuel-cards`; `EFS_CARD_CONTROL_PROBE_ENABLED` could not be inspected in the deployed environment; six standing gates are red.

The two setup commands also passed:

```text
$ pnpm install --frozen-lockfile
Scope: all 14 workspace projects
Lockfile is up to date, resolution step is skipped
Progress: resolved 0, reused 1, downloaded 0, added 0
Packages: -105
--------------------------------------------------------------------------------
Progress: resolved 0, reused 105, downloaded 0, added 0, done
. postinstall$ node scripts/apply-patches.mjs
. postinstall: [apply-patches] ✓ already applied: /Users/miroslavjokovic/Projects/FuelGuard/node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift
. postinstall: Done
╭ Warning ─────────────────────────────────────────────────────────────────────╮
│   Ignored build scripts: @sentry/cli@2.58.4.                                 │
╰──────────────────────────────────────────────────────────────────────────────╯
Done in 1.3s using pnpm v10.34.4

$ pnpm --filter @silvicom/shared build:rn
> @silvicom/shared@0.0.0 build:rn /Users/miroslavjokovic/Projects/FuelGuard/packages/shared
> tsc -p tsconfig.build.json
```

## A. Standing gates
| Gate | Result | Notes |
|---|---|---|
| lint | FAIL | 3 ESLint errors: two `no-control-regex` errors in `apps/web/src/features/hazmat/calcModel.ts`, one unused `existsSync` in `scripts/samsara-vs-store-recon.mjs`. |
| lint:filesize | FAIL | 8 files over 500 lines and 1 waived file grew past its pin. Full output below. |
| lint:funcsize | FAIL | 4 function-size violations. |
| lint:migrations | PASS | `✓ migration versions ok — 182 unique numbered migrations` |
| lint:boundaries | PASS | Boundaries and feature catalog parity both passed. |
| lint:tests | PASS | Every `*.test.*` file is collected by its runner. |
| lint:upserts | PASS | No primary-key upsert into any of 85 tables with required columns. |
| lint:tokens-parity | PASS | 249 shared declarations; 2 consumers import without overrides. |
| lint:secrets | PASS | Gitleaks scanned ~32.26 MB; no leaks found. |
| typecheck | FAIL | `efsCardEdits.test.ts` has three `CardEdit.value` errors; `hazmatExtraction/extract.test.ts` is missing `otherFreightAboard`. |
| test | FAIL | Unit suites and all four matrices ran, but unit and matrix counts differ from the expected baseline. |
| build | FAIL | Production web build is missing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. |

Matrix counts: rls **375** / hazmat_rls **38** / load-lifecycle **61** / duty-sessions **25**
(expected 179 / 16 / 54 / 20)

### Failure output

```text
$ pnpm lint
> fuelguard@0.0.0 lint /Users/miroslavjokovic/Projects/FuelGuard
> eslint .

/Users/miroslavjokovic/Projects/FuelGuard/apps/web/src/features/hazmat/calcModel.ts
  339:14  error  Unexpected control character(s) in regular expression: \x00  no-control-regex
  340:14  error  Unexpected control character(s) in regular expression: \x00  no-control-regex

/Users/miroslavjokovic/Projects/FuelGuard/scripts/samsara-vs-store-recon.mjs
  21:24  error  'existsSync' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 3 problems (3 errors, 0 warnings)

 ELIFECYCLE  Command failed with exit code 1.
```

```text
$ pnpm lint:filesize
> fuelguard@0.0.0 lint:filesize /Users/miroslavjokovic/Projects/FuelGuard
> node scripts/check-file-size.mjs

⚠ 16 file(s) within 50 lines of the 500-line budget.
  Not a failure. Split one before it becomes somebody else's problem mid-PR:
  500  packages/shared/src/idleScoring.ts
  499  apps/web/src/features/roster/DriverAccessModal.vue
  499  apps/web/src/pages/DriverAppSettingsPage.vue
  498  apps/api/src/services/idleDutyEvidenceSync.ts
  493  apps/api/src/lib/efsSoapSession.ts
  493  apps/api/src/services/efsCardMirror.ts
  492  apps/web/src/pages/DispatchLoadDetailPage.vue
  492  packages/shared/src/samsara/entities.ts
  491  apps/api/src/routes/compliance.ts
  491  apps/web/src/pages/CompliancePage.vue
  486  apps/web/src/pages/DispatchLoadsPage.vue
  483  apps/api/src/services/fuelPlanning.ts
  475  apps/web/src/pages/DriverQualificationPage.vue
  475  packages/hazmat-placards/src/svg.ts
  471  apps/api/src/services/efsSoapClientCerts.ts
  456  packages/shared/src/efsImport/parse.ts

✗ 1 waived file(s) GREW past the size they were waived at:
  apps/api/src/lib/samsara.ts: 686 lines, pinned at 670 (+16)

✗ 8 file(s) over the 500-line budget — split into modules:
  542  apps/web/src/features/fuelCards/cardControlModel.ts
  541  apps/web/src/features/hazmat/HazmatCalculatorForm.vue
  540  apps/api/src/services/efsCardControl.ts
  529  packages/shared/src/cardControlContract.ts
  528  apps/api/src/routes/fuelCards/control.ts
  518  packages/hazmat-engine/src/placards/compute.ts
  517  apps/api/src/routes/fuelCards/experiments.ts
  504  apps/api/src/services/idleRollup.ts

Split using the smartFueling/ recon/ module pattern. Adding a waiver instead is a deliberate, reviewable act.
 ELIFECYCLE  Command failed with exit code 1.
```

```text
$ pnpm lint:funcsize
> fuelguard@0.0.0 lint:funcsize /Users/miroslavjokovic/Projects/FuelGuard
> node scripts/check-function-size.mjs

⚠ 1 function(s) within 20 lines of the 200-line budget (not a failure):
  187  apps/api/src/app.ts#createApp
✗ 4 function-size violation(s):
  apps/api/src/services/idleRollup.ts#syncIdleRollup  225 lines  (over the 200-line function budget — split into an orchestrator + stage helpers)
  apps/api/src/services/idleSync.ts#syncIdleEvents  252 lines  (grandfathered at 248 — it GREW; refactor, don't grow)
  apps/api/src/services/samsaraVehicleSync.ts#syncVehiclesFromSamsara  221 lines  (over the 200-line function budget — split into an orchestrator + stage helpers)
  apps/api/src/services/scoring/backfill.ts#backfillOrg  203 lines  (over the 200-line function budget — split into an orchestrator + stage helpers)
 ELIFECYCLE  Command failed with exit code 1.
```

```text
$ pnpm typecheck
> fuelguard@0.0.0 typecheck /Users/miroslavjokovic/Projects/FuelGuard
> pnpm -r typecheck

Scope: 13 of 14 workspace projects
apps/driver-dist typecheck$ node --check server.mjs
packages/capture-engine typecheck$ tsc -p tsconfig.json --noEmit
packages/hazmat-data typecheck$ tsc -p tsconfig.json --noEmit
packages/hazmat-engine typecheck$ tsc -p tsconfig.json --noEmit
apps/driver-dist typecheck: Done
packages/shared typecheck$ tsc -p tsconfig.json --noEmit
packages/capture-engine typecheck: Done
packages/hazmat-engine typecheck: Done
packages/shared typecheck: Done
packages/hazmat-data typecheck: Done
apps/admin-api typecheck$ tsc -p tsconfig.json --noEmit
apps/admin typecheck$ vue-tsc -p tsconfig.json --noEmit
packages/hazmat-golden typecheck$ tsc -p tsconfig.json --noEmit
apps/driver typecheck$ tsc -p tsconfig.json --noEmit
packages/hazmat-placards typecheck$ tsc -p tsconfig.json --noEmit
apps/admin typecheck: Done
apps/admin-api typecheck: Done
packages/hazmat-placards typecheck: Done
apps/driver typecheck: Done
packages/hazmat-golden typecheck: Done
apps/api typecheck$ tsc -p tsconfig.json --noEmit
apps/web typecheck$ vue-tsc -p tsconfig.json --noEmit
apps/web typecheck: Done
apps/api typecheck: src/services/efsCardEdits.test.ts(76,44): error TS2339: Property 'value' does not exist on type 'CardEdit'.
apps/api typecheck:   Property 'value' does not exist on type '{ op: "setFieldNil"; name: string; }'.
apps/api typecheck: src/services/efsCardEdits.test.ts(77,40): error TS2339: Property 'value' does not exist on type 'CardEdit'.
apps/api typecheck:   Property 'value' does not exist on type '{ op: "setFieldNil"; name: string; }'.
apps/api typecheck: src/services/efsCardEdits.test.ts(78,34): error TS2339: Property 'value' does not exist on type 'CardEdit'.
apps/api typecheck:   Property 'value' does not exist on type '{ op: "setFieldNil"; name: string; }'.
apps/api typecheck: src/services/hazmatExtraction/extract.test.ts(86,11): error TS2741: Property 'otherFreightAboard' is missing in type '{ evaluatedAt: string; vehicle: { kind: "van_or_flatbed"; cargoTankCapacityGal: null; compartments: null; }; tankState: "loaded"; lines: { hmtRef: string; reclassedCombustible: false; isLimitedQuantity: false; ... 7 more ...; packageCount: null; }[]; ... 4 more ...; dataset: LoadInput["dataset"]; }' but required in type '{ evaluatedAt: string; vehicle: { kind: "cargo_tank" | "van_or_flatbed"; cargoTankCapacityGal: number | null; compartments: { index: number; capacityGal: number; }[] | null; }; tankState: "loaded" | ... 1 more ... | "cleaned_and_purged"; ... 6 more ...; dataset: { ...; }; }'.
apps/api typecheck: Failed
/Users/miroslavjokovic/Projects/FuelGuard/apps/api:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @silvicom/api@0.0.1 typecheck: `tsc -p tsconfig.json --noEmit`
Exit status 2
 ELIFECYCLE  Command failed with exit code 2.
```

```text
$ pnpm test
> fuelguard@0.0.0 test /Users/miroslavjokovic/Projects/FuelGuard
> node scripts/run-tests.mjs

[tail]
RESULT: 375 passed, 0 failed

========================================================================
  Unit (`pnpm -r test`)              FAIL (exit 1)
  Matrix `duty-sessions`             25 passed, 0 failed
  Matrix `hazmat_rls`                38 passed, 0 failed
  Matrix `load-lifecycle`            61 passed, 0 failed
  Matrix `rls`                       375 passed, 0 failed
========================================================================

FAIL - see the suites marked above.

 ELIFECYCLE  Test failed. See above for more details.

Additional failing-suite tail:
apps/api test:  ❯ src/middleware/requireFreshAuth.test.ts (6 tests | 6 failed)
apps/web test:  ❯ src/features/fuelCards/CardControlDrawer.test.ts (12 tests | 1 failed)
apps/web test:      × does not dispatch a second time while the first confirm is in flight
apps/web test: Error: Button not found: Lock card. Present: Back | Locking…
apps/web test: Test Files 1 failed | 21 passed (22)
apps/web test: Tests 1 failed | 154 passed (155)
```

```text
$ pnpm build
> fuelguard@0.0.0 build /Users/miroslavjokovic/Projects/FuelGuard
> pnpm -r build

[tail]
apps/web build: failed to load config from /Users/miroslavjokovic/Projects/FuelGuard/apps/web/vite.config.ts
apps/web build: error during build:
apps/web build: Error: Production web build is missing: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
apps/web build:     at file:///Users/miroslavjokovic/Projects/FuelGuard/apps/web/node_modules/.vite-temp/vite.config.ts.timestamp-1786586352381-0bce316aa6def.mjs:11:29
apps/web build:     at loadConfigFromFile (file:///Users/miroslavjokovic/Projects/FuelGuard/node_modules/vite/dist/node/chunks/node.js:35525:62)
apps/web build:     at async resolveConfig (file:///Users/miroslavjokovic/Projects/FuelGuard/node_modules/vite/dist/node/chunks/node.js:35139:22)
apps/web build:     at async createBuilder (file:///Users/miroslavjokovic/Projects/FuelGuard/node_modules/vite/dist/node/chunks/node.js:32988:17)
apps/web build:     at async CAC.<anonymous> (file:///Users/miroslavjokovic/Projects/FuelGuard/node_modules/vite/dist/node/cli.js:766:19)
apps/web build: Failed
/Users/miroslavjokovic/Projects/FuelGuard/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @silvicom/web@0.0.1 build: `vue-tsc -p tsconfig.json --noEmit && vite build`
Exit status 1
```

## B. CI wiring

### Workflows

The workflow files were read in full. Ordered triggers and steps/scripts are:

- **`.github/workflows/ci.yml` — `CI`**
  - Trigger: `push` to `main`; all `pull_request` events.
  - Steps/scripts, in order: checkout; enable Corepack; setup Node 22 with pnpm cache; install pinned gitleaks 8.18.4; `pnpm lint:secrets`; `pnpm install --frozen-lockfile`; `pnpm --filter @silvicom/shared build:rn`; `pnpm lint`; `pnpm lint:filesize`; `pnpm lint:funcsize`; `pnpm lint:migrations`; `pnpm lint:upserts`; `pnpm lint:tests`; `pnpm --filter @silvicom/web lint:tokens`; `pnpm lint:tokens-parity`; `pnpm lint:ui-contrast`; `pnpm lint:chart-colors`; `pnpm lint:ui-adoption`; `pnpm lint:boundaries`; `pnpm typecheck`; `pnpm test`; `pnpm build`.
- **`.github/workflows/deploy-verify.yml` — `Verify deployment`**
  - Trigger: `push` to `main`; `workflow_dispatch`.
  - Steps/scripts: checkout; require repository variable `API_URL`; poll `${API_URL}/api/version` until the deployed commit and schema are current or timeout.
- **`.github/workflows/driver-android.yml` — `Driver app — Android build`**
  - Trigger: `push` to `main` when `apps/driver/**`, `packages/**`, or this workflow changes; `workflow_dispatch` with `notes` and `force` inputs.
  - Steps/scripts: checkout; local `require-ci-green` action; assert required secrets; enable Corepack; setup Node 22; setup Java 17; setup Android; `pnpm install --frozen-lockfile`; shared RN build; write driver `.env`; decode signing keystore; `pnpm exec expo prebuild --platform android --no-install --clean`; setup Gradle; `./gradlew assembleRelease --no-daemon`; verify APK is not debug-signed; compute native fingerprint; upload APK to driver distribution service; upload APK artifact.
- **`.github/workflows/driver-ota.yml` — `Driver app — publish JS update`**
  - Trigger: `push` to `main` when `apps/driver/**`, `packages/**`, or this workflow changes; `workflow_dispatch` with `message` and `force` inputs.
  - Steps/scripts: checkout; local `require-ci-green` action; assert required secrets; enable Corepack; setup Node 22; `pnpm install --frozen-lockfile`; shared RN build; compute current native fingerprint; read shipped APK fingerprint; warn if no published APK; dispatch `driver-android.yml` if native fingerprint changed; otherwise run `npx --yes eoas@... publish` for the production Android JS update.
- **`.github/workflows/migrate.yml` — `Apply Supabase migrations`**
  - Trigger: `push` to `main` limited to `supabase/migrations/**`; `workflow_dispatch` with `force` input.
  - Steps/scripts: checkout; local `require-ci-green` action; assert Supabase secrets; setup Supabase CLI 2.109.0; `supabase link --project-ref ...`; `supabase db push`; `supabase migration list --linked | tail -20`.
- **`.github/workflows/mutation-check.yml` — `Mutation check`**
  - Trigger: weekly schedule `0 6 * * 1`; `workflow_dispatch`; `push` to `main` for migration/tests/API-service/testing/mutation-script paths.
  - Steps/scripts: checkout; enable Corepack; setup Node 22; `pnpm install --frozen-lockfile`; shared RN build; `pnpm mutation:check`.
- **`.github/workflows/smoke.yml` — `Production smoke test`**
  - Trigger: `workflow_dispatch`; `workflow_run` for completed `Verify deployment` runs.
  - Steps/scripts: checkout; require `API_URL`; setup pnpm 10.34.4; setup Node 22; `pnpm install --frozen-lockfile --prod=false`; install Playwright Chromium with dependencies; `pnpm --filter @silvicom/web e2e --project=chromium`.

### Workflow edges

```text
$ grep -rn "needs:\\|workflow_run:" .github/workflows/ || echo "NO EDGES FOUND"
.github/workflows/smoke.yml:7:  workflow_run:
```

No workflow declares `needs:`. `smoke.yml` declares the only `workflow_run:` edge and is gated by the completed deployment workflow's conclusion.

### Standing gates in CI

| Gate | Runs in CI? | Workflow |
|---|---|---|
| lint | yes | `ci.yml` |
| lint:filesize | yes | `ci.yml` |
| lint:funcsize | yes | `ci.yml` |
| lint:migrations | yes | `ci.yml` |
| lint:boundaries | yes | `ci.yml` |
| lint:tests | yes | `ci.yml` |
| lint:upserts | yes | `ci.yml` |
| lint:tokens-parity | yes | `ci.yml` |
| lint:secrets | yes | `ci.yml` |
| typecheck | yes | `ci.yml` |
| test | yes | `ci.yml` |
| build | yes | `ci.yml` |

The CI wiring search produced:

```text
.github/workflows/ci.yml:38:        run: pnpm lint:secrets
.github/workflows/ci.yml:47:        run: pnpm lint
.github/workflows/ci.yml:50:        run: pnpm lint:filesize
.github/workflows/ci.yml:53:        run: pnpm lint:funcsize
.github/workflows/ci.yml:56:        run: pnpm lint:migrations
.github/workflows/ci.yml:59:        run: pnpm lint:upserts
.github/workflows/ci.yml:64:        run: pnpm lint:tests
.github/workflows/ci.yml:70:        run: pnpm lint:tokens-parity
.github/workflows/ci.yml:82:        run: pnpm lint:boundaries
.github/workflows/ci.yml:85:        run: pnpm typecheck
.github/workflows/ci.yml:88:        run: pnpm test
.github/workflows/ci.yml:91:        run: pnpm build
.github/workflows/migrate.yml:61:        run: supabase db push
```

`migrate.yml` does run `supabase db push`, on pushes to `main` that change `supabase/migrations/**`, and on manual dispatch. It requires the local CI-green action unless the manual `force` input bypasses it.

`pnpm verify:live` is not run in CI or by a deploy hook. It exists as a root `package.json` script and was run manually for this reconnaissance.

## C. Fitness functions

The requested reference checks returned:

```text
$ grep -rn "check-rls" package.json .github/ scripts/ || echo "check-rls: NO REFERENCES"
check-rls: NO REFERENCES

$ grep -rn "lint:codegen" .github/ || echo "lint:codegen: NOT IN CI"
lint:codegen: NOT IN CI

$ grep -rn "mutation:check" .github/ || echo "mutation:check: NOT IN CI"
.github/workflows/mutation-check.yml:61:        run: pnpm mutation:check

$ ls -la .gitleaks.toml 2>&1
-rw-r--r--@ 1 miroslavjokovic  staff  1997 Aug 11 05:53 .gitleaks.toml
```

The `ls -la scripts/` result included the relevant files:

```text
-rw-r--r--@ 1 miroslavjokovic  staff   2239 Aug 11 05:53 check-rls.mjs
-rw-r--r--@ 1 miroslavjokovic  staff  16670 Aug 11 05:53 mutation-check.mjs
-rw-r--r--@ 1 miroslavjokovic  staff   5734 Aug 11 05:53 verify-live.mjs
```

| Script/config | Exists | Referenced by | Runs in CI |
|---|---|---|---|
| `scripts/check-rls.mjs` | yes | nothing (`package.json`, CI, and scripts content contain no `check-rls` reference) | no |
| `lint:codegen` / `scripts/gen-rule-catalog.mjs` | yes; root package script exists and its underlying generator exists | `package.json` only | no |
| `scripts/mutation-check.mjs` / `mutation:check` | yes | `package.json`, `.github/workflows/mutation-check.yml` | yes, weekly/manual/path-triggered mutation workflow |
| `.gitleaks.toml` | yes | `scripts/scan-secrets.mjs` loads it when present; `lint:secrets` invokes that scanner | yes, through `ci.yml` |

## D. Claims

### D1 routeAuth discovery — REFUTED

Command and actual output:

```text
$ node -e '
const fs=require("fs");
const src=fs.readFileSync("apps/api/src/app.ts","utf8");
const t=fs.readFileSync("apps/api/src/routeAuth.test.ts","utf8");
const m=t.match(/const re = (\/.*\/[gimsuy]*);/);
console.log("regex:", m ? m[1] : "NOT FOUND");
const body=m[1].slice(1,m[1].lastIndexOf("/"));
const found=[...src.matchAll(new RegExp(body,"g"))].map(x=>x[1]);
console.log("discovered count:", found.length);
console.log("discovered:", found);
console.log("fuel-cards discovered?", found.includes("/api/fuel-cards"));
'
regex: /app\.use\("(\/api\/[^"]+)"\s\*,[^)]*?\w+Router\(\)\)/g
discovered count: 26
discovered: [
  '/api/tms',            '/api/version',
  '/api/invites',        '/api/me/notifications',
  '/api/me/hazmat',      '/api/me',
  '/api/messages',       '/api/members',
  '/api/auth',          '/api/auth',
  '/api/roster/drivers', '/api/roster/drivers',
  '/api/transactions',   '/api/anomalies',
  '/api/reports',        '/api/audit',
  '/api/integrations',   '/api/fueling',
  '/api/ai',             '/api/jobs',
  '/api/dispatch',       '/api/public/hazmat',
  '/api/hazmat',         '/api/compliance',
  '/api/driver-app',     '/api/webhooks'
]
fuel-cards discovered? false
```

The exact mount lines in `apps/api/src/app.ts` are:

```text
154|  app.use("/api/fuel-cards", strictLimiter); // dials a rate-paced vendor on a shared service account
222|  app.use("/api/fuel-cards", fuelCardSettingsRouter(), fuelCardsRouter(), fuelCardControlRouter(), fuelCardProbeRouter(), fuelCardWriteProbeRouter(), fuelCardExperimentsRouter());
```

The route is mounted, but the test's regex does not discover it.

### D2 comment claim — REFUTED

```text
$ sed -n '145,160p' apps/api/src/services/efsCardEdits.ts
145| * `lengthCheck`, `minimum`, `maximum`, `value` and potentially fields WEX adds next year. Rebuilding
146| * records from the typed view instead of from the DOM would drop them, which for a prompt means the
147| * pump stops applying a rule nobody meant to remove.
148| *
149| * A nested container inside a record would flatten here and lose data. That cannot pass silently:
150| * `assertEchoFidelity` compares full field PATHS, so the flattened request would not match the
151| * expected canonical form and would be refused rather than sent. Recorded as a property, not a hope —
152| * `efsCardEdits.test.ts` proves it with a record carrying a nested child.
153| */
154|export function recordFromElement(element: XmlElement): Record<string, string | null> {
155|  const record: Record<string, string | null> = {};
156|  for (const child of childElements(element)) {
157|    const nil = child.getAttribute("xsi:nil") ?? child.getAttribute("nil");
158|    record[localName(child)] = nil === "true" || nil === "1" ? null : (child.textContent ?? "").trim();
159|  }
160|  return record;

$ grep -cin "nest" apps/api/src/services/efsCardEdits.test.ts
0

$ grep -n "it(" apps/api/src/services/efsCardEdits.test.ts | wc -l
17
```

There is no test with a nested-child record in that test file: zero lines match `nest`, and no lines match `nested`, `child`, or `nest` in the test source. The comment names a test/property that is not present.

### D3 lint:boundaries coverage

`check-feature-boundaries.mjs` scans:

- `apps/web/src/features`
- `apps/driver/src/features`
- `apps/driver/app` and `apps/driver/src` for the sample-data rule
- `packages/hazmat-engine` and `packages/hazmat-data` for package boundaries
- `packages/hazmat-engine/src` for determinism

It does **not** inspect `apps/api/src` at all. Relevant source lines:

```js
checkFeatureIsolation(join(ROOT, "apps/web/src/features"), WEB_ALLOW, "web");
checkFeatureIsolation(join(ROOT, "apps/driver/src/features"), DRIVER_ALLOW, "driver");

for (const rel of ["packages/hazmat-engine", "packages/hazmat-data"]) {
...
const rel of ["apps/driver/app", "apps/driver/src"]
...
try { engineFiles = walk(join(ROOT, "packages/hazmat-engine/src")); } catch { engineFiles = []; }
```

Therefore the D3 coverage finding is CONFIRMED: `apps/api/src` is outside this boundary checker.

### D4 lint:funcsize scope

From `scripts/check-function-size.mjs`:

```js
const MAX = 200;

const GRANDFATHERED = {
  "apps/api/src/services/idleSync.ts#syncIdleEvents": 248,
  "apps/api/src/services/declinedScoring.ts#scoreDeclinedAttempt": 230,
  "apps/api/src/services/askData.ts#runTool": 212,
  "apps/api/src/services/fuelPlanning.ts#planFuelRoute": 210,
};
```

The full scanning filter is:

```js
const out = execSync("git ls-files apps/api/src", { cwd: ROOT, encoding: "utf8" });
return out.trim().split("\\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/routes/"));
```

Routes are explicitly excluded by `!f.includes("/routes/")`. The D4 claim is CONFIRMED.

## E. Schema state

```text
$ ls supabase/migrations/ | tail -20
0165_idle_telemetry_windows.sql
0166_idle_hos_evidence.sql
0167_idle_equipment_evidence.sql
0168_idle_learned_envelopes.sql
0169_idle_envelope_rollup.sql
0170_idle_hos_rollup.sql
0171_efs_cards.sql
0173_efs_card_control_settings.sql
0174_idle_session_evidence_writes.sql
0175_idle_learned_envelope_writes.sql
0176_efs_cards_tolerant_vendor_values.sql
0177_efs_card_mutations.sql
0178_card_write_counters.sql
0179_card_mutation_serialization.sql
0180_card_control_phase2.sql
0181_card_control_phase3.sql
0182_decline_driver_source.sql
0183_idle_rollup_stale_row_delete.sql
0184_vehicle_samsara_missing.sql

$ ls supabase/migrations/ | wc -l
     182

$ node -e '...numbered migration gap check...'
highest: 0184
count: 182
gaps: 0090, 0172
```

Highest migration number on disk: **0184**. There are **182** migration files. Number gaps are **0090** and **0172**. `pnpm lint:migrations` passed because it checks for 182 unique numbered migrations, not a contiguous sequence:

```text
✓ migration versions ok — 182 unique numbered migrations
```

`docs/MIGRATION-DISCIPLINE.md` states that `supabase/migrations/` is the single source of truth, migrations are applied through `.github/workflows/migrate.yml`, and that workflow runs `supabase db push` on merges to `main` touching `supabase/migrations/**`. It also explicitly says the Supabase CLI and DB access are needed for live checks and that those steps run on a machine, not in that session.

```text
$ pnpm verify:live
> fuelguard@0.0.0 verify:live /Users/miroslavjokovic/Projects/FuelGuard
> node scripts/verify-live.mjs

fatal: no upstream configured for branch 'recon/efs-baseline'

FuelGuard — live deployment check
  target https://fleetguardweb-production.up.railway.app   env production

  ✓  commit             local 5b28b20                  live 5b28b20
  ✗  branch             local recon/efs-baseline       live main
  ✓  schema version     local 0184                     live 0184
  ?  code expects       local 0184                     live 0184

  deployment fa36d2d6-d730-4a6f-ba3e-90e938adc41a   up since 2026-08-12T23:11:20.493Z

✓ Live deployment matches this checkout.

Exit code: 0
```

The command's deployed commit is `5b28b20`, and `schema.applied` is `0184`. It reports a branch mismatch (`recon/efs-baseline` versus deployed `main`) and cannot determine pushed status because the new branch has no upstream, but it still exits 0 and prints the match line. The direct read of the public version endpoint returned:

```text
$ node -e 'const r=await fetch("https://fleetguardweb-production.up.railway.app/api/version"); console.log("status:",r.status); console.log(JSON.stringify(await r.json(),null,2));'
status: 200
{
  "service": "FuelGuard API",
  "env": "production",
  "commit": "5b28b20eecd726ce49e99808fb4954acb5628aa5",
  "commitShort": "5b28b20",
  "branch": "main",
  "deploymentId": "fa36d2d6-d730-4a6f-ba3e-90e938adc41a",
  "startedAt": "2026-08-12T23:11:20.493Z",
  "schema": {
    "expected": "0184",
    "applied": "0184",
    "state": "current",
    "drift": false
  },
  "ok": true
}
```

## F. File sizes

The requested `wc -l` loop produced:

```text
  541  apps/web/src/features/fuelCards/cardControlModel.ts
  539  apps/api/src/services/efsCardControl.ts
  528  packages/shared/src/cardControlContract.ts
  527  apps/api/src/routes/fuelCards/control.ts
  516  apps/api/src/routes/fuelCards/experiments.ts
  492  apps/api/src/services/efsCardMirror.ts
  492  apps/api/src/lib/efsSoapSession.ts
  443  apps/api/src/routes/fuelCards/writeProbe.ts
  429  apps/api/src/lib/efsCardEcho.ts
  417  apps/api/src/lib/efsCardXml.ts
  403  apps/api/src/lib/efsCardOps.ts
  376  apps/web/src/features/fuelCards/CardControlDrawer.vue
  293  apps/api/src/lib/efsCardWrite.ts
  288  packages/shared/src/efsCardCatalog.ts
  256  apps/api/src/services/efsCardEdits.ts
  255  apps/web/src/features/fuelCards/useCardControl.ts
  214  apps/api/src/services/efsCardUnresolved.ts
  139  apps/api/src/lib/efsCardCanonical.ts
```

The requested broad test-file search (`find ... | xargs grep -l -i "card\\|efs" | xargs wc -l | sort -rn`) returned these files and line counts:

```text
 1629 packages/shared/src/anomalyRules.test.ts
  777 packages/shared/src/efsImport.test.ts
  750 apps/api/src/lib/efsCardXml.test.ts
  724 packages/shared/src/samsara.test.ts
  467 apps/web/src/features/fuelCards/cardControlModel.test.ts
  435 apps/api/src/services/hosSync.test.ts
  412 apps/api/src/services/efsCardControl.test.ts
  405 apps/api/src/services/efsIngest.test.ts
  349 apps/api/src/lib/efsSoapSession.test.ts
  342 apps/api/src/lib/soapClientMtls.test.ts
  332 apps/api/src/services/efsCardMirror.test.ts
  318 apps/api/src/services/efsSoapClientCerts.test.ts
  270 apps/api/src/lib/efsCardWrite.test.ts
  264 apps/api/src/routes/fuelCardsControl.test.ts
  258 apps/api/src/services/samsaraRecon.test.ts
  255 apps/web/src/features/fuelCards/CardControlDrawer.test.ts
  243 packages/shared/src/dqFile.test.ts
  231 apps/api/src/lib/ssrfGuard.test.ts
  223 apps/api/src/lib/efsSoap.test.ts
  218 apps/api/src/services/efsAutoIngest.test.ts
  211 apps/api/src/lib/efsCardOps.test.ts
  211 apps/api/src/services/jobs.test.ts
  206 packages/shared/src/dashboard.test.ts
  200 apps/api/src/services/scoring/scoreTransaction.test.ts
  198 packages/shared/src/anomalyRules/capacityResolve.test.ts
  190 packages/shared/src/cardAssignment.test.ts
  187 apps/api/src/services/efsCardEdits.test.ts
  176 packages/shared/src/cardControlContract.test.ts
  171 packages/shared/src/qualificationGate.test.ts
  166 apps/api/src/services/declineDriverResolution.test.ts
  164 packages/shared/src/notificationsContract.test.ts
  160 apps/api/src/services/scoring/consumptionContext.test.ts
  157 apps/api/src/routes/fuelCards.test.ts
  144 apps/api/src/lib/x509.test.ts
  141 apps/api/src/services/queue/queue.test.ts
  137 apps/api/src/services/hazmatExtraction/extract.test.ts
  136 packages/shared/src/efsTime.test.ts
  133 apps/api/src/lib/efsLocationSearch.test.ts
  120 apps/api/src/lib/soapClientLanes.test.ts
  120 apps/api/src/services/scoring/reconcile.test.ts
  117 apps/api/src/lib/samsaraToken.test.ts
  117 apps/api/src/lib/secretBox.test.ts
  112 apps/api/src/services/scoring/cardMultiReconcile.test.ts
  108 apps/api/src/lib/efsCardExperiments.test.ts
  107 apps/web/src/features/fuelCards/EfsLocationPicker.test.ts
   99 apps/api/src/services/efsCardReconcile.test.ts
   98 apps/api/src/lib/soapClient.test.ts
   98 apps/api/src/services/scoring/reconcileCapacity.test.ts
   96 packages/shared/src/ai.test.ts
   93 apps/api/src/services/efsProcessing.test.ts
   91 apps/api/src/lib/efsPolicyCache.test.ts
   90 apps/api/src/services/idleSync.test.ts
   89 packages/shared/src/detectionCoverage.test.ts
   86 packages/shared/src/cardWriteLimits.test.ts
   83 apps/api/src/lib/readEfsFile.test.ts
   83 packages/shared/src/declined.test.ts
   81 packages/shared/src/complianceSeed.test.ts
   78 packages/shared/src/fuel.test.ts
   76 packages/shared/src/reconcile/pilotFuelReport.test.ts
   67 apps/api/src/services/driverReconcile.test.ts
   65 apps/web/src/lib/nav.test.ts
   63 packages/shared/src/anomalyRules/mpgBaseline.test.ts
   61 apps/api/src/lib/samsara.test.ts
   61 apps/web/src/features/hazmat/reviewModel.test.ts
   60 apps/api/src/lib/graphMail.test.ts
   57 packages/shared/src/efsImport/planDriverMerges.test.ts
   56 packages/shared/src/declineReason.test.ts
   55 apps/api/src/services/hazmatAnalysis.test.ts
   53 packages/shared/src/smartFueling/pilotLocationsExport.test.ts
   50 packages/shared/src/efsImport/controlId.test.ts
   41 packages/shared/src/efsCardCatalog.test.ts
   39 packages/shared/src/attributionHealth.test.ts
   39 packages/shared/src/efsImport/driverMatchKey.test.ts
   34 packages/shared/src/smartFueling/brands.test.ts
   20 apps/api/src/services/efsCardSyncScheduler.test.ts
```

## G. Mutation testing

```text
$ grep -n "mutation" package.json
39:    "//mutation:check": "Breaks the code on purpose and requires the suite to go red. A SURVIVED mutation is a hole in the tests; a STALE one means the code moved and that check has been testing nothing. Runs weekly in CI (.github/workflows/mutation-check.yml).",
40:    "mutation:check": "node scripts/mutation-check.mjs",

$ node scripts/mutation-check.mjs --list
rls-ftxn-select-open                 supabase/migrations/0004_rls.sql
rls-drivers-select-open              supabase/migrations/0004_rls.sql
rls-anomalies-select-open            supabase/migrations/0004_rls.sql
anon-lockout-imports-open            supabase/migrations/0007_imports.sql
definer-revoke-removed               supabase/migrations/0162_definer_exposure_closure.sql
hazmat-draft-withcheck-weakened      supabase/migrations/0161_hazmat_draft_and_org_immutability.sql
org-id-made-mutable                  supabase/migrations/0161_hazmat_draft_and_org_immutability.sql
api-anomalyFlagReconcile-unscoped    apps/api/src/services/anomalyFlagReconcile.ts
api-idleRollup-unscoped              apps/api/src/services/idleRollupInputs.ts
waiver-growth-unchecked              scripts/check-file-size.mjs
driver-tests-uncollected              apps/driver/vitest.config.ts
```

Today it targets 11 mutations: 4 RLS/anonymous-lockout mutations, 3 schema hardening mutations, 2 API tenant-scoping mutations, the file-size waiver-growth guard, and the driver test-collection guard. The first 9 target specific migration or API files; the last two target fitness-function/test-configuration files.

It can be narrowed by mutation ID substring using `--only=<substring>` (for example, `--only=rls-`). It cannot be pointed at an arbitrary directory; there is no directory argument or directory-based target selection. The harness edits target files in place and restores them, and refuses dirty targets unless `--allow-dirty` is supplied. The full mutation run was not executed for this read-only baseline; no mutation score is reported.

## H. Environment

No access to the deployed Railway environment's variable inventory was available. The public `/api/version` response confirms only `env: production`; it does not expose the requested EFS environment variables. No variables were set, unset, or changed.

| Variable | Deployed value |
|---|---|
| `EFS_SOAP_ENABLED` | unknown — no deployed environment access |
| `EFS_SOAP_ENVIRONMENT` | unknown — no deployed environment access |
| `EFS_SOAP_ENDPOINT_URL` | unknown — no deployed environment access; host not available |
| `EFS_CARD_CONTROL_ENABLED` | unknown — no deployed environment access |
| `EFS_CARD_CONTROL_PROBE_ENABLED` | **UNKNOWN — could not determine whether it is `true`; this cannot be cleared as a finding without environment access** |
| `EFS_CARD_DELETE_OVERRIDE_ENABLED` | unknown — no deployed environment access |
| `EFS_CARD_SYNC_MAX_DETAIL` | unknown — no deployed environment access |
| `EFS_CARD_MAX_MUTATIONS_PER_HOUR` | unknown — no deployed environment access |
| `EFS_SOAP_EGRESS_PROXY_URL` | unknown — no deployed environment access; set/unset status unavailable |

## Anything else you noticed

- The working tree already contained unrelated untracked files before reconnaissance (`docs/23-EFS-CARD-CONTROL-FINDINGS-2026-08-12.md`, `docs/24-EFS-CARD-CONTROL-PLAN.md`, `docs/24-EFS-CARD-CONTROL-REMEDIATION-PLAN.md`, `docs/26-EFS-CARD-CONTROL-PLAN-AUDIT.md`, `docs/27-EFS-CAPABILITY-ARCHITECTURE.md`, `docs/28-EFS-EXECUTION-PLAN.md`, `docs/plans/DEVIN-EFS-RECON.md`, and `fg2.tar.gz`). They were not modified or staged.
- `pnpm verify:live` exits 0 despite showing a branch mismatch and printing `fatal: no upstream configured` for the new branch. The direct endpoint says `schema.state: current`, `drift: false`, and `ok: true` for the deployed `main` commit.
- The migration version lint passes while the numbered migration sequence has gaps at `0090` and `0172`.
- The file-size gate's internal metric reports `control.ts` at 528, `efsCardControl.ts` at 540, `experiments.ts` at 517, and `cardControlContract.ts` at 529, while the requested `wc -l` inventory reports one fewer line for each of those files. This is a metric difference, not a waiver or a fix.
- The route-auth discovery and nested-child test comments are stale relative to the current source/test behavior.
