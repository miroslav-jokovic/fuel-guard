# Document scanner — upgrade plan · 2026-09-06

**Status:** EXECUTION DOCUMENT — decisions are made, not surveyed · **Owner surface:** `apps/driver`
+ `packages/capture-engine` + `apps/api/src/modules/hazmat/hazmatExtraction` · **Design of record it
extends:** `DOCUMENT-CAPTURE-ENGINE.md` (DCE) — nothing here supersedes DCE's v1/v2 split; this is
how v1 becomes trustworthy and how the v2 question gets answered with a number instead of an opinion.

**Preceded by:** the scanner audit of 2026-09-06 (this document's §0 carries its measurements).
**Related canon:** `RELEASE-GATE.md` (Gate C is still unrun — Phase 0 runs it), root `CLAUDE.md`
(gate names), `apps/web/CLAUDE.md`, `supabase/CLAUDE.md`, `docs/MIGRATION-DISCIPLINE.md`.

Every number in §0 was **measured in this repository on 2026-09-06**, not recalled. Every unknown is
in §6 with a decision the code takes until an owner rules otherwise — nothing in §4 waits on a person.

---

## 0. Ground truth — measured, not assumed

### 0.1 What the scanner is today

There is no scanner to rewrite. There is a **quality gate** (`packages/capture-engine`, pure, tested)
and a **provider seam** with three implementations, wrapped around Apple's and Google's system
document scanners, which are crop-only black boxes. Live detection, corner refinement, auto-capture,
manual crop, overlay animation and camera control are all **owned by the OS**. DCE §3 says so and is
correct.

Present: `VNDocumentCameraViewController` + `VNRecognizeTextRequest` (iOS, Swift, 251 lines),
`GmsDocumentScanner` + ML Kit Text Recognition v2 (Android, Kotlin, 230 lines), `expo-image-picker`
fallback, `expo-image-manipulator`, `react-native-reanimated` 4.5.1 (unused by capture), `sharp`
(server). **Absent:** OpenCV, vision-camera, expo-camera, TFLite, Core ML, `expo-sensors`, any
first-party C++.

### 0.2 The five measurements that shape every decision below

Run against `apps/api`'s installed `sharp`, 2026-09-06. Reproduce with the probes in §3.4.

| # | Measurement | Result |
|---|---|---|
| M1 | `sharp.convolve` with the Laplacian kernel on a 0→255 step edge, one row | `[0,0,0,255,0,0,0,0]` — the **negative lobe is clamped to 0**. The server's "variance of Laplacian" is variance of a *half-rectified* response. |
| M2 | Same document image, variance-of-Laplacian at six scales | 3000px → **4283.7**; 2048 → 4631.4; 1568 → 5364.6; 1200 → 6037.7; 1024 → 6616.0; 800 → **7299.9**. A 1.7× swing from resolution alone. |
| M3 | `sharp.greyscale()` on pure R, G, B | R→**127**, G→**220**, B→**76**. Not Rec.601 (76/150/29) and not Rec.709 (54/182/18) — libvips converts sRGB→linear→Y→sRGB gamma. A client using a textbook luma formula computes a **different plane**. |
| M4 | Downscale 3000→1568 of an image whose true maximum luminance is **235** | `lanczos3` (sharp's default) → glareFraction **0.10048**, max 253. `lanczos2`/`cubic`/`mitchell`/`nearest` → **0.00000**. Ringing **manufactures** glare pixels. |
| M5 | A mid-contrast page through `normalizeImage()`, which is what `usabilityGate` actually receives (`orchestrate.ts:111-113`) | raw: blurVar 2395.8, glare 0.00000, max 210 → normalized: blurVar **4542.3 (1.9×)**, glare **0.01964**, max **255**. `.normalise()` stretches the maximum to 255 by construction, so "fraction of pixels ≥ 250" measures the stretch, not the glare. |

**What M1–M5 mean together:** the sentence in `packages/capture-engine/src/config.ts` that the client
thresholds are "aligned to the SERVER usability gate" **cannot be true as written**, because the
server measures a contrast-stretched, median-denoised, lanczos3-resized, WebP-recompressed image and
the client holds a different one. The blur floor of 100 and the glare ceiling of 0.06 are
uncalibrated against any pipeline (`image.ts:72` says "corpus-tuned in H11" — H11 never ran). This is
the first thing to fix and it is fixed **on the server, in TypeScript, before any native code is
written**.

### 0.3 The nine defects the audit found, restated as work

| id | Defect | Evidence |
|---|---|---|
| F1 | `originalOfRecord` is a 1568px JPEG q80 derivative; all four `CapturedPage` image fields alias **one** object; the integrity hash covers the derivative | `CaptureNativeModule.swift:136-151`, `CaptureNativeModule.kt:111-128`, `nativeSystemScannerProvider.ts:44-54` |
| F2 | `SCANNER_MODULE_UNAVAILABLE` and `UNSUPPORTED_DEVICE` collapse to `PROVIDER_ERROR`; the driver is told "Something went wrong" instead of "connect to Wi-Fi once" | `nativeSystemScannerProvider.ts:88-92` vs `CaptureNativeModule.kt:70`, `swift:33` |
| F3 | Android `isSupported()` returns hardcoded `true/true/true`; `scannerModule` is never populated | `CaptureNativeModule.kt:47-50` |
| F4 | Pages 2..n are discarded silently; `maxPages:10` is requested and iOS ignores it | `hazmatCaptureModel.ts:36` |
| F5 | `integrityHash` means bytes on native and **the base64 string** on the JS fallback; nothing recomputes it | `expoImagePickerProvider.ts:54` vs `swift:139` |
| F6 | Seven rejection reasons are unreachable — no provider sets blur/glare/shadow/brightness/contrast/documentDetected; `coverageFraction: 1` is asserted | `nativeSystemScannerProvider.ts:46` |
| F7 | `smallTextBandCoverage` is `Σ(line heights)/imageHeight` — a ratio that grows with line count, not a coverage fraction; inert against its 0.02 floor | `swift:229-231`, `kotlin:163-164` |
| F8 | iOS fans **every page** out concurrently: N `UIGraphicsImageRenderer` bitmaps + N concurrent `.accurate` Vision passes. Android decodes full-resolution bitmaps with no `inSampleSize` and no `recycle()` | `swift:117-132`, `kotlin:111-116` |
| F9 | `cancel()` is dead code; on iOS it dismisses the VC without firing the delegate, so the promise would never settle. Rejected captures leak temp files | `swift:60-64`; `stageFile` runs only on the accepted path |

### 0.4 What CI does and does not check (verified against `.github/workflows/`)

- **Runs on every PR:** root `pnpm lint` (eslint, and `apps/driver` **is** in scope — root
  `eslint.config.js` does not ignore it), `lint:filesize`, `lint:funcsize`, `lint:tests`,
  `lint:comment-claims`, `lint:boundaries`, `lint:table-writers` (+ the schema-snapshot diff chained
  onto it), `lint:migrations`, `lint:rls`, `lint:migration-ordering`, `lint:upserts`, and 17 more in
  the `gates` job; `pnpm typecheck` + `pnpm build` in `typecheck-build`;
  `pnpm -r --filter '!api' --filter '!web' test` in `test-packages` — which is what runs
  **`packages/capture-engine` and `apps/driver` unit suites**.
- **Does NOT run on any PR:** `apps/driver`'s own stricter eslint config (`pnpm --filter
  @silvicom/driver lint`), `lint:tokens`, `lint:theme`, `lint:design` — zero occurrences of
  `filter @silvicom/driver` in `ci.yml`. **No Swift, Kotlin, Gradle or Xcode step exists in `ci.yml`
  at all.**
- **Compiles Kotlin only after merge:** `driver-android.yml` runs `expo prebuild --platform android`
  + a signed Gradle release build on push to `main` under `paths: apps/driver/**`, gated on CI green.
  So **a Kotlin compile error is caught after it is merged, not before.**
- **Compiles Swift nowhere.** Only on the owner's Mac.

This is the largest structural risk in a plan whose core work is native, and Phase 0 closes it.

---

## 1. Decisions

Each decision names the measurement that forced it. Numbers that are still to be derived say so and
name the step that derives them — no threshold in this document is invented.

**D-SCAN1 — One metric definition, computed at a fixed analysis scale.**
Forced by **M2** (1.7× swing from scale alone). Every implementation computes quality metrics on a
deterministic downscale of the luminance plane to `ANALYSIS_LONG_EDGE_PX = 1024`, never on "whatever
image is to hand". 1024 is derived, not chosen for taste: it is the largest power of two below the
`resolutionMinLongEdgePx` floor of 1200, so **an image that passes the resolution floor is always
downscaled and never upscaled** — upscaling invents information and would make the metric a
measurement of the resampler. An image below 1024 is not upscaled: metrics are reported `na` (the
resolution check has already failed it, and §5's rule is that `na` is never a silent pass).

**D-SCAN2 — Luminance is defined by formula, not by library.**
Forced by **M3**. `Y = round(0.2126·R + 0.7152·G + 0.0722·B)` on gamma-encoded sRGB, integer
arithmetic, computed by our own code in all three languages. `sharp.greyscale()` is *not* used in the
metric path. Rec.709 is the correct luma for sRGB primaries; the decisive property is that three
implementations agree, and a library default that no one can restate in Swift is not a definition.

**D-SCAN3 — The Laplacian is signed and unclamped.**
Forced by **M1**. The metric is the variance of the **int16 signed** response of the 4-neighbour
Laplacian over the D-SCAN1 plane, with a 1px border excluded. sharp's clamping throws away every
light-on-dark edge — half the edges on a document. The server moves onto the signed definition, which
means its floor of 100 no longer applies and is re-derived in Phase 5.

**D-SCAN4 — Metrics are measured on pre-enhancement bytes.**
Forced by **M5**. `usabilityGate` runs on the **raw downloaded bytes**, before `normalizeImage`.
`.normalise()` guarantees a maximum of 255, which makes a near-white fraction a measurement of the
stretch. On the device, metrics are measured on the retained original (D-SCAN6), never on a
derivative.

**D-SCAN5 — The analysis downscale is box (area) averaging.**
Forced by **M4** (lanczos3 manufactured 10% glare on an image whose true maximum was 235). Box
averaging has no ringing, no kernel parameters, and is the one resampler that can be written
identically in Swift, Kotlin and TypeScript in about fifteen lines each. It is used **only** for the
analysis plane; display/archive resizing keeps whatever each platform's scaler does.

**D-SCAN6 — The original of record is the bytes the scanner returned, unmodified.**
Fixes F1. Native writes the OS page to disk untouched, hashes **those** bytes, and returns it
separately from every derivative. `CapturedPage`'s four image fields stop aliasing one object.

**D-SCAN7 — Expected outcomes are values, not exceptions.**
Fixes F2 without depending on a bridge detail. `scan()` **resolves** with
`{ pages, cancelled, unavailable? }`; a promise rejection means only "something unforeseen happened"
→ `PROVIDER_ERROR`. Verified while writing this: on Android a Kotlin `CodedException` does reach JS
as a `CodedError` carrying `.code` (`expo-modules-core/android/src/main/cpp/Exceptions.cpp:59-67`
constructs it from the `ExpoModulesCore_CodedError` global installed in
`src/sweet/setUpJsLogger.fx.ts:62`); on iOS the equivalent construction happens inside the prebuilt
`ExpoModulesJSI` binary and **could not be confirmed from source**. Rather than ship a design that
rests on an unverified half, expected outcomes never travel as exceptions. The provider still reads
`e.code` defensively as a secondary path, with `PROVIDER_ERROR` as the stated fallback.

**D-SCAN8 — The metric implementation of record is pure TypeScript, and the server uses it directly.**
`packages/capture-engine/src/metrics.ts` exports `computeMetrics(luminance, width, height, cfg)` —
pure, zero-dependency, unit-tested in CI on Linux. `apps/api`'s `usabilityGate` **imports and calls
it** after decoding with sharp. Client/server parity therefore holds *by construction* rather than by
agreement, which is the failure mode §0.2 exposed. Only iOS and Android reimplement it, and they are
held to it by the fixture corpus (D-SCAN9).

**D-SCAN9 — Parity is a fixture corpus with expected values, and a gate.**
`packages/capture-engine/fixtures/` holds procedurally-generated PNGs (defined by a seeded generator
committed beside them, so a reviewer can regenerate rather than trust) plus, from Phase 0, real
truck-cab photographs. The TS reference produces `expected.json`. `lint:scanner-parity` fails when
the reference drifts from `expected.json` without an explicit re-baseline. Native tests (XCTest /
JUnit) read the same fixtures and must match within a stated tolerance.

**D-SCAN10 — Thresholds are shadow-measured before they gate anything.**
No threshold in this plan is set by argument. Every new metric ships first in **shadow mode**:
computed, recorded in telemetry, `na` in the gate. Phase 5 derives each floor from the recorded
distribution over the corpus and real captures, then flips it to enforcing in a signed config
version. This is the direct answer to `config.ts`'s own rule against inventing numbers.

**D-SCAN11 — Three outputs, and the original uploads on an unmetered connection.**
ORIGINAL (untouched, evidentiary), ARCHIVE (human-readable: perspective/orientation, white balance,
illumination normalisation, gentle sharpening, colour preserved), MACHINE (grayscale, local contrast,
denoise — what extraction reads). Both storage paths are computed **at registration**, so nothing
ever UPDATEs the insert-only evidence row. The ARCHIVE/MACHINE derivative uploads immediately; the
ORIGINAL is staged and uploaded when `NetInfo` reports an unmetered connection, using the outbox
machinery that already exists. See §6 Q1 for the retention rule and the fallback if the owner rules
otherwise.

**D-SCAN13 — the device session moves to the END of the programme (owner ruling, 2026-09-07).**
Step 0.1 was written as a prerequisite: answer "has the native provider ever run on a device?" before
building on it. The owner has ruled otherwise — build the programme out, then connect a phone to the
MacBook and test the scanner once, against the finished thing. That is a legitimate trade and it is
recorded here rather than quietly followed, because it inverts a prerequisite this document states.

What it costs, stated plainly so nobody rediscovers it: **every native change from Phase 1 onward
ships without on-device verification until that session happens.** CI compiles the Kotlin (Step 0.4)
and nothing compiles the Swift, so "it builds" is the strongest claim available for months of work.
The mitigations, which are now obligations rather than nice-to-haves:

  · Every step that touches native code carries an explicit **"owed on device"** line in its PR, and
    those lines accumulate into the §8 log. The device session's agenda IS that list.
  · Anything that CAN be proven without hardware MUST be — pure logic lifted out of the native layer,
    faked-native-module tests, and the fixture corpus doing the work a phone would otherwise do.
  · Phase 2 (pure TypeScript + server) is fully verifiable today and is therefore not affected.
  · §6 Q5 stays open for the whole programme. If the answer turns out to be "the native provider has
    never run", the Phase 1 and Phase 3 native work will not have been exercised by anybody, and the
    device session becomes a first integration rather than a confirmation. Budget it that way.

**D-SCAN12 — v2 RawCapture is not scheduled. It is gated on a number.**
Phase 7 opens only if Phase 5's telemetry shows a measured trigger crossed: re-shoot rate, or
server-backstop rejections of client-accepted pages. DCE §3 already frames v2 as "built only if
measured-needed"; this plan supplies the measurement.

---

## 2. The architecture this plan produces

```
 app/hazmat/capture.tsx · (later) app/documents/*        ← ONE entry, profile-parameterised
        │
 packages/capture-engine   (pure, zero-dependency, runs in CI on Linux)
   contracts.ts   + originalOfRecord separate from derivatives (D-SCAN6)
   config.ts      + analysis scale, archiveFacing profile, document profiles
   metrics.ts     ★ NEW — THE definition of blur/glare/shadow/brightness/contrast (D-SCAN8)
   gate.ts        unchanged in shape: it already reads exactly these fields
   provider.ts    unchanged
   fixtures/      ★ NEW — corpus + expected.json (D-SCAN9)
        │
        ├───────────────────────────────► apps/api usabilityGate  — calls metrics.ts (D-SCAN8)
        │                                  measured on RAW bytes (D-SCAN4)
        ▼
 apps/driver/modules/capture-native   (Expo module, New Arch)
   scan()      → OS scanner; returns ORIGINAL bytes untouched + {cancelled, unavailable} (D-SCAN6/7)
   measure()   → ImageMetrics from the D-SCAN1..5 plane          ← Phase 3
   enhance()   → ARCHIVE + MACHINE derivatives                    ← Phase 6
   recognize() → OCR legibility signal (exists; F7 repaired)
        │
   ┌────┴──────────────┐
 iOS Swift         Android Kotlin      — same algorithm, same shape, held by the fixture corpus
```

No C++, no OpenCV, no ML in this plan. §7 states exactly what evidence would justify each.

---

## 3. Execution protocol

### 3.1 Resume ritual (a fresh session starts here)

1. Read this document top to bottom, then `DOCUMENT-CAPTURE-ENGINE.md`, then root `CLAUDE.md` and
   the `CLAUDE.md` of every package the step touches. **`apps/driver` has no CLAUDE.md** — its
   conventions are `apps/driver/DESIGN.md` plus the three local gates in §3.3.
2. Establish reality: `git log --oneline -15`, `git branch --show-current`, `pnpm verify:live`.
3. Find the first §4 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means run the fallback written next to it — it never means guess.
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. `main` is branch-protected
   (required check `build`); there is no other path.
5. When a step ships, append a dated line to §8. **Do not mark table rows** — parallel PRs editing
   adjacent rows conflict every time.

### 3.2 Migration discipline (binding, and it shapes the phase boundaries)

A merge is **served ~2m44s before its migration is applied**. So `lint:migration-ordering` requires a
column and its first reader to ship in **two separate merges**. Phase 4 is therefore split into
4a (migration only, no reader) and 4b (readers), and they must not be combined. Migration numbers are
**never pinned in advance** — next-numbered at execution; the head at the time of writing is `0325`.
Every new column added by this plan is **nullable**: `registerDocument` uses
`.upsert(row, { onConflict: "id", ignoreDuplicates: true })`, and `lint:upserts` exists because
Postgres evaluates NOT NULL before conflict arbitration.

### 3.3 Gates each step must run before it is called done

Always: `pnpm typecheck && pnpm lint && pnpm test`.
Additionally, by what the step touches:

| Touches | Also run |
|---|---|
| any `apps/driver` file | `pnpm --filter @silvicom/driver lint` **and** `lint:tokens` `lint:theme` `lint:design` — **none of these run in CI**, so they are the author's responsibility every time |
| a new or changed test file | `pnpm lint:tests` (a test its runner never collects is not a test) |
| a comment claiming coverage | `pnpm lint:comment-claims` — the comment must quote a real `it(...)`/`describe(...)` title verbatim |
| a migration | `pnpm lint:migrations && pnpm lint:migration-ordering && pnpm lint:rls && pnpm lint:table-writers` (the last regenerates `supabase/schema.generated.sql`; **commit the regenerated file**) |
| a new file over 450 lines | `pnpm lint:filesize` warns at 450 and fails at 500; function budget is 200 in api services |
| a cross-package import | `pnpm lint:boundaries` |
| **any Swift or Kotlin** | see 3.4 — CI cannot help you |

### 3.4 Native verification, since CI does not do it

**This is a required step of every phase that touches native code, not advice.**

1. **Android, before the PR:** `cd apps/driver && pnpm exec expo prebuild --platform android
   --no-install --clean && (cd android && ./gradlew :capture-native:assembleDebug)`. This is the same
   toolchain `driver-android.yml` runs post-merge, brought forward by hand.
2. **iOS, before the PR:** `cd apps/driver && pnpm exec expo prebuild --platform ios --no-install &&
   pnpm run ios` on the Mac, or at minimum `xcodebuild -workspace ios/FuelGuardDriver.xcworkspace
   -scheme FuelGuardDriver -sdk iphonesimulator build`.
3. **Bump `apps/driver/runtime-version.json`** on every native change. An OTA update is only served
   to a binary whose runtime version matches; forgetting this ships JavaScript to an app that lacks
   the native code it calls. `driver-ota.yml` compares fingerprints, but the bump is manual.
4. **Step 0.4 adds a PR-time Android compile job** so that from Phase 1 onward, item 1 is enforced
   rather than remembered.

Reproducing the §0.2 probes: they are plain `node` scripts run from `apps/api` (which owns the
`sharp` dependency), using `sharp(buf,{raw:{width,height,channels:3}})` to build deterministic PNGs.
Step 0.2 commits them as a real test file so they never have to be retyped.

---

## 4. The phases

Seven phases. Each is independently shippable and depends only on phases before it. No phase leaves
the app in a worse state than it found it, and no phase ships a number nobody measured.

---

### PHASE 0 — Ground truth and the harness (no product behaviour changes)

*Why first: everything after this rests on facts we do not yet have, and on a CI that cannot compile
the language most of this plan is written in.*

**Step 0.1 — Answer the one question the repository cannot.** *(DEFERRED to the end of the programme by D-SCAN13. Its fixture half — the printable calibration targets and the PII rule — SHIPPED 2026-09-07; what remains is the session itself.)*
*Problem:* `RELEASE-GATE.md` Gate C is unrun and unsigned, and `DRIVER-APP-BUILD-STATUS.md` still
lists "build the native module" as owed. Nothing in the tree establishes that a driver has ever
completed a scan through `capture-native` rather than through the `expo-image-picker` fallback. Every
later estimate depends on the answer.
*Build:* nothing. This is a device session on the Mac.
*Verify:* install a dev build on one iPhone and one min-spec Android; open More → Hazmat checks →
Capture BOL; confirm from the returned page's `metadata.providerId` (log it, temporarily) whether the
provider was `capture.native.system_scanner` or `capture.js.expo_image_picker`. Then run the two
DCE-0 checks Gate C names: a network capture during a scan **and** an OCR call, asserting ML Kit
makes no outbound request (BOLs are PII); and OCR latency on the min-spec Android for a dense page.
*Done-when:* Gate C in `RELEASE-GATE.md` is signed with a date and the three results, and §8 records
which provider actually ran. **If the native provider has never run, Phase 1 gains a step to make it
run before anything else is built on it.**

**Step 0.2 — Commit the probes as tests.**
*Problem:* §0.2's five measurements exist only in this document. A future change to sharp, to
`normalizeImage`, or to the metric definition must not silently invalidate them.
*Build:* `apps/api/src/modules/hazmat/hazmatExtraction/imageSemantics.test.ts` — five cases
asserting M1 (clamping), M2 (scale dependence in the stated direction), M3 (the three greyscale
coefficients), M4 (lanczos3 vs mitchell near-white counts), M5 (the normalize-pipeline inflation).
*Verify:* `pnpm --filter @silvicom/api test`; `pnpm lint:tests`. Prove each case can fail by mutating
the assertion, not by trusting a green run.
*Done-when:* the five properties are pinned by named tests, and this document's §0.2 cites their
titles.

**Step 0.3 — The fixture corpus and its generator.**
*Build:* `packages/capture-engine/fixtures/generate.mjs` — a seeded, dependency-free PNG writer (raw
zlib via `node:zlib`, ~80 lines) producing ~24 synthetic pages across the axes that matter: sharp /
soft / motion-blurred; even / side-lit / hand-shadowed; no-glare / specular-patch / blown; high /
low contrast; portrait / landscape; dense / sparse text. Commit both the generator and its output —
the generator is what makes the fixtures reviewable, the output is what makes the tests
deterministic across Node versions.
*Verify:* regenerating produces byte-identical files (`git diff --exit-code`).
*Done-when:* `fixtures/` exists, regenerates identically, and each fixture's file name states the
condition it encodes.

**Step 0.4 — Give CI a native compile.**
*Problem:* §0.4 — zero Swift/Kotlin/Gradle steps in `ci.yml`; Kotlin compiles only after merge, Swift
never. This plan is mostly native.
*Build:* a `native-android` job in `.github/workflows/ci.yml` running `expo prebuild --platform
android --no-install --clean` then `./gradlew :capture-native:assembleDebug` — module only, not the
signed app, so it needs no secrets. Add it to the `build` job's `needs:` list. Also add
`pnpm --filter @silvicom/driver lint` and the three driver gates to the `gates` job, since they exist
and have never run in CI.
*Verify:* push a deliberate Kotlin syntax error on a scratch branch and confirm the job goes red;
revert. **A gate that has not been seen to fail is not a gate.**
*Done-when:* CI compiles the native module on every PR. iOS stays a Mac step and §3.4 stays binding —
say that in the job's comment rather than implying coverage that does not exist.
*Note:* workflow-file changes and the lint gate they run belong in the **same PR** (see
`cannot-push-workflow-file-changes` — pushing workflow changes works again since 2026-08-31).

---

### PHASE 1 — Honest failures and no lost pages (no new metrics; nothing native yet except F8/F9)

*Why here: these are the defects that mislead a driver today, they need no new measurement, and they
are cheap. F8 is a crash risk and should not wait behind a metric contract.*

**Step 1.1 — Expected outcomes stop being exceptions (F2, F3; D-SCAN7).**
*Build:* extend `NativeScanResult` with `unavailable?: { reason: RejectionReason; detail?: string }`.
Kotlin: replace the `CodedScannerException("SCANNER_MODULE_UNAVAILABLE")` throw with a resolved
`unavailable` value; make `isSupported()` actually call
`GmsDocumentScanning.getClient(opts).getStartScanIntent(activity)` behind a cheap availability probe
and populate `scannerModule`. Swift: same for the `VNDocumentCameraViewController.isSupported` guard.
`nativeSystemScannerProvider.scan()` maps `unavailable` straight to `{ ok: false, reason }`, and in
its `catch` reads `(e as {code?: string}).code` against the `RejectionReason` union as a **secondary**
path with `PROVIDER_ERROR` as the stated fallback.
*Verify:* unit tests in `apps/driver/tests/` over a faked native module for each of the five
outcomes; §3.4 native builds; on-device, an Android with Play Services disabled must show *"Scanner
isn't ready on this device — connect to Wi-Fi once, then retake."*
*Done-when:* every `RejectionReason` the native layer can produce reaches `REJECTION_COPY` intact.

**Step 1.2 — Multi-page (F4).**
*Problem:* `hazmatCaptureModel.ts:36` takes `pages[0]`; a 3-page BOL uploads one page silently — the
exact case the §12.3 "3-page BOL < 1.5 MB" DoD is written for.
*Build:* `decideCapture` returns **all** pages with a per-page verdict
(`{ accepted: CapturedPage[]; rejected: Array<{page, reasons}> }`). `buildCapturePayload` becomes
`buildCapturePayloads` producing one `register` per page with `page: n`. **One outbox record carries
all pages** — `outbox.file_uris` is already a JSON array (`db.ts` SCHEMA) and the handler already
reads `record.fileUris`; the handler loops register+upload per page and calls `submit` **once, after
the last page**. Splitting into N records would submit after page 1 and start extraction against an
incomplete load. The handler's existing header comment ("The whole capture is ONE queued item") stays
true, which is why this shape is correct rather than merely convenient.
*Server:* no change. `MAX_BOL_PAGES = 10` is already enforced at registration and is already
replay-safe (`.neq("id", req.id)`); storage paths are keyed by document id so pages cannot collide.
*iOS:* `maxPages` is genuinely unsupported by `VNDocumentCameraViewController` — do not pretend.
Enforce the cap in the provider after the scan returns, and reject the surplus with a named reason
rather than dropping it.
*Verify:* extend `apps/driver/tests/hazmat-capture-model.test.ts` with a mixed 3-page scan where page
2 fails the gate; assert the payloads, the page numbers, and that submit is last. Prove the test can
fail by mutating `page: n` to `page: 1`.
*Done-when:* a 3-page BOL registers three documents and submits once; a partially-rejected scan tells
the driver **which page** to re-shoot.

**Step 1.3 — One meaning for the integrity hash (F5).**
*Build:* `expoImagePickerProvider.ts:54` hashes bytes, not the base64 string — read the file back with
`new File(uri).arrayBuffer()` and digest that. Same for `webFileProvider`. Server: `registerDocument`
recomputes sha256 over the uploaded object and refuses a mismatch. Because the upload happens **after**
registration, the check belongs at submit time (`meHazmat.ts` submit route already downloads nothing —
it counts rows), so verify in `orchestrate.ts` where the bytes are already in hand
(`orchestrate.ts:110`), and fail the run with a named reason rather than extracting from bytes whose
provenance does not check out.
*Verify:* an `apps/api` test that a tampered object fails the run with the named reason; a driver test
that the JS-fallback hash equals the native hash for identical bytes.
*Done-when:* `integrityHash` means the same thing on all three providers and something verifies it.

**Step 1.4 — The two memory hazards and the leaks (F8, F9).**
*Build:* iOS — bound `ImagePipeline.process` concurrency to 2 with a `DispatchSemaphore`, and run OCR
sequentially after the resize rather than N concurrent `.accurate` Vision requests. Android — decode
with `BitmapFactory.Options.inSampleSize` computed from the target long edge, and `recycle()` the
intermediate. Both — delete the temp file when the page is rejected; either implement `cancel()`
correctly (iOS: settle the promise from the dismissal completion) or delete it from the contract.
*Verify:* §3.4 native builds; on-device, a 10-page scan on the min-spec Android completes without an
OOM and the memory graph on iOS stays flat. Record both in §8 — this is the step whose success is a
measurement, not a green build.
*Done-when:* a 10-page scan completes on min-spec hardware, and a rejected capture leaves no file
behind.

---

### PHASE 2 — The metric contract, in TypeScript only

*Why before native: the definition must exist, be tested, and be adopted by the server before two
platforms are asked to reimplement it. Nothing in this phase touches a phone.*

**Step 2.1 — `metrics.ts`, the implementation of record (D-SCAN1..5, D-SCAN8).**
*Build:* `packages/capture-engine/src/metrics.ts`, pure and dependency-free:
- `toLuminance(rgb, w, h) → Uint8Array` — D-SCAN2's integer Rec.709 formula.
- `boxDownscale(plane, w, h, targetLongEdge) → {plane, w, h}` — D-SCAN5, area averaging, no upscale.
- `computeMetrics(plane, w, h) → ImageMetrics` — signed unclamped Laplacian variance (D-SCAN3, 1px
  border excluded), near-white fraction (glare), mean brightness (0..1), RMS contrast (0..1),
  illumination range via a coarse tiled background estimate (shadow).
- `ANALYSIS_LONG_EDGE_PX = 1024` exported from `config.ts` as part of `CaptureConfig`, so it is
  versioned and signed like every other number.
Every function documents **why** in this repo's register, citing M1–M5 by name.
*Verify:* unit tests over the Step 0.3 fixtures asserting ordering properties that cannot be
satisfied by a stub — sharp > soft > motion-blurred on blur; blown > specular > clean on glare; the
side-lit fixture's shadow range above the evenly-lit one's. Prove each fails by mutating the metric.
Then generate `fixtures/expected.json`.
*Done-when:* one file defines every metric, `expected.json` exists, and `pnpm test` covers it on
Linux with no native code.

**Step 2.2 — The parity gate (D-SCAN9).**
*Build:* `scripts/check-scanner-parity.mjs` — runs the reference over the corpus and diffs against
`expected.json`; a change requires an explicit re-baseline commit. Wire it into `ci.yml`'s `gates`
job by name, add its `"//lint:scanner-parity"` comment to root `package.json` explaining what it
protects, and add `--self-test`. **Per root `CLAUDE.md`: a gate in `package.json` and in neither CI
list is not a gate.**
*Verify:* `--self-test` proves the detector fires; a deliberate metric change goes red.
*Done-when:* the metric definition cannot drift silently.

**Step 2.3 — The server moves onto the contract (D-SCAN4, D-SCAN8).**
*Build:* `apps/api` takes a dependency on `@silvicom/capture-engine`. `usabilityGate` decodes with
sharp to **raw RGB** (`.raw().toBuffer()`, no `.greyscale()`) and calls `computeMetrics`. In
`orchestrate.ts:107-115`, the gate runs on `raw` — the downloaded bytes — and `normalizeImage`
continues to produce what the model reads. `IMAGE_NORMALIZER_VERSION` is **not** bumped (the
normalizer is unchanged); a new `USABILITY_GATE_VERSION` is introduced and recorded, because the
gate's meaning has changed and a verdict must stay reproducible.
*Thresholds:* the existing `DEFAULT_USABILITY` numbers (1200 / 100 / 0.06) **no longer apply** —
100 was a clamped-Laplacian floor at an unstated scale. Under D-SCAN10 the blur and glare checks ship
**recording-only** in this step: measured, logged on the run, not rejecting. Only `minLongEdgePx`
keeps enforcing, because resolution is scale-free and its floor was never in doubt.
*Verify:* `pnpm --filter @silvicom/api test` — rewrite `image.test.ts`'s four cases against the new
definition; `pnpm lint:boundaries` (new cross-package import); `pnpm lint:comment-claims`.
*Done-when:* client and server would compute the same number from the same bytes, and the server
records what it measures without rejecting on an underived floor.

---

### PHASE 3 — Native measurement

*Prerequisite: Phase 2 complete, and Step 0.4's CI job green. Prerequisite from §6 Q3: none — this
phase adds no dependency.*

**Step 3.1 — `measure()` on iOS.**
*Build:* a new `AsyncFunction("measure")` taking a file URI. Render the image into an 8-bit RGBA
`CGContext` (deterministic, no colour-management surprises), apply D-SCAN2's formula, box-downscale
per D-SCAN5, compute per D-SCAN3. **Plain Swift, no Accelerate** — the point is a loop a reviewer can
line up against the TypeScript. vImage is an optimisation for later, and only if measured slow.
*Verify:* an XCTest reading the Step 0.3 fixtures from the bundle, asserting each metric matches
`expected.json` within tolerance (**±2% relative on blur, ±0.002 absolute on the fractions** —
stated here so the first implementer does not choose it under pressure; re-derived in §8 if the
first real run shows it is wrong for a stated reason). §3.4 iOS build.
*Done-when:* iOS reproduces the reference on every fixture.

**Step 3.2 — `measure()` on Android.**
*Build:* the same algorithm in Kotlin from `Bitmap.getPixels` into an `IntArray`, `inSampleSize` for
the initial decode. Same structure, same variable names as the Swift — divergence between them is the
thing the corpus exists to catch.
*Verify:* a JUnit test over the same fixtures with the same tolerance; the Step 0.4 CI job.
*Done-when:* Android reproduces the reference on every fixture, and iOS and Android agree with each
other within tolerance.

**Step 3.3 — Wire measurement into the providers, in shadow mode (D-SCAN10).**
*Build:* both providers call `measure()` on the **original** (available after Phase 4; until then, on
the returned page — and say so in the comment rather than implying otherwise) and populate
`ImageMetrics`. **`gate.ts` needs no change: it already reads exactly these fields and already treats
absent ones as `na`.** The config ships the new floors as `null`, which the gate must read as `na`;
add that case and a test for it, because a `null` silently coerced to `0` would pass everything.
*Also fix F7 here:* `smallTextBandCoverage` becomes a true coverage fraction (union of the
smallest-quartile boxes over document area) and `textCoverageFraction` unions rather than sums, on
both platforms. Its floor drops to `null` (shadow) until Phase 5 re-derives it — the current 0.02 is
calibrated against a quantity that is being replaced.
*Verify:* `packages/capture-engine` tests for the `null`-floor `na` path; on-device, the recorded
metrics for a deliberately blurry page are visibly worse than for a sharp one.
*Done-when:* every capture records real blur, glare, shadow, brightness and contrast, and **rejects
on none of them yet**.

---

### PHASE 4 — The original of record

*Two merges, and they must not be combined — `lint:migration-ordering`, §3.2.*

**Step 4a — The migration, with no reader.**
*Build:* next-numbered migration adding to `hazmat_documents`, all nullable:
`archive_storage_path text`, `original_bytes int`, `archive_bytes int`, `capture_metrics jsonb`,
`analysis_config_version text`. Header states, on 0133's model, that the table is insert-only
evidence, that there is no backfill, that both storage paths are computed at registration so nothing
ever UPDATEs a row, and that RLS is unchanged (0092 already scopes by org + driver-own-load).
*Verify:* `pnpm lint:migrations && pnpm lint:migration-ordering && pnpm lint:rls && pnpm
lint:table-writers` — **and commit the regenerated `supabase/schema.generated.sql`**, which is the
check that hides inside `lint:table-writers`.
*Done-when:* merged, and `gh run list --workflow=migrate.yml` shows it applied. **Step 4b does not
start before that.**

**Step 4b — Three outputs end to end (F1, D-SCAN6, D-SCAN11).**
*Build:*
- Native `scan()` writes the OS page **unmodified**, hashes those bytes, and returns
  `{ original: {uri,width,height,bytes,mediaType,sha256}, derived: {...} }`.
- `contracts.ts`: `CapturedPage.originalOfRecord` stops aliasing `perspectiveCorrected` /
  `enhancedColor` / `enhancedGray`. On the v1 SystemScanner path `perspectiveCorrected` still equals
  the original (the OS corrected it) — that stays true and stays commented as the honest trade DCE §3
  describes.
- `registerDocument` computes **both** paths deterministically at registration
  (`{org}/{load}/{id}.orig.jpg`, `{org}/{load}/{id}.archive.webp`) and returns two signed upload URLs.
- The outbox handler uploads the ARCHIVE immediately and the ORIGINAL only when NetInfo reports an
  unmetered connection: a new `isUnmetered()` in `src/lib/connectivity.ts` reading
  `state.type === 'wifi' || state.details?.isConnectionExpensive === false`. A pending original is an
  ordinary staged file, so retry, replay-safety and the orphan sweep all already work.
- `stageFile` gains an index per artifact — it already takes one (`stageFile(uri, recordId, index)`).
*Verify:* driver tests for the metered/unmetered branch and for "original still pending after the
archive landed"; an `apps/api` test that both paths are returned and that registering twice is
idempotent; on-device, capture on cellular → archive uploads, original waits; join Wi-Fi → original
uploads exactly once.
*Done-when:* the evidentiary record is the bytes the scanner produced, and a driver on cellular does
not pay for it twice.

---

### PHASE 5 — Derive the thresholds, then enforce them

*This is where numbers are set, and the only place in this plan where that is allowed.*

**Step 5.1 — Telemetry (Phase 8 of the audit, brought forward because 5.2 cannot run without it).**
*Build:* populate `CaptureMetadata` for real — device model and OS version, pre-downscale capture
dimensions, `captureMs`, `processingMs`,
`scannerVersion`, auto-vs-manual, every metric score, and whether the driver re-shot. Written to the
`capture_metrics` column from 4a. **No new table, no new RLS surface, no `lint:table-producers`
obligation.** Collect nothing about the person: device class and timings only, per the audit's own
rule.
*Where device model and OS version come from, since this was checked rather than assumed:*
**`CaptureNative.isSupported()` returns them.** `expo-constants`' `platform.ios.model` and
`systemVersion` are marked `@deprecated — moved to expo-device`, and `expo-device` is **not** a
dependency; adding a native package for two strings when we already own a native module would be a
dependency for nothing. `Constants.deviceName` is *not* the answer either — it is the user-assigned
name ("Miki's iPhone"), which is exactly the personal data this step is written to avoid.
*Verify:* an `apps/api` test that the column round-trips; `expectOrgScoped` on any new read.
*Done-when:* every capture carries enough to answer "did the scanner get worse on this device?".

**Step 5.2 — Derive each floor from the distribution (D-SCAN10).**
*Build:* nothing yet. Gather: the Step 0.3 corpus plus the real captures Step 5.1 has been recording,
labelled accepted/re-shot. For each metric, choose the floor at the point that separates the labels,
and **write the derivation into the config file beside the number** — the value, the sample it came
from, and the date. Ship as a new signed `configVersion` (`capture-2026.NN.0`).
*Verify:* the corpus classifies correctly at the chosen floors; a deliberately blurry real photograph
is rejected before upload; a legitimate dim-cab photograph is not.
*Done-when:* every threshold in `config.ts` names the measurement that produced it, and
`capture.tsx:87`'s promise — *"The image is checked for quality before it uploads"* — is true for
blur, glare, shadow, brightness and contrast, not only resolution.

**Step 5.3 — Coverage stops being asserted (F6).**
*Build:* delete `coverageFraction: 1` from `nativeSystemScannerProvider.ts:46`. Either measure it (the
OS crop's area against the frame is not available — so it cannot be measured on the v1 path) or
report `na`. **Report `na`.** A number nobody measured is exactly what `config.ts` forbids, and `na`
is not a silent pass: it is a stated gap that the server backstop covers, and it is one of the
concrete signals feeding the Phase 7 decision.
*Done-when:* no invented number remains in the metric path.

**Step 5.4 — Wire the config verifier (F8 of the audit's list; `engine.ts:23`).**
*Build:* a real Ed25519 verifier over a pinned public key, and the remote fetch at app start. The
signing, monotonicity and fail-to-last-known-good machinery is already built and tested — only the
verifier and the fetch are missing. *Depends on §6 Q2.* Until Q2 is answered the code keeps the
reject-all verifier, which is safe and already labelled.
*Done-when:* a threshold can be retuned without an app release, which is DCE P1's entire purpose.

---

### PHASE 6 — Enhancement and profiles

**Step 6.1 — ARCHIVE and MACHINE derivatives (D-SCAN11).**
*Build:* add `enhance.archiveFacing` to `CaptureConfig` — DCE §4 specified it and the shipped type
omits it. Native `enhance(uri, profile)` produces: ARCHIVE (illumination normalisation from the same
tiled background estimate `metrics.ts` already computes, grey-world white balance, gentle
edge-preserving sharpen, **colour preserved**) and MACHINE (grayscale, local contrast, denoise).
*The hard constraint, stated because it is the one that can quietly destroy value:* trucking paper
carries signatures, coloured stamps, red hazmat marks, highlighter and handwritten corrections. The
archive profile is conservative and **never binarises**. Every enhancement step is versioned so a
verdict stays reproducible.
*Verify:* fixture tests asserting that a coloured stamp survives the archive profile with its hue
intact; that MACHINE improves OCR legibility metrics on the soft fixtures without improving them on
the blown ones (an enhancement that "improves" an unrecoverable page is inventing information).
*Done-when:* three outputs exist and each is fit for its own purpose.

**Step 6.2 — Document-type profiles.**
*Problem:* `hazmat/capture.tsx` hardcodes `kind: "bol"`, page 1, and creates a hazmat load. Every
document type the driver-documents feature needs would currently be a copy of that screen — the
workaround shape root `CLAUDE.md` names explicitly.
*Build:* a `DocumentProfile` in `config.ts` (expected aspect, colour preservation, sharpening,
contrast, auto-capture thresholds, page orientation, OCR mode) and a profile id threaded through
`scan()`. **Profiles are configuration; no trucking vocabulary enters the CV code.** The capture
screen takes a profile and a destination rather than hardcoding hazmat.
*Done-when:* adding "Registration" or "Maintenance invoice" is a config entry and a route, not a new
screen — which is the seam the documents feature the owner asked for is built on.

---

### PHASE 7 — The v2 decision, made with a number (D-SCAN12)

*Not scheduled. This phase opens only if Phase 5's telemetry crosses a trigger.*

**Triggers, any one of which opens it:** (a) re-shoot rate above a threshold set in Step 5.2 from the
observed distribution; (b) any material rate of server-backstop rejections of client-accepted pages —
which would mean the client gate is not seeing what the server sees, the exact failure §0.2 found;
(c) a fleet on de-Googled/enterprise-locked Android (§6 Q4), for which `GmsDocumentScanner` does not
exist at all and v2's OpenCV path is the only answer.

**If it opens, the order is:** custom viewfinder (AVFoundation / CameraX) → corner detection
(`VNDetectDocumentSegmentationRequest` on iOS, OpenCV contours on Android) → corner refinement →
temporal stabilisation → the auto-capture state machine
(`SEARCHING → DOCUMENT_DETECTED → ALIGNING → STABILIZING → READY → CAPTURING → PROCESSING → REVIEW`,
pure and unit-tested in `capture-engine`, no React Native import) → metric-driven guidance → a
Reanimated overlay on the UI thread.

**What this phase spends that today's costs nothing:** the OS scanner means zero JS-thread load, zero
bridge traffic, and zero frame processing during capture. That is a real asset, and v2 spends it.

**C++ and ML remain closed:** C++ opens only if Phases 3 and 6 show a *measured* divergence between
the Swift and Kotlin implementations that the fixture corpus cannot hold; ML opens only if v2's own
benchmark shows traditional CV plateauing on the hard cases. Neither is scheduled and neither should
be started on the strength of this document.

---

## 5. What is deliberately not in this plan

- **Replacing the camera stack.** No measurement supports it yet; Phase 7 is where that changes.
- **OpenCV, C++, TFLite, Core ML.** §7 states the evidence each would need.
- **`src/features/loads/stopCapture.ts`.** It is a second, ungated capture path (raw
  `expo-image-picker`, 1600px, q0.6) and it should come behind the provider seam — but it serves a
  different purpose (proof-of-work photos, not documents) and folding it in mid-plan would widen the
  blast radius of every phase. It is named here so it is not forgotten, and it belongs immediately
  after Phase 6.2, when profiles make it a configuration rather than a merge.
- **The documents surface itself** (list, upload, categories) and **driver performance/coaching**.
  This plan builds the scanner they stand on and, at 6.2, the seam they plug into.

---

## 6. Open questions — each with the decision the code takes today

**Q1 — How long is an ORIGINAL retained, and where?**
*Candidates:* (a) upload always, keep forever — a VisionKit page is ~2-4 MB, so a 3-page BOL is
~12 MB per capture on a driver's cellular plan; (b) archive only, original on-device for N days;
(c) archive immediately, original deferred to an unmetered connection, retained per the evidence
rule. *Recommendation and what the code does until ruled otherwise:* **(c)**, because the outbox
already provides staging, idempotent upload and retry, and `@react-native-community/netinfo` is
already a dependency. *Fallback if the owner rejects (c):* Phase 4b ships with the original uploading
immediately alongside the archive — one line, and the driver pays the bytes.
*Owner decision needed on:* the retention window, and whether `hazmat_documents` originals join
`RETENTION_FORBIDDEN` (root `CLAUDE.md` lists `documents` among the append-only evidence tables, which
suggests yes).

**Q2 — Where does the config signing key live and who may sign?**
Blocks Step 5.4 only. *Until answered:* `engine.ts` keeps the reject-all verifier and the bundled
signed default — safe, already labelled `TODO(Slice E)`, and it means the gate can never be weakened
remotely. *Recommendation:* the key lives where the OTA code-signing key lives (`certs/`, public
committed, private on the server — decision D-S7), because the trust model is identical and a second
key-management story is a second thing to get wrong.

**Q3 — Is the fixture tolerance in Step 3.1 right?**
±2% relative on blur and ±0.002 absolute on the fractions are stated so the first implementer does
not pick a number under pressure. They are a starting point derived from float-vs-integer rounding
across three languages, **not a measurement**. If the first real implementation misses them, the
correct response is to record why in §8 and re-derive — never to widen the tolerance to make a run
green.

**Q4 — Are there de-Googled or enterprise-locked Android devices in the fleet?**
Decides how much Step 1.1 is worth and is trigger (c) for Phase 7. Nothing in the repository records
the device population. *Until answered:* Step 1.1 ships anyway (it is cheap and it is correct
regardless), and Phase 7 does not open on this trigger.

**Q5 — Has the native provider ever run on a device?**
Step 0.1 answers it. It is listed here because it is the one unknown that can change Phase 1's
starting point, and because `RELEASE-GATE.md` Gate C being unsigned means nobody should assume either
answer.

---

## 7. Risk register

| Risk | Why it is real here | Mitigation in this plan |
|---|---|---|
| Native code merges without compiling | §0.4: zero native steps in `ci.yml`; Kotlin compiles post-merge, Swift never | Step 0.4 adds a PR-time Android compile; §3.4 makes the iOS build a required manual step of every native PR |
| A threshold gets invented under deadline pressure | It has already happened — `image.ts:72` says "corpus-tuned in H11"; H11 never ran, and 100/0.06 have gated production since | D-SCAN10: every metric ships in shadow mode; Step 5.2 derives each floor from a labelled distribution and records the derivation beside the number |
| The three implementations drift | Three languages, one definition, and nothing today compares any two | D-SCAN8 (the server uses the TS reference directly, so only two reimplementations exist) + D-SCAN9 (fixture corpus + `lint:scanner-parity`) |
| A column ships with its reader and the app 500s for ~3 minutes | Measured on #430: 9m10s of 500s; the window is now 2m44s, which is *too short to watch* | §3.2: Phase 4 is split into 4a and 4b, and §4 says they must not be combined |
| Enhancement destroys evidence | Trucking paper carries signatures, coloured stamps, red hazmat marks | Step 6.1's constraint: conservative, never binarise, colour preserved, fixture tests asserting a stamp's hue survives |
| Storage cost grows silently with three outputs | ~3× per page before any deduplication | Q1 decides retention before Phase 4b ships; `original_bytes`/`archive_bytes` from 4a make the cost measurable rather than discovered |
| The plan drifts from the tree between sessions | This document is the memory; the chat is not | §3.1 resume ritual + §8 dated progress log (append lines; never edit table rows — parallel PRs conflict on those every time) |

---

## 8. Progress log

Append a dated line when a step ships. Do not mark table rows.

- **2026-09-07** — Phase 0's buildable work SHIPPED and merged: #614 (0.2, five image-pipeline
  properties pinned, 7 cases), #615 (0.3, 24-page synthetic corpus + generator + PNG codec + integrity
  test), #616 (0.4, `native-android` CI job + the driver's four never-run gates + the module's gradle
  output ignored), #617 (0.1 fixture half: two printable A4 calibration targets, a 5x7 font, region
  geometry in the manifest, 9 cases reading the declared truth back out of the pixels, and the
  public-repo PII rule for real paperwork with its ignore entry verified before any photograph
  exists). Every check in all four was proven by mutation, never by a green run. Main at 8066e1f.
  Measured on the way through: `:capture-native:assembleDebug` is 47s cold and 9s warm locally,
  3m21s in CI; the synthetic corpus separates every axis it claims to (blur 14199 sharp / 1488 motion
  / 6 heavy-soft; glare 0.0000 / 0.0360 / 0.6663).
- **2026-09-07** — D-SCAN13: the owner moved the device session to the end of the programme. Step 0.1
  no longer gates Phase 1. Every native step from here owes an on-device verification, and those debts
  are collected in this log rather than in anybody's memory.
- **2026-09-07** — **PHASE 1 COMPLETE**, merged as #618/#619/#620/#621 (main d0de05c). 1.1 the
  rejection taxonomy stops dying at the last hop (anticipated outcomes are values, not exceptions;
  Android's isSupported stops returning a hardcoded true; the taxonomy gains a runtime counterpart).
  1.2 multi-page — a three-page BOL stopped uploading one page and calling it done; one outbox record
  for the set, all-or-nothing refusal naming the page, legacy single-register records still drain.
  1.3 the integrity hash means one thing and the server checks it, for driver captures only.
  1.4 both OOM paths closed (iOS bounded to 2 in flight with a per-page autorelease pool; Android
  header-sized decode + recycle), the temp-file leak closed on both the refused and accepted paths,
  and cancel() stops being able to hang a capture.
  Measured along the way: the Swift compiled for the first time on record (`** BUILD SUCCEEDED **`,
  scheme CaptureNative) and surfaced a pre-existing no-op downcast, now removed; `apps/api`'s known
  flake reproduces WITHOUT the matrices (23 suites failing together then recovering — see its memory
  note). Runtime version 1.0.1 → 1.0.3. Two mutations during the phase broke syntax rather than
  behaviour and ran nothing; both were caught and redone, which is the argument for reading mutation
  output rather than trusting that a mutation ran.
- **2026-09-07 — OWED ON DEVICE, the session agenda so far** (D-SCAN13). Nothing below is verified;
  every one of them is a claim that currently rests on a compile and a unit test:
  1. An Android phone with Play services disabled reaches "connect to Wi-Fi once, then retake" (#618).
  2. An unsupported iOS device reaches its own message rather than "something went wrong" (#618).
  3. A real three-page BOL arrives as three documents with ONE analysis (#619).
  4. A partially blurred multi-page set names the right page (#619).
  5. A capture through the JavaScript fallback survives the server's hash verification (#620).
  6. A ten-page scan completes on the min-spec Android without an OOM kill (#621).
  7. iOS memory stays flat across the same ten-page scan (#621).
  8. A rejected capture leaves no file behind (#621).
- **2026-09-06** — Plan written. Grounded in the scanner audit of the same date and in five
  measurements taken against this repository's installed `sharp` (§0.2, M1–M5). Nothing built yet;
  Step 0.1 is the next action and it needs the Mac and two phones.
