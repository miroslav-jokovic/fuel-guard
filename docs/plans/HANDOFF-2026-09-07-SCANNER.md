# Handoff — the scanner has one metric definition; nothing has been on a phone (2026-09-07)

**Scope: the driver document scanner only.** For fuel, Samsara and SMS, `HANDOFF-2026-09-06.md` still
stands and is untouched by any of this.

**`docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md` is the memory; this file is not.** It goes stale.
Where this disagrees with that plan's §8 progress log, **the log wins** — it is appended to on every
step and this is a snapshot of one evening.

---

## 1. Where to start

1. Read `SCANNER-UPGRADE-PLAN.md` top to bottom. §1 (decisions D-SCAN1–13), §3 (execution protocol),
   §8 (the log). Then this file's §5 and §6.
2. `git log --oneline -15`, `git branch --show-current`.
3. **The next step is Phase 3.1 — `measure()` on iOS.** Phase 0, 1 and 2 are complete and merged.
4. One step per branch (`claude/<topic>`), PR to `main`, merge after CI. The owner's standing
   instruction as of 2026-09-07 is **merge them as they go green**.

---

## 2. What landed

Eleven merges, #614 through #624, plus the plan itself. `main` at `e776df0`.

| PR | Step | What it did |
|---|---|---|
| **#614** | P0.2 | Pinned the five measured properties of the image pipeline (M1–M5). The evidence everything else rests on. |
| **#615** | P0.3 | 24-page synthetic fixture corpus + a committed generator + a 60-line PNG codec we own. |
| **#616** | P0.4 | **CI compiles the native module.** It never had. Also wired in the driver's own four lint gates, which had never run in CI either. |
| **#617** | P0.1 (fixtures) | Two printable A4 calibration targets, a 5×7 font, and the public-repo PII rule for real paperwork. |
| **#618** | P1.1 | The rejection taxonomy stops dying at the last hop — anticipated outcomes are values, not exceptions. |
| **#619** | P1.2 | **A three-page BOL stopped uploading one page and calling it done.** |
| **#620** | P1.3 | The integrity hash means one thing, and the server checks it. |
| **#621** | P1.4 | Both OOM paths closed; the temp-file leak closed; `cancel()` can no longer hang a capture. |
| **#622** | P2.1 | `metrics.ts` becomes the implementation of record, plus `expected.json`. |
| **#623** | P2.2 | `lint:scanner-parity` — one definition, enforced. |
| **#624** | P2.3 | The server calls the reference, on the **uploaded** bytes. |

**⚠ #613 (the plan document) is still OPEN.** It carries D-SCAN13, the Phase 1 and 2 logs, and the
device-session agenda. **Merge it** — a fresh session reads `main`, and without it the plan is invisible.
This handoff is on that same branch, so one merge lands both.

---

## 3. The one paragraph that matters most

**Everything above is a claim about code, and none of it has been on a phone.** D-SCAN13 (the owner's
ruling, 2026-09-07) moved the device session to the END of the programme: build it all, then connect a
device to the MacBook and test the finished thing. That is a legitimate trade and it was taken
deliberately — but it means CI compiles the Kotlin, a Mac compiles the Swift, and **"it builds" is the
strongest claim available for months of work.** §5 is the bill.

There is a second, sharper edge to it. Nothing in the repository establishes that a driver has **ever**
completed a scan through the native module rather than the `expo-image-picker` fallback
(`RELEASE-GATE.md` Gate C has been unsigned since August). If the answer turns out to be "never", the
device session is a **first integration**, not a confirmation. Budget it that way.

---

## 4. What the audit actually found, in one place

The capture engine's config asserted in a comment that its client thresholds matched the server's
usability gate and that "client and server must agree". They could not. Five measurements, taken
2026-09-06 against this repo's installed `sharp`, all now pinned by
`apps/api/src/modules/hazmat/hazmatExtraction/imageSemantics.test.ts`:

| | |
|---|---|
| **M1** | `sharp.convolve` **clamps** the Laplacian's negative lobe — a 0→255 step edge answers `[0,0,0,255,0,0,0,0]`, discarding every light-on-dark edge |
| **M2** | Blur variance moved **4283.7 → 7299.9** on one image between 3000 px and 800 px |
| **M3** | `sharp.greyscale()` weights R/G/B **127/220/76** — a linear-light luminance, neither Rec.601 nor Rec.709 |
| **M4** | Default `lanczos3` **manufactured 10.05% glare** on a page whose brightest true pixel was 235 |
| **M5** | The gate ran on the **normalized** image, where `.normalise()` had already stretched the max to 255 and inflated blur 1.9× |

Underneath: the shipped floors of `100` and `0.06` were never calibrated — `image.ts` deferred it to
"H11", and H11 never ran.

**All five are now closed.** There is one metric definition (`packages/capture-engine/src/metrics.ts`),
the server calls it, and `lint:scanner-parity` stops a second appearing.

---

## 5. ⚠ Owed on device — the session agenda

Nothing here is verified. Every line is a claim resting on a compile and a unit test.

1. An Android phone with Play services disabled reaches *"connect to Wi-Fi once, then retake"* (#618).
2. An unsupported iOS device reaches its own message, not "something went wrong" (#618).
3. A real three-page BOL arrives as three documents with **one** analysis (#619).
4. A partially blurred multi-page set names the **right** page (#619).
5. A capture through the JavaScript fallback survives the server's hash verification (#620).
6. A ten-page scan completes on the **min-spec Android** without an OOM kill (#621).
7. iOS memory stays flat across the same ten-page scan (#621).
8. A rejected capture leaves no file behind (#621).
9. **Which provider actually runs** — `capture.native.system_scanner` or `capture.js.expo_image_picker`.
   This is §6 Q5 and it is the one that could change the plan.

**The session's tooling is already built and merged.** Print both sheets from
`packages/capture-engine/fixtures/targets/` at **100% / actual size** (not fit-to-page — every printed
dimension is labelled and scaling invalidates all of them). The shot list is
`packages/capture-engine/fixtures/real/README.md`: 12 conditions × 2 sheets × 2 capture routes = 48
photographs, about an hour, in one sitting.

**⚠ This repository is PUBLIC.** Photographs of our own target sheets are committable and are the
re-runnable benchmark. Photographs of real customer paperwork go to
`fixtures/real/private/` — gitignored before the first photograph existed, verified with a probe file.
`docs/psp-docs/` and `docs/McLeod-Testing/` are the precedent and record why: untracking later removes
nothing from history.

---

## 6. Traps and lessons this programme paid for

**Read mutation output; do not trust that a mutation ran.** Four times in this programme a mutation
*passed* and the cause was the mutation or the test, not the code:

- A vitest path relative to the repo root instead of the package: the tests never ran, and five
  "failures" were a resolver error. That would have read as proof.
- A mutation that appended dead code instead of reordering two checks.
- A mutation that broke syntax rather than behaviour, so nothing executed.
- **Two tests that were simply too weak**: a step edge cannot detect a clamped Laplacian (its mirror
  yields the same multiset of responses — thin lines discriminate), and a page that is ⅜ ink cannot
  detect a median-based shadow metric. Both are now rewritten with a note saying why the obvious
  version is useless.

**`apps/api`'s test flake reproduces WITHOUT the matrices.** Previously believed to need their CPU
contention. Measured 2026-09-07: `pnpm --filter @silvicom/api test` in a bare loop failed **23 suites
at once** (3066 passing), then seven consecutive clean runs. A cohort failing together and recovering
is strong evidence for the standing port-reuse hypothesis. Still unfixed; see its memory note.

**Gates catch their own obsolescence if you let them.** `lint:scanner-parity`'s staleness rule caught a
carve-out added speculatively *before the gate shipped*, then caught its own waiver going stale the
moment Step 2.3 removed the duplicate it covered.

**`lint:comment-claims` is stricter than it looks.** "pinned by `somefile.test.ts`" fails; it wants a
quoted `it(...)` title.

**Native verification is manual and required.** `./gradlew :capture-native:assembleDebug` (47s cold,
9s warm; CI runs it now) and `xcodebuild -workspace ios/FuelGuardDriver.xcworkspace -scheme
CaptureNative -sdk iphonesimulator build` on the Mac. **iOS is compiled nowhere in CI** — macOS runners
bill at ~10× Linux and that trade has not been made. Bump `apps/driver/runtime-version.json` on every
native change (now **1.0.3**).

**`packages/capture-engine` has no `@types/node` on purpose.** Its header promises it imports nothing
platform-specific and **no lint gate enforces that** — the absence of Node types in its tsconfig is the
only guard. Editor errors in its test files are that guard working. Installing `@types/node` to silence
them would hand `src/` the globals it is promised not to have.

---

## 7. Phase 3 — what is next, precisely

**3.1 iOS `measure()`** · **3.2 Android `measure()`** · **3.3 wire both into the providers in shadow mode.**

Both platforms reimplement `packages/capture-engine/src/metrics.ts` and are held to
`fixtures/expected.json` within the tolerances that file records. The plan's §4 has the full step text.
Four things to carry in:

- **Plain Swift and plain Kotlin, no Accelerate.** The point is a loop a reviewer can line up against
  the TypeScript. vImage is an optimisation for later, and only if measured slow.
- **The tolerances are a starting point, not a measurement** (§6 Q3). If the first implementation misses
  them, find out why and record it. **Never widen a tolerance to make a run green.**
- **3.3 ships in shadow mode.** The config's new floors are `null`, which the gate must read as `na`,
  not coerce to `0` — a `null` silently becoming zero would pass everything. Add that case and a test.
- **F7 rides along in 3.3**: `smallTextBandCoverage` is currently `Σ(line heights)/imageHeight`, which
  grows with line count and is not a coverage fraction; `textCoverageFraction` sums boxes instead of
  unioning them. Both floors drop to `null` until Step 5.2.

---

## 8. Open questions (plan §6, unchanged)

| | | |
|---|---|---|
| **Q1** | How long is an untouched ORIGINAL retained, and does it join `RETENTION_FORBIDDEN`? | **Owner.** Blocks nothing until Phase 4b; the code defaults to archive-now / original-on-Wi-Fi. |
| **Q2** | Where does the config signing key live? | Blocks only Step 5.4. Until then the reject-all verifier stands, which cannot weaken the gate. |
| **Q3** | Are the fixture tolerances right? | Answered by Phase 3's first implementation. |
| **Q4** | Are there de-Googled Android devices in the fleet? | Decides Phase 7 trigger (c). Nothing records the device population. |
| **Q5** | Has the native provider **ever** run on a device? | The device session. See §3. |

---

## 9. What is deliberately NOT done

- **No custom camera, no OpenCV, no C++, no ML.** Phase 7 opens only on a measured trigger; §7 of the
  plan states the evidence each would need.
- **`src/features/loads/stopCapture.ts` is still a second, ungated capture path** (raw
  `expo-image-picker`, 1600px, q0.6). Named in the plan §5 as belonging immediately after Phase 6.2,
  when profiles make it a configuration change rather than a merge.
- **The documents surface and driver performance/coaching** — the two features that prompted all of
  this — are not started. Phase 6.2 builds the seam they plug into.
