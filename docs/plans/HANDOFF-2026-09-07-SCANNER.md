# Handoff — Phases 0–4 are done; nothing has been on a phone, and now we know nobody ever has (2026-09-07, revised twice)

**Scope: the driver document scanner only.** For fuel, Samsara and SMS, `HANDOFF-2026-09-06.md` still
stands and is untouched by any of this.

**`docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md` is the memory; this file is not.** It goes stale.
Where this disagrees with that plan's §8 progress log, **the log wins** — it is appended to on every
step and this is a snapshot of one day.

---

## 1. Where to start

1. Read `SCANNER-UPGRADE-PLAN.md` top to bottom. §1 (decisions D-SCAN1–13), §3 (execution protocol),
   §8 (the log, which is now long and is the real record). Then this file's §5 and §6.
2. `git log --oneline -15`, `git branch --show-current`.
3. **The next step is Phase 5.** Phases 0, 1, 2, 3 **and 4** are complete and merged; Phase 4's
   three migrations are applied to production and verified by querying it. **Read §7 — it now says
   what Phase 5 needs and what it cannot have yet.**
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. The owner's standing
   instruction as of 2026-09-07 is **merge them as they go green**.

---

## 2. What landed

Fifteen merges, #614 through #628, plus the plan itself (#613), **plus six more on 2026-09-07 for
Phase 4: #630, #631, #632, #633, #634, #635.**

| PR | Step | What it did |
|---|---|---|
| **#614** | P0.2 | Pinned the five measured properties of the image pipeline (M1–M5). The evidence everything else rests on. |
| **#615** | P0.3 | 24-page synthetic fixture corpus + a committed generator + a 60-line PNG codec we own. |
| **#616** | P0.4 | **CI compiles the native module.** It never had. Also wired in the driver's own four lint gates. |
| **#617** | P0.1 | Two printable A4 calibration targets, a 5×7 font, and the public-repo PII rule for real paperwork. |
| **#618** | P1.1 | The rejection taxonomy stops dying at the last hop. |
| **#619** | P1.2 | **A three-page BOL stopped uploading one page and calling it done.** |
| **#620** | P1.3 | The integrity hash means one thing, and the server checks it. |
| **#621** | P1.4 | Both OOM paths closed; the temp-file leak closed; `cancel()` can no longer hang a capture. |
| **#622** | P2.1 | `metrics.ts` becomes the implementation of record, plus `expected.json`. |
| **#623** | P2.2 | `lint:scanner-parity` — one definition, enforced. |
| **#624** | P2.3 | The server calls the reference, on the **uploaded** bytes. |
| **#625** | P3.1 | `measure()` on iOS — and the finding that the fixture tolerance could not see a typo. |
| **#626** | P3.2 | `measure()` on Android, **bit-identical to iOS**, with its parity check now in CI. |
| **#627** | P3.3a | A retired threshold says `null`, and the gate reads that as `na` — never as `0`. |
| **#628** | P3.3b | Every capture measures five things and rejects on none of them; **F7** becomes a real coverage fraction. |
| **#630** | P4a | Migration 0326 — the original-of-record columns, no reader. |
| **#631** | Q1 | `hazmat_documents` joins `RETENTION_FORBIDDEN`. It was in **neither** list. |
| **#632** | P4a′ | Migration 0327 corrects 0326: the DEFERRED artifact must be the one nothing depends on. |
| **#633** | P4b-i | The server signs a second upload URL; the nightly sweep stops planning to delete the original. |
| **#634** | P4b-ii-a | **F1 is fixed.** `CapturedPage`'s four image fields stop aliasing; `measure()` moves to the original. |
| **#635** | P4b-ii-b | **PHASE 4 COMPLETE.** The outbox learns a third outcome so an original can wait for Wi-Fi. |

---

## 3. The one paragraph that matters most

**Everything above is a claim about code, and none of it has been on a phone.** D-SCAN13 (the owner's
ruling, 2026-09-07) moved the device session to the END of the programme. That is a legitimate trade
and it was taken deliberately — but it means CI compiles the Kotlin, a Mac compiles the Swift, and
**"it builds" is the strongest claim available for months of work.** §5 is the bill, and it is now
**twenty-one items long**.

There is a second, sharper edge, and on 2026-09-07 it stopped being a suspicion. **Production holds
zero hazmat loads, zero documents and zero runs** — measured against the linked Supabase project
while checking whether 0326's columns held anything. So the question was never "native provider or
`expo-image-picker`": *no capture has ever completed through any provider*. The device session is a
**first integration**, not a confirmation. Budget it that way. (§6 Q5 carries the one caveat: a
capture could in principle have been made and never drained from the outbox — but this repo is
configured against exactly one Supabase project, and it is production.)

---

## 4. What the metric work established, in one place

The capture engine's config asserted in a comment that its client thresholds matched the server's
usability gate. They could not, for five measured reasons (M1–M5, plan §0.2). All five are closed:
there is one metric definition (`packages/capture-engine/src/metrics.ts`), the server calls it, and
`lint:scanner-parity` stops a second appearing.

Phase 3 then held two native ports to it, and the result is stronger than the plan asked for:

- **iOS and Android are bit-identical to the reference and to each other.** Worst deviation across 24
  fixtures: `2.5815073644649034E-4 %` relative on blur, `4.995090079340514E-7` absolute on the
  fractions — **the same digits on both platforms**, and both figures are nothing but the rounding
  `expected.mjs` applies when it commits the baseline. The arithmetic agrees to the last count.
- **The declared corpus tolerance (±2%, ±0.002) cannot see a definition error.** Three were
  demonstrated to pass it: a Rec.709 coefficient off by one, a truncating box-downscale (1.775% on
  blur), and `kotlin.math.round`'s ties-to-even instead of ties-up (1.669%, and Android-only). The
  tolerance was **not widened or narrowed** — it stays as the cross-platform contract. `expected.json`
  now records `baselineDecimals`, and both harnesses check a second, strict bound derived from it:
  half a unit in the last committed place. All three mutations then fail. Headroom on the strict
  bound is **1.1×**.
- **Every image threshold is retired to `null`** except resolution (scale-free), the accept-score
  floor, and coverage (whose metric is still an assertion, removed in Step 5.3). `null` renders as
  `na`; a missing key is still rejected, so a signed config cannot switch a gate off by omission.

---

## 5. ⚠ Owed on device — the session agenda

Nothing here is verified. Every line rests on a compile and a unit test.

1. An Android phone with Play services disabled reaches *"connect to Wi-Fi once, then retake"* (#618).
2. An unsupported iOS device reaches its own message, not "something went wrong" (#618).
3. A real three-page BOL arrives as three documents with **one** analysis (#619).
4. A partially blurred multi-page set names the **right** page (#619).
5. A capture through the JavaScript fallback survives the server's hash verification (#620).
6. A ten-page scan completes on the **min-spec Android** without an OOM kill (#621).
7. iOS memory stays flat across the same ten-page scan (#621).
8. A rejected capture leaves no file behind (#621).
9. `measure()` is reachable across the Expo bridge on iOS and resolves its seven keys (#625).
10. `UIImage` on a device hands `CaptureImageDecode` the same pixels ImageIO hands the harness on
    macOS. A colour-managed source image is how it would differ (#625).
11. `measure()` is reachable across the bridge on Android (#626).
12. `BitmapFactory` hands `CaptureImageDecode` the same pixels `FixturePng` hands the unit test —
    `inPreferredConfig` being honoured, rather than a device preferring RGB_565, is how it would
    differ (#626).
13. A full-resolution `measure()` decode does not OOM on the min-spec Android. `measure()`
    deliberately does **not** use `inSampleSize`; the reason is in `CaptureImageDecode.kt` (#626).
14. A deliberately blurry page records a visibly worse `blurVariance` than a sharp one, and a
    glare-lit page a worse `glareFraction`. **This is Step 3.3's own verification and the only part
    of it a laptop cannot do** (#628).
15. Vision's `boundingBox` flip is the right way up — iOS converts from a **bottom-left** normalised
    origin, and a missed flip still produces plausible numbers on a vertically symmetric page (#628).
16. `measure()` on a ten-page scan does not regress Step 1.4's memory ceiling, now that each page is
    decoded a second time (#628).
17. A real scan produces **two** files per page, and the original is visibly larger than the
    derivative (#634).
18. Android's original is byte-identical to ML Kit's own file — it is a `copyTo`, so `cmp` should be
    silent (#634).
19. iOS's `jpegData(compressionQuality: 1.0)` at full resolution does not OOM on a ten-page scan.
    **This is the riskiest of the twenty-one:** it adds a multi-megabyte buffer per page to a
    pipeline Step 1.4 had to bound to two pages in flight, and no iOS job exists anywhere in CI
    (#634).
20. A capture registers, uploads **both** objects, and extraction succeeds — the first end-to-end
    proof that `sha256` (the archive's) and `integrityHash` (the original's) are the right way round.
    Getting them swapped fails every extraction with `integrity_mismatch` (#634).
21. A capture on cellular uploads the archive and leaves the original pending; joining Wi-Fi uploads
    it exactly once; the sync screen says *"Waiting for Wi-Fi to upload N original pages"* rather
    than showing a failure (#635).

Plus **§6 Q5 — which provider actually runs.** That is the one that could change the plan.

**The session's tooling is already built and merged.** Print both sheets from
`packages/capture-engine/fixtures/targets/` at **100% / actual size** (not fit-to-page — every printed
dimension is labelled and scaling invalidates all of them). The shot list is
`packages/capture-engine/fixtures/real/README.md`: 12 conditions × 2 sheets × 2 capture routes = 48
photographs, about an hour, in one sitting.

**⚠ This repository is PUBLIC.** Photographs of our own target sheets are committable and are the
re-runnable benchmark. Photographs of real customer paperwork go to `fixtures/real/private/`, which is
gitignored and was verified with a probe file before any photograph existed.

---

## 6. Traps and lessons this programme paid for

**Read mutation output; do not trust that a mutation ran.** Six times now a mutation *passed*, or ran
nothing, for a reason unrelated to the code:

- A vitest path relative to the repo root instead of the package: the tests never ran, and five
  "failures" were a resolver error.
- A mutation that appended dead code instead of reordering two checks.
- **Two** that broke syntax or a type rather than behaviour, so nothing executed. Both were redone.
- Two tests that were simply too weak: a step edge cannot detect a clamped Laplacian (thin lines
  discriminate), and a page that is ⅜ ink cannot detect a median-based shadow metric.
- **And one that passed because the test was inert:** removing the quartile tie-break did not fail the
  TypeScript test written for it, because V8's sort is stable. The committed baseline and the Swift
  suite caught it. Swift's `sorted` is **not** stable; Kotlin's `sortedWith` is.

**Two harnesses, and only one of them runs in CI.** `CaptureMetrics.kt` and `CaptureTextCoverage.kt`
import *nothing*, so their parity tests are plain JVM tests and `native-android` runs them on every
PR. iOS gets the identical comparison from
`apps/driver/modules/capture-native/tests/ios/run-metrics-parity.sh` — **by hand**, because macOS
runners bill at ~10× Linux. Run it on every change to any Swift file under `ios/`. It is deliberately
not a `lint:*` script: root `CLAUDE.md`'s rule is that a gate in `package.json` and in neither CI list
is not a gate, and this one cannot run on Linux. It is item 3 of the plan's §3.4 checklist.

**Two findings that cost a build each.** `javax.imageio` does not exist on an Android library's
unit-test classpath (it compiles against `android.jar`) — hence `FixturePng`, a test-only
transliteration of the corpus's own `png.mjs`. And `org.json` **is** in `android.jar`, so the mockable
jar shadows a real `org.json` dependency and every call throws "not mocked" — hence Gson.

**A PNG CRC is an unsigned 32-bit value.** `readUInt32BE` returns a negative Int for half of them, and
`CRC32.getValue()` returns a non-negative Long; without `and 0xFFFFFFFFL` every fixture is rejected.

**`apps/api`'s test flake reproduces WITHOUT the matrices.** Measured 2026-09-07: a bare loop failed
**23 suites at once** (3066 passing), then seven consecutive clean runs. Still unfixed; see its memory
note.

**Gates catch their own obsolescence if you let them.** `lint:scanner-parity`'s staleness rule caught
a carve-out added speculatively before the gate shipped, then caught its own waiver going stale.

**`lint:comment-claims` is stricter than it looks.** "pinned by `somefile.test.ts`" fails; it wants a
quoted `it(...)` title.

**⚠ Code the tests cannot reach is code no mutation can check, and this programme has now been bitten
twice in one day.** Pointing `measure()` at the derivative instead of the original — inverting
D-SCAN4 exactly — **passed the entire driver suite**, because `assemblePage` lived in
`nativeSystemScannerProvider.ts`, which imports the native bridge → `expo-modules-core` → a React
Native runtime. No unit test can import that file. It exposed a second defect on the way: the
resolution floor was reading the DERIVATIVE's long edge, which is `enhanceLongEdgePx` — a number we
chose — so the check passed by construction on a page captured at any resolution at all. The fix is
the rule `nativeScanOutcome.ts` already stated: **decisions there, I/O in the provider.** The same
trap was then avoided on purpose one merge later — `connectivity.ts` imports NetInfo and therefore
React Native, so `isUnmeteredConnection` lives in its own file.

**The driver suite runs in a `node` environment with no RN renderer** (`apps/driver/vitest.config.ts`).
That is the mechanical reason for the paragraph above: anything importing `react-native`,
`@react-native-community/netinfo` or `expo-modules-core` is unreachable from a test.

**§3.3's gate table names three scripts that DO NOT EXIST.** `lint:tokens`, `lint:theme` and
`lint:design` are not in `package.json`. The driver-touching gates that do exist:
`pnpm --filter @silvicom/driver lint`, `lint:tokens-parity`, `lint:token-schema`, `lint:token-gamut`.

**A signed upload URL is valid for two hours** (`storage-js`, verified in `node_modules`), which is
useless for an upload deferred to Wi-Fi. The client re-registers for a fresh one — registration is
idempotent. Worth knowing: **this client never uses the signed URL anyway**, it uploads with the
driver's own RLS-scoped session.

**`{id}.orig.jpg` was already taken.** `registerDocument` has written every `image/jpeg` capture to
that key since it was written, and the plan named the same key for the ORIGINAL. Both at one key
fails SILENTLY — the bucket denies overwrite, the second upload returns "already exists", and the
outbox treats that as success on purpose. The original is `{id}.original.jpg`.

**`packages/capture-engine` has no `@types/node` on purpose.** No lint gate enforces its
platform-independence — the absence of Node types in its tsconfig is the only guard. Editor errors in
its test files are that guard working.

**Bump `apps/driver/runtime-version.json` on every native change** (now **1.0.6**).

---

## 7. Phase 5 — what is next, and the one thing it cannot have

**Phase 4 is done and applied.** Three migrations (0326, 0327, 0328) are on the production schema and
were verified by querying it, not by trusting the workflow. `hazmat_documents` now carries
`original_storage_path`, `original_bytes`, `archive_bytes` and `capture_metrics`; `integrity_hash` is
the ORIGINAL's hash and `sha256` the ARCHIVE's; the nightly orphan sweep knows a path may
legitimately not exist yet; and the outbox has a third outcome so a deferred upload cannot
dead-letter.

**Phase 5 is where thresholds get derived, and it splits into what can be built now and what cannot.**

- **Step 5.1 (telemetry) — buildable today.** It populates `capture_metrics`, the column 4a created.
  D-SCAN13's shape ("build it out, then test on device") applies as it has all programme.
- **Step 5.3 (`coverageFraction: 1` becomes `na`) — buildable today**, and it is small: delete an
  invented number from `nativeScanOutcome.ts`'s `assemblePage`.
- **Step 5.2 (derive each floor) — CANNOT be done yet, and this is the honest blocker.** It derives
  every threshold from a labelled distribution of *recorded* values. There are none: §6 Q5 measured
  zero captures in production, so the only sample that exists is the 24 synthetic fixtures. **Step
  5.2 needs the device session first**, and shipping a threshold derived from synthetic pages alone
  would be exactly the invented number D-SCAN10 exists to prevent.
- **Step 5.4 (config verifier) — blocked on §6 Q2** (where the signing key lives). Until then the
  reject-all verifier stands, which cannot weaken the gate.

⚠ **One thing Step 5.2 must know when it does run:** `measure()` measured the 1568 px derivative
until #634 and measures the untouched ORIGINAL after it. Those are two eras of recorded metrics and
they are **not comparable** — different starting image, different resampler, different number of JPEG
re-encodes, even though D-SCAN1 downscales both to the same analysis edge. `capture_config_version`
dates every reading. In practice this costs nothing, because era one produced no rows at all.

## 8. Open questions (plan §6)

| | | |
|---|---|---|
| **Q1** | How long is an untouched ORIGINAL retained, and does it join `RETENTION_FORBIDDEN`? | **ANSWERED, 2026-09-07 (owner).** Kept as long as the archive — no expiry window, no deletion job. And it joins `RETENTION_FORBIDDEN` (#631); it had been in **neither** list. |
| **Q2** | Where does the config signing key live? | **Now the only open owner question, and it blocks Step 5.4.** Until then the reject-all verifier stands, which cannot weaken the gate. Recommendation in plan §6: the OTA code-signing key's home (D-S7), because the trust model is identical. |
| **Q3** | Are the fixture tolerances right? | **ANSWERED, 2026-09-07 (#625).** No — they are ~7,700× looser than the noise floor and pass real definition errors. The contract tolerance is unchanged; a strict exactness bound was added beside it. See §4. |
| **Q4** | Are there de-Googled Android devices in the fleet? | Decides Phase 7 trigger (c). Nothing records the device population. |
| **Q5** | Has the native provider **ever** run on a device? | **ALL BUT ANSWERED, 2026-09-07, and the answer is no.** Production holds zero hazmat loads, documents and runs — no capture has completed through ANY provider. See §3. |

---

## 9. What is deliberately NOT done

- **No custom camera, no OpenCV, no C++, no ML.** Phase 7 opens only on a measured trigger; §7 of the
  plan states the evidence each would need.
- **No threshold has been derived, and Step 5.2 cannot derive one until a phone has produced a
  capture.** Five image floors and both OCR coverage floors are `null` and gated on by nobody. The
  recorded distribution 5.2 reads from is empty — see §7. This is now the critical path of the whole
  programme, not a parallel debt.
- **`src/features/loads/stopCapture.ts` is still a second, ungated capture path** (raw
  `expo-image-picker`, 1600px, q0.6). Named in plan §5 as belonging immediately after Phase 6.2.
- **The documents surface and driver performance/coaching** — the two features that prompted all of
  this — are not started. Phase 6.2 builds the seam they plug into.
