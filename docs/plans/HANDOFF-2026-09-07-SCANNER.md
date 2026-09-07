# Handoff — Phases 0–3 are done; nothing has been on a phone (2026-09-07, revised)

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
3. **The next step is Phase 4a — the `original_of_record` migration.** Phases 0, 1, 2 and 3 are
   complete and merged. **Read §7 before starting it: Phase 4 is the first part of this programme
   that writes to the production schema, and it carries an owner question.**
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. The owner's standing
   instruction as of 2026-09-07 is **merge them as they go green**.

---

## 2. What landed

Fifteen merges, #614 through #628, plus the plan itself (#613). `main` at `dffd445`.

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

---

## 3. The one paragraph that matters most

**Everything above is a claim about code, and none of it has been on a phone.** D-SCAN13 (the owner's
ruling, 2026-09-07) moved the device session to the END of the programme. That is a legitimate trade
and it was taken deliberately — but it means CI compiles the Kotlin, a Mac compiles the Swift, and
**"it builds" is the strongest claim available for months of work.** §5 is the bill, and it is now
sixteen items long.

There is a second, sharper edge. Nothing in the repository establishes that a driver has **ever**
completed a scan through the native module rather than the `expo-image-picker` fallback
(`RELEASE-GATE.md` Gate C has been unsigned since August). If the answer is "never", the device
session is a **first integration**, not a confirmation. Budget it that way.

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

**`packages/capture-engine` has no `@types/node` on purpose.** No lint gate enforces its
platform-independence — the absence of Node types in its tsconfig is the only guard. Editor errors in
its test files are that guard working.

**Bump `apps/driver/runtime-version.json` on every native change** (now **1.0.6**).

---

## 7. Phase 4 — what is next, and why it needs reading first

**4a — the migration only. 4b — the readers. They must not be combined** (`lint:migration-ordering`,
plan §3.2). A merge is served ~2m44s before its migration is applied, so a column and its first reader
ship in two separate merges. Migration numbers are **never pinned in advance** — next-numbered at
execution. Every new column is **nullable**, because `registerDocument` upserts and
`lint:upserts` exists for a reason.

**This is the first part of the programme that touches production data.** `migrate.yml` auto-applies
to production Supabase on merge to main, gated on CI green — a merged migration IS a deployed
migration. Everything before this was code.

**⚠ It carries an owner question.** §6 **Q1**: how long is an untouched ORIGINAL retained, and does it
join `RETENTION_FORBIDDEN`? It blocks nothing until **4b**, and the code's default until somebody
rules otherwise is archive-now / original-on-Wi-Fi. Raise it before 4b rather than at it.

Also worth knowing going in: `measure()` currently measures the **1568 px derivative**, not an
original, because there is no retained original yet. That is stated in `measurePage`'s comment and in
the §8 log, and it means **metrics recorded before Phase 4 are not comparable with those recorded
after** — which Step 5.2 needs to know when it derives thresholds from them.

---

## 8. Open questions (plan §6)

| | | |
|---|---|---|
| **Q1** | How long is an untouched ORIGINAL retained, and does it join `RETENTION_FORBIDDEN`? | **Owner.** Blocks nothing until Phase 4b; the code defaults to archive-now / original-on-Wi-Fi. |
| **Q2** | Where does the config signing key live? | Blocks only Step 5.4. Until then the reject-all verifier stands, which cannot weaken the gate. |
| **Q3** | Are the fixture tolerances right? | **ANSWERED, 2026-09-07 (#625).** No — they are ~7,700× looser than the noise floor and pass real definition errors. The contract tolerance is unchanged; a strict exactness bound was added beside it. See §4. |
| **Q4** | Are there de-Googled Android devices in the fleet? | Decides Phase 7 trigger (c). Nothing records the device population. |
| **Q5** | Has the native provider **ever** run on a device? | The device session. See §3. |

---

## 9. What is deliberately NOT done

- **No custom camera, no OpenCV, no C++, no ML.** Phase 7 opens only on a measured trigger; §7 of the
  plan states the evidence each would need.
- **No threshold has been derived.** Five image floors and both OCR coverage floors are `null` and
  gated on by nobody. Step 5.2 derives them from recorded values — which is why the device session and
  the shadow-mode telemetry matter more than any code left in the plan.
- **`src/features/loads/stopCapture.ts` is still a second, ungated capture path** (raw
  `expo-image-picker`, 1600px, q0.6). Named in plan §5 as belonging immediately after Phase 6.2.
- **The documents surface and driver performance/coaching** — the two features that prompted all of
  this — are not started. Phase 6.2 builds the seam they plug into.
