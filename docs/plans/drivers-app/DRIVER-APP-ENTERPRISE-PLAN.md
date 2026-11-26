# Driver app: the enterprise plan (2026-11-26)

**Status:** written 2026-11-26 after the owner's Samsung tablet test of 2026-11-25. Decisions are D-DA1 onwards. Open
questions are Q-DA1 onwards.

**What it is:** one plan that takes the driver app from "works in a development build on one tablet" to "every company
driver uses it every day, and McLeod is written from it". It is cut into **segments** that separate chats can run at the
same time. Each segment names the files it owns, so two chats do not edit the same file.

**Owner input 2026-11-26.** These are the two inputs this plan is built on:

- "We are 99.99 %, if not 100 %, company drivers." **Pay and settlements, and detention and lumper requests, are out of
  scope** (D-DA1).
- "We will probably get McLeod API Kit access next week, and will be able to write directly to McLeod." The driver half of
  that work is segment S9. It follows the API Kit decision register; this plan does not restate it.

**How a question was answered.** Every answer in this plan comes from one of three places:

1. a code read on `origin/main` (e42783ccb), cited as `path:line`;
2. a measurement, with its date;
3. a published primary source: a regulation, platform documentation, or a vendor's own documentation (§10).

Where none of those can answer a question, it is not guessed. It is listed in §8 as an **outside fact**, with the person who
supplies it and a build for every possible answer. No ruling here rests on taste.

**What outranks this file:**

- `apps/driver/DESIGN.md` and `DRIVER-APP-VISUAL-2026-PLAN.md` own how the app looks. This plan adds no visual rule except
  the tablet rule in S4, and that rule lands in DESIGN.md itself.
- `docs/plans/mcleod/DECISION-REGISTER-2026-11-20-API-KIT.md` (branch `claude/mcleod-api-kit-build-plan`) owns every McLeod
  write. Its D-MK ids are cited here, never re-decided.

---

## 1. Where the app is today (measured 2026-11-25/26)

### 1.1 What works on origin/main

- **Sign-in and the four tabs:** Home, Loads, Documents, More.
- **Loads:** Load detail and Stop, with photos and late photos.
- **Messages and notifications.**
- **Shift check-in and end of shift.**
- **Hazmat BOL check, and safety score with leaderboard.**
- **Settings.**
- **The Stop screen's Navigate button,** which opens the phone's own maps app (`app/loads/[id]/stop/[stopId].tsx:201-208`,
  which calls `itineraryModel.ts:220-229`).
- **The offline queue:** a SQLCipher database with a key kept in SecureStore (`src/data/db.ts:6-32`).

### 1.2 The findings, ranked by how much they stop a driver

| # | Finding | Evidence | Segment |
|---|---|---|---|
| F1 | **Nothing has ever reached a driver's phone.** `driver-store.yml` has never run. There is no `EXPO_TOKEN` secret and no `driver-v*` tag. The APK and OTA lanes were deleted on 2026-10-22. | `driver-store.yml:12` reads "NOTHING BELOW HAS EVER RUN"; commit `d313fa8a1` deleted the lanes; `gh secret list` shows no token | S7 |
| F2 | **A load dispatched in McLeod never appears to its driver.** McLeod statuses project to `pending_approval/approved/in_transit/delivered/canceled`, never `offered`. The driver policies and the API admit only offered/accepted/in_transit/delivered/canceled, so an `approved` load is invisible. | `packages/shared/src/mcleodLoadProjection.ts:190-199`; `0371:71,85,99`; `driverLoads.ts:128-129` | S1 |
| F3 | **Stop actions on a McLeod load are refused.** `0141:304` refuses unless the load is accepted or in transit, so a stop on an `approved` load fails with DL003. Accept and Decline can never work, because the load is never `offered`. | `0141:122,304,365-399` | S1 |
| F4 | **Stop ids change on every McLeod sync.** Pending stops are deleted and inserted again on `(load_id, seq)`. There is no `mcleod_stop_id`, so a photo or action queued against a stop can point at a row that no longer exists. | `mirrorLoads.ts:109-126`; `tmsLoadIngestWriters.ts:134-162` | S1 |
| F5 | **From 2026-07-28 to 2026-11-25, nothing queued on a phone was ever sent.** The claim ran on a second, unkeyed SQLite connection, and the sync deleted the whole queue. Fixed in #2667. FR3 ("capture runs but nothing is stored", `FIELD-REPORTS.md:10`) falls inside that window and matches it, but it is still marked Open. | `outbox.ts:101-121`; `visual-2026-progress/2026-11-25-1200-device-pass-outbox.md` | S5 |
| F6 | **The outbox gives up after 8 attempts, 5xx included.** D-MK21 says it must never give up on network errors or 5xx. | `src/data/policy.ts:24,99-101` | S1 |
| F7 | **"Navigate" on Android routes a truck as a car.** `google.navigation:` has no truck profile: no height, weight or hazmat restrictions. That is the documented behaviour (§10 [N1]) and the most likely "routing issue" from the tablet. | `itineraryModel.ts:229` | S3 |
| F8 | **The Android scanner is Google's ML Kit,** not ours. Our own Android camera exists only uncommitted in `../FG-driver-device` (branch `claude/scanner-android`). On the tablet the scan screen holds about 1 GB of memory, and swap grew by about 50 MB over 4 minutes. One JVM test fails (`LiveEdgeGeometryTest`, "the outline appears after three valid frames and goes only after a 180 ms gap"). A `LEAK-EXPERIMENT` stub is still in `app/live-edge.tsx`. | Device measurements 2026-11-25 (dumpsys meminfo); worktree status | S2 |
| F9 | **Android receives no push notifications.** There is no `googleServicesFile`, so there is no FCM. | `app.config.ts` (absent); device pass item 2 | S7 |
| F10 | **Tablets get a phone layout.** The app is portrait-locked, and on a window of 600 dp or wider it shows one column capped at 560 dp. Android 16 ignores the portrait lock on wide windows for apps targeting API 36. | `app.config.ts:120,130`; `src/components/Screen.tsx:81-89` | S4 |
| F11 | **Nothing locks the app while the truck moves.** Location permissions are blocked on purpose. | `app.config.ts:288-293`; `DRIVER-APP-HARDENING-PLAN.md:427` | S6 |
| F12 | **The code contradicts DESIGN.md in three places:** `tokens.ts:30,42` says rows are 52 where D-DV10 says 56; `IconButton` is 44 where D-DV10 says 48; `EmptyState` carries an amber `sm` button (a second amber, at 44 pt). | `DESIGN.md:110-113`; `IconButton.tsx:57`; `EmptyState.tsx:30` | S5 |
| F13 | **Most of the Visual 2026 screens have never run on a device:** the Stop footer, late photos, and the map in both themes (#2650). | visual-2026-progress 2026-11-24 entries | S5 |
| F14 | **The store checklist is unfinished.** 16 KB page size is unmeasured, the Apple account is Individual, Data Safety is half done, and review credentials and screenshots are owed. | `RELEASE-GATE.md:127-136,176-178` | S7 |

**What F2–F4 mean:** today the app works end to end only for loads that Silvicom itself sends as `offered`. For the McLeod
loads every company driver actually runs, it fails. **F2–F4 are the reason S1 comes before any new feature.**

### 1.3 Facts that correct earlier statements

- **The app has a production Navigate button.** It hands the trip to the phone's maps app; the 2026-11-26 chat report said
  it had none. What is DEV-only is the in-app map route: `app/(tabs)/navigate.tsx:12` shows hardcoded sample data.
- **The hardening plan's row saying the gallery is "reachable in production" is out of date.** `app/gallery.tsx:96`
  redirects in production (`DRIVER-APP-HARDENING-PLAN.md:62`).
- **Root CLAUDE.md is out of date about the release lanes.** It still lists `driver-ota` and `driver-android` among the
  jobs `require-ci-green` serves; both were deleted on 2026-10-22. S7 corrects it.

---

## 2. What the app does: the feature list, ranked by evidence

**How features were chosen.** Section §10 [F] lists what 12 carrier and platform driver apps document. A feature's rank
here is how many of those 12 document it. That ranking is the evidence. Company drivers only removes pay (D-DA1).

| Feature | Apps documenting it (of 12) | Silvicom today | Decision |
|---|---|---|---|
| Loads and stops, with reference numbers | 12 | ✅ but broken for McLeod loads (F2–F4) | **S1 fixes it** |
| Document scan (BOL/POD) | 11 | ✅ iPhone own camera, Android ML Kit | **S2** |
| Messaging with dispatch | 10 (3 of those as contacts only) | ✅ | Keep |
| DVIR or maintenance request | 6 | ❌ | **S8a** (D-DA6) |
| Training | 6 | Text link to the web portal | **S8b** (D-DA7) |
| Hours of service (HOS) shown | 5 | ❌ | **S8c**, read-only from Samsara (D-DA8) |
| Navigation | 5, and 2 of those hand off to a truck GPS app | Hand-off to car maps | **S3** |
| Safety score | 5 | ✅ | Keep |
| Pay | 5 | ❌ | **Out of scope** (D-DA1) |
| Referral, company news | 2 and 1 | ❌ | **Later** (D-DA9) |
| Home time, time off | 1 (McLeod Sidekick) | ❌ | **Later**; needs `equipStatus` (Drivers role only, API Kit WS:172) |
| ETA or delay report | 0 | ❌ | **Not built** (D-DA10) |
| Locked while moving | 6 (all that document it lock at 5 mph or "while driving") | ❌ | **S6** |

**What Silvicom has that none of the 12 document:** the hazmat BOL check, the shift check-in, and late photos.

---

## 3. Decisions

- **D-DA1, scope.** No pay, settlement, detention or lumper *request* screen.
  - Basis: the owner, 2026-11-26.
  - Lumper and revised-RC *documents* stay a document type if billing needs them from drivers. That is outside fact X6.
- **D-DA2, order.** S1 (data correctness) and S7 (release lane) gate every driver benefit. No new feature segment (S8)
  merges a driver-visible screen before S1's steps S1.1–S1.4 are on staging.
  - Basis: F1–F4. A feature on loads the driver cannot see is not a feature.
- **D-DA3, one source per fact.**
  - Loads, stops and their status come from McLeod, through the mirror, and through `/ws` once S9 is live.
  - HOS comes from Samsara.
  - Fuel stops come from the fuel planner.
  - The app never computes a second ETA (D-DV13).
  - Basis: the CLAUDE.md "No workarounds" rule ("Deriving beats restating").
- **D-DA4, navigation is a hand-off to a truck GPS app,** not an in-app route.
  - Basis: of the 5 apps with navigation, Motive hands off to Trucker Path and Trimble to CoPilot (§10 [F]); Samsara has its
    own commercial navigation (§10 [N6]); `NAVIGATION-PROGRAMME-PLAN-V2.md` NP1 is a 6–8 week compliance engine that has
    not started.
  - The programme plan stays parked. Nothing in this plan builds it.
- **D-DA5, the app locks at 5 mph or more** and unlocks after 3 s at 0 mph.
  - Basis: 49 CFR 392.80 and 392.82 bar a carrier from allowing texting or hand-held phone use while driving, and 390.5 makes
    reading a message "texting" (§10 [R1–R3]). Motive (≥5 mph, 3 s unlock), Samsara (5 mph), J.B. Hunt (5 mph) and Schneider
    ("while driving") all lock (§10 [L1–L4]).
  - The thresholds are tunables, set from these sources.
- **D-DA6, inspection and maintenance request.** A driver reports a truck or trailer defect with a photo. The report lands
  in the roadside-repair and work-order flow, and is never a second ticket system.
  - Basis: 6 of 12 apps; `docs/plans/safety-dqf/ROADSIDE-REPAIR-FLOW-PLAN.md` already models the work order, and the
    S8a design step re-reads it before building.
  - Whether it is a full DVIR is outside fact X7.
- **D-DA7, training plays in the app.** It is the same Safety › Training course and quiz the web portal plays (D-TR13).
  - It is read from the training module, never copied. Basis: 6 of 12 apps, and D-DA3.
- **D-DA8, HOS is shown, never edited.** The driver's remaining drive, shift and cycle time is read from Samsara and labelled
  with its age.
  - The ELD of record stays Samsara's app. Only the ELD may edit duty status (49 CFR 395.8 and 395.22).
- **D-DA9, referral and news wait** until S1–S8 are on drivers' phones. Basis: 2 of 12 and 1 of 12.
- **D-DA10, no driver ETA or delay report.**
  - Basis: 0 of 12 apps document one.
  - API Kit C-18 holds the ETA write behind its 14-day accuracy check.
  - DB7 measured the board's "at risk" verdict right only 18 % of the time within 4 h of arrival
    (`DRIVER-APP-VISUAL-2026-PLAN.md:566-577`).
  - Revisit only when Q-DB4 is fixed.
- **D-DA11, tablet layout follows Android's window size classes**, never an `isTablet` flag (§10 [U2]): compact under
  600 dp, medium 600–840 dp, expanded 840 dp and wider. The rule goes into `DESIGN.md`.
- **D-DA12, every driver-visible change ships through the store lane** (S7) and is seen on the Galaxy Tab A9 before it is
  called done.
  - Screenshots go to the owner before merge (DESIGN.md:358).

---

## 4. Segments: who runs what, and in parallel

```
        ┌─ S1 Data correctness (API + migrations + loads hooks) ─┐
S0 ─────┼─ S2 Android scanner  ─┐                                 ├─► S8 New features ─► S9 McLeod writes
(facts) ├─ S3 Navigate hand-off ┼─► S5 Defect sweep ─► device gate┘
        ├─ S4 Tablet layout    ─┘
        ├─ S6 Driving lock
        └─ S7 Release lane (owner actions + workflow)
```

**What can run in parallel:**

- S1, S2, S3, S4, S6 and S7 can each start after S0. They own disjoint files (each segment's **Owns** line).
- S5 starts when the owner's defect list (X1) arrives.
- S8 waits on D-DA2.
- S9 waits on the API Kit outside answers (register §6).

**Where two segments touch one file:**

- `app/loads/[id]/stop/[stopId].tsx` is edited by S1 (actions) and S3 (the Navigate call site only). **S1 merges first; S3
  rebases.**
- `app.config.ts` is edited by S6 (location permission) and S7 (`googleServicesFile`). **S7 merges first; S6 rebases.**

**Rules for every segment chat:**

- Branch from `origin/main` as `claude/driver-<segment>`, in its own worktree.
- Migrations take the next free number **at merge**.
- Progress goes into `docs/plans/drivers-app/enterprise-progress/<YYYY-MM-DD-HHMM>-<segment>.md`, one file per entry (never
  edit this plan's tables for progress).
- Run the driver gates before every push: `lint`, `lint:tokens`, `lint:design`, `test`.

### S0: Facts first (half a day, one chat, no code)

**Collects:** the measurable facts every later segment needs. Each is recorded in `enterprise-progress/`.

- **S0.1** Connect the tablet and record its screen:

  ```
  adb shell wm density; adb shell wm size; adb shell getprop ro.build.version.sdk
  ```

  The dp width is pixels × 160 ÷ density. At density 213 the 800 px width is about 601 dp, just over the 600 threshold. At
  240 it is about 533 dp. **S4's layout depends on this number.**
- **S0.2** List the navigation and ELD apps on the tablet:

  ```
  adb shell pm list packages | grep -iE 'samsara|copilot|trimble|truckerpath|garmin|sygic|google.android.apps.maps'
  ```

  Then ask X2 for the fleet's tablets.
- **S0.3** Ask Samsara's API or admin whether the org licenses Commercial Navigation (X3). The answer selects S3's default.
- **S0.4** Collect the owner's defect list from the 2026-11-25 test, with screenshots (X1). It is the input to S5.
- **S0.5** Record how the tablets sit in the cab, portrait or landscape mount, with a photo (X4).

**Done when:** each item is answered or marked as waiting, with a date.

### S1: Data correctness (the McLeod load path)

**Owns:**

- `supabase/migrations/*` (the next free numbers);
- `apps/api/src/modules/loads/**`;
- `packages/shared/src/mcleodLoadProjection.ts`;
- `apps/driver/src/features/loads/useLoads.ts`;
- `apps/driver/src/data/**` (outbox, policy, handlers);
- the stop-action half of `app/loads/[id]/stop/[stopId].tsx`.

**The rule:** this is API Kit **Track N**, which needs no API Kit (register; `api-kit-round3/2-sequence.md:61-108`). It is
built **in that order**, and the migration order D-MK18 is not re-decided.

- **S1.0** Write the driver track of `MCLEOD-API-KIT-PLAN-V2.md`, which is chat 2 of `HANDOFF-2026-11-20-V2-WRITING.md:59-73`.
  - It contains no `/ws` host, IP or account name; the repo is public.
  - Precondition for S1.1 and later: the v2 driver track is merged, so the build cites one plan.
- **S1.1** A dispatched McLeod load reaches its driver.
  - The driver-visible status set gains the projection's dispatched state. Both seats of a team see the load (O-3).
  - Accept and Decline are hidden for loads McLeod dispatched; they never were `offered`.
  - Test: a PGlite matrix row with a McLeod `approved` load and a dispatch, seen by the driver and the co-driver, and not
    by another driver.
- **S1.2** Stable stop ids. Add `mcleod_stop_id`, widen `load_stops_seq_check` to 1..1999, and run the stop mirror as one
  RPC with a sub-block per load (D-MK15, D-MK16, S0a, S0b).
  - Removed stops are kept and labelled "Removed in McLeod" on display readers.
  - Test: `api-kit-round4/pg/tail.mjs` cases move into a matrix: two sweeps, an added stop, a swap.
- **S1.3** `driver_complete_stop` changes signature exactly once (M-A, D-MK19). It gains `p_action_id`, a sha256 for each
  photo, and `p_mcleod_write`. Stop actions are accepted on dispatched McLeod loads.
  - Evidence for a load the driver no longer holds returns `late_evidence` with a 200, never a raise (D-MK20).
- **S1.4** `action_id` on every driver load action, from the first store build (D-MK23). The outbox stops giving up on
  network errors and 5xx: backoff caps at 15 min, and after 60 min the phone shows "Not sent yet. Keep the app open where
  you have signal." A 4xx with a code goes to Needs attention (D-MK21). The API returns `{code}` in every error body.
  - Test: `policy.ts` table tests for 5xx, network, 4xx-with-code and 4xx-without-code.
- **S1.5** Show the office "Driver's phone last reached us at HH:MM" when the phone has been silent for 60 min or more
  (D-MK22).
- **S1.6** Delivered loads stay visible for 14 days (D-MK25; Q-8 on the register).
- **Remaining Track N items:** B1, B2, B4–B7, S0c and C-A1, per the sequence document.

**Done when:**

- S1.1–S1.4 are on staging.
- On the tablet, a real staging McLeod load (D-MK12 test company, or a staging copy) shows, and its stop completes with
  photos.
- Both of these are written up in enterprise-progress.

### S2: The Android scanner (our camera, step L4)

**Owns:**

- `apps/driver/modules/capture-native/android/**`;
- `apps/driver/src/capture/**`;
- `app/scan.tsx`, `app/live-edge.tsx`;
- `packages/capture-engine/src/edges/**`;
- `LIVE-EDGE-DETECTION-PLAN.md` §8.

- **S2.1** Bring the `../FG-driver-device` work onto a fresh `claude/driver-scanner-android` branch from origin/main.
  - Remove the `LEAK-EXPERIMENT` stub. Keep `app/seed.tsx` out of the commit.
  - Make the plan doc's LiteRT version match `build.gradle` (the plan says 2.2.0; the build has 1.4.2).
- **S2.2** Fix or correct the failing `LiveEdgeGeometryTest` case. The test states what D-LED6 decided, so the code changes,
  unless the plan's §3.2 says otherwise.
- **S2.3** Memory. Measured: the native heap holds at about 650–690 MB, swap grows while the screen is open, and with JS
  detection events stubbed the memory stayed flat.
  - Find which JS path re-renders on every detection event. `setDetection` drives the headline and stats.
  - Throttle it, or move the headline to native.
  - **Pass bar:** on the Tab A9, 20 consecutive scans and 10 minutes on the scan screen, with no LMK kill (`adb logcat -b
    events | grep am_kill`) and no PSS growth over 5 % between minute 2 and minute 10.
  - The bar is measurable on the device; the device is the ceiling.
- **S2.4** The model's licence (Q-LED2). Read DocAligner's repository licence and its weights' licence.
  - If the weights are commercially usable, ship them.
  - If not, ML Kit stays the Android default, and our camera stays behind the dev route until weights we can ship exist.
    L1's scorer decides which.
  - This is a document read, not an opinion. Record the licence text's URL.
- **S2.5** ML Kit stays the fallback when our camera reports unsupported. ML Kit needs Google Play services and at least
  1.7 GB of RAM (§10 [S1]); `PageSource.needsOsScanner` routes the rest.
- **S2.6** Bump the runtime to 1.6.0; native changes need a new build. Run the `native-android` CI job. Check every new
  input is on its `NATIVE_INPUTS` list.

**Done when:**

- S2.3's bar is met, and the reading is recorded.
- 10 real BOLs scanned on the tablet are accepted or refused with a plain-language reason (`RELEASE-GATE.md:83`).
- `capture_metrics` rows land on staging.

### S3: Navigate hands off to a truck GPS app

**Owns:**

- `apps/driver/src/features/loads/itineraryModel.ts` (`mapsUrl` only);
- a new `apps/driver/src/features/navigate/**`;
- the Navigate call site in `stop/[stopId].tsx`, after S1;
- a new `app/navigation-settings.tsx`.

- **S3.1** `navigateTargets(stop, installed, orgDefault)` is a pure, tested model. It returns the ordered apps a stop can open
  in, from §10's documented link formats.

  | App | Documented link | Truck profile |
  |---|---|---|
  | Samsara Commercial Navigation | Opens through the Samsara Driver app when X3 says it is licensed; S3's first step reads the integration route from Samsara's docs (§10 [N6]) | yes |
  | CoPilot Truck | `copilot://mydestination?type=LOCATION&action=GOTO&lat=&long=` (Android 12+: `https://copilotgps.com/copilotgps?` form) | yes; the `VehicleProfile` URL is sent first |
  | Trucker Path | `geo:` fallback, as Trucker Path's own help recommends for Android 12+ | yes, the app's own profile |
  | Garmin dēzl | `geo:lat,lng` (forum-reported; no vendor doc) | yes, the device's profile |
  | Google Maps | `google.navigation:q=` | **no**: the button reads "Car route — check truck restrictions" |
  | Apple Maps (iOS) | unified Maps URL (iOS 18.4+); `daddr` only on older versions | **no**: same label |

- **S3.2** Installed apps are detected with `Linking.canOpenURL`. On Android 11+ this needs `<queries>` entries in the
  manifest for each scheme. Google warns that an unhandled intent crashes, so a target is offered only when it resolves
  (§10 [N1]).
- **S3.3** The org default is an office setting, read from the API. The driver's own choice is remembered on the device.
  D-DA3: the office default wins until the driver picks; the driver's pick is theirs.
- **S3.4** The Stop screen keeps one Navigate button, which opens the first target. Long-pressing it, or "Open in…" in the
  stop's more sheet, opens `ChoiceSheet` with the rest. No new primary action (DESIGN.md:227-228).

**Done when:**

- On the tablet, Navigate opens the fleet's truck GPS app with the stop's coordinates, verified for every app X2 lists.
- Google Maps shows the car-route label.

### S4: The tablet layout

**Owns:** `apps/driver/src/components/Screen.tsx`, a new `src/lib/windowClass.ts`, and the DESIGN.md tablet section.

- **S4.1** `windowClass(width, height)` returns compact, medium or expanded (D-DA11). `Screen` uses it instead of the
  `width >= 600` test.
- **S4.2** Medium and expanded widths use Material's canonical **list–detail** layout for Loads (list | load) and Messages
  (conversations | thread). Every other screen keeps the centred column (§10 [U3]).
  - Whether S0.1's tablet reads as medium or compact decides whether the owner's tablet sees it at all. That is S0.1's number.
- **S4.3** Orientation.
  - If X4 says the tablets are mounted in landscape, or the tablets run Android 16 or later (which ignores the lock), the
    app supports landscape on medium and expanded widths.
  - If they are portrait-mounted and run Android 15, the lock stays.
  - Both outcomes are built as rules in `windowClass`, not by device.
- **S4.4** DESIGN.md gains a "Wide windows" row in its pattern table (DESIGN.md:242-254), with light and dark screenshots at
  both text sizes (DESIGN.md:270). The owner sees them before merge.

**Done when:** the S4.4 screenshots are on the tablet, in the orientation X4 records.

### S5: The defect sweep, then the device gate

**Owns:** the screens named in X1, plus `tokens.ts`, `IconButton.tsx`, `EmptyState.tsx` and `FIELD-REPORTS.md`.

- **S5.1** Fix every X1 item, one PR per screen, each with a model test where the bug was logic.
- **S5.2** F12: rows 56 (`tokens.ts:30,42`); IconButton 48 (D-DV10); EmptyState's action becomes `secondary` at 48 pt, so
  the screen keeps one amber.
- **S5.3** FR3: reproduce it on the tablet with a build after #2667. If it no longer reproduces, close FR3 as F5 with the
  evidence; if it does, open its own investigation. FR2 is retested after the HazmatGuard grant.
- **S5.4** The device gate. Each item is run on the tablet against staging and recorded:
  - `RELEASE-GATE.md` gates B–D (`:176-178`);
  - the Stop footer;
  - late photos end to end, with a real staging driver login, since the dev bypass has no token;
  - the map in both themes (#2650's look is the owner's, D-DV28);
  - Q-DV8(b) NextStep reachability.

**Done when:** every X1 item is closed or recorded with a reason, and gates B–D pass.

### S6: The app locks while the truck moves

**Owns:** a new `apps/driver/src/features/driving/**`, the lock overlay in `app/_layout.tsx`, and the location lines of
`app.config.ts`, after S7.

- **S6.1** The speed source is the device's own GPS, foreground only ("while in use").
  - It keeps working with no signal, unlike a server read of Samsara's speed, and offline is the normal case for a phone in
    a truck (§10 [U4]).
  - `ACCESS_FINE_LOCATION` moves out of `blockedPermissions`, and the Data Safety form declares it for that purpose only.
  - Never background location; nothing is stored or sent.
- **S6.2** `drivingLockModel(samples)` is pure and tested. It locks at ≥ 5 mph and unlocks after 3 s at 0 mph (D-DA5); the
  numbers are tunables. With no fix, it keeps the last state.
- **S6.3** The locked screen shows only the current stop's name and time, and a call button for dispatch.
  - A single touch to start a call is allowed (49 CFR 390.5, "texting" excludes it).
  - No reading of messages; reading is "texting" (§10 [R3]).
  - Nothing on it needs more than one glance. NHTSA's limit is 2 s per glance and 12 s per task (§10 [U1]).
- **S6.4** The co-driver.
  - An "I'm not driving" unlock exists only when the load has a co-driver seat (O-3).
  - The driver sees it and the office is told, because J.B. Hunt's Carrier 360 made this admin-controlled (§10 [L5]).
  - No team-driver plan exists in `docs/plans`; the seat rule is API Kit O-3. A solo driver never sees it.
- **S6.5** Location permission refused: the app works, and shows one Banner: "Location is off, so the app cannot lock
  while you drive. Turn it on in Settings." Never block the app; the regulation binds the driver and the carrier, not the
  phone.

**Done when:**

- A drive test with the tablet, at walking speed in a vehicle, locks and unlocks at the tunables.
- The merged manifest check in CI's `native-android` job is updated to the new permission set.

### S7: The release lane, so a build reaches a driver

**Owns:** `.github/workflows/driver-store.yml`, `apps/driver/eas.json`, `app.config.ts` (`googleServicesFile`), the
CLAUDE.md lane paragraph, and `RELEASE-GATE.md`.

**Owner actions.** These are one complete list for the owner; nothing in it is assumed done:

- **S7.1** Add `EXPO_TOKEN` as a repository secret. The EAS project already exists (`app.config.ts:459`; CLI logged in,
  verified 2026-11-25).
- **S7.2** Create a Firebase project for `com.silvicom.fuelguard.driver`, download `google-services.json`, and add it as an
  EAS file secret. It is never committed; the repo is public. This ends F9.
- **S7.3** Google Play Console: the internal testing track, the Data Safety form (with S6's location purpose), and the
  review credentials (`RELEASE-GATE.md:135-136`).
- **S7.4** Apple: converting the Individual account to an Organization (register Q-5).
  - Until it is done, Android ships first and iOS goes through external TestFlight. That is the register's own fallback
    (§6, row "Store release").

**Claude actions:**

- **S7.5** Add `is-ancestor` on every trigger to `driver-store.yml` (D-MK26).
- **S7.6** Measure 16 KB page size on the built bundle (`RELEASE-GATE.md:127`).
- **S7.7** Correct CLAUDE.md's `require-ci-green` lane list.
- **S7.8** Cut `driver-v0.1.0` from `production` and install it from the Play internal track on the tablet.

**Done when:** the tablet runs a Play-installed build, receives a push, and its outbox sends.

### S8: New features (after D-DA2)

Each one is its own chat, its own pure `*Model.ts`, and one named DESIGN.md pattern, with screenshots to the owner before
merge.

- **S8a, defect report** (D-DA6).
  - A driver opens it from More, or from the truck on Today. They pick truck or trailer from the current shift's rig (a
    pick list today is every unit in the org, `apps/api/src/modules/driver-app/dutySessions.ts:94-104`, and Track N B6 narrows it), then a defect category,
    up to 4 photos through the S2 scanner pipeline, and a sentence.
  - It lands as an intake in the `ROADSIDE-REPAIR-FLOW-PLAN.md` flow. Read that plan first.
- **S8b, training** (D-DA7, `docs/plans/training/SEGMENT-QUIZ-2026-11-25.md`).
  - The courses assigned to the driver, played from the training module's existing assignment links (D-TR13 segment quiz).
  - Never a second player or a second progress table.
- **S8c, HOS card** (D-DA8).
  - Drive, shift and cycle remaining, from Samsara's HOS clocks for the driver's Samsara id, through the API (never from
    the phone), with "as of HH:MM".
  - The S8c design step confirms the endpoint and its rate limit in Samsara's API reference before building, and records the
    URL.
- **S8d, fuel stops on the load.**
  - The planner's stops for the driver's truck appear on Load detail, each with its own Navigate (S3).
  - They are read from the fuel planner (D-DA3), never computed on the phone.
  - Precondition: `docs/plans/fuel/FUEL-PLANNING-PRECISION-PLAN.md` says the planner's stops are fit to show a driver.

### S9: The driver half of McLeod writes (API Kit)

**Owns:** nothing new in the app beyond S1. The API Kit's own segments own the pipeline.

- The driver app needs only these, all already in S1: `action_id`, the outbox's never-give-up rule, `late_evidence`
  handling, and "Not sent yet".
- **The pipeline itself:** Track T (T-1 MK0 tables through T-12 canary to `live` for `stop_clear`), then Track D (MK4
  images). ETA (D-12) comes last, behind C-18.
- **Order and gates are the register's:**
  - write switches are opened only from the platform console (D-MK12);
  - canary stop types go pickups → non-EDI deliveries → EDI (C-19, D-MK33);
  - no write until Alex Lockwood's written OK (register §6).
- **For the driver, a live `stop_clear` means one thing:** Complete on the phone clears the stop in McLeod with both dates,
  and `isReportable=false` (O-4).
  - The app shows no McLeod state. The office sees the write's outcome.

---

## 5. Out of scope, with the reason

- **Pay, settlements, detention and lumper requests:** D-DA1.
- **In-app turn-by-turn navigation and the `@nav/compliance` engine:** D-DA4.
- **A driver ETA:** D-DA10.
- **Duty-status editing:** D-DA8.
- **Accept and Decline on McLeod loads:** McLeod dispatches; the load is never `offered`.

## 6. Risks, measured where possible

- **One store build carries S1's `action_id` requirement.** D-MK23 is safe only because no build is installed. Run R3-21's
  install count before the API refuses an action without one.
- **The Tab A9's memory, about 3.7 GB.** It sits near ML Kit's 1.7 GB floor with Samsara's app also resident. S2.3's bar
  is measured with Samsara's driver app running, if X2 lists it.
- **Android 16's ignored orientation lock** (`Screen.tsx:81-83`). S4.3 covers it in both outcomes.
- **A public repo.** No `/ws` host, IP, account, token or Firebase file is ever committed. The API Kit's `lint:mcleod-secrets`
  (D-MK14) is not built yet.
  - `MCLEOD-API-KIT-PLAN.md:33,35` on main already name an internal VM IP and imaging host. S1.0 removes them in the v2
    rewrite.

## 7. How this plan is checked

Each segment is "done" only by its **Done when** line, recorded in `enterprise-progress/` with a date, a device, and the
evidence (screenshot path, PR, measurement). A segment that cannot meet its line records the blocker as a new Q-DA, with
its candidate answers, and stops. It never ships around it (CLAUDE.md "No workarounds").

## 8. Outside facts (answered by a person or a measurement, never guessed)

| # | Fact | Who | Blocks | Build for each outcome |
|---|---|---|---|---|
| X1 | The owner's list of UI bugs from 2026-11-25, with screenshots | Owner | S5.1 | No list: S5 runs S5.2–S5.4 only, and the device gate becomes the list |
| X2 | Which navigation and ELD apps are on the fleet's tablets, and the tablet models | Owner or fleet IT; S0.2 on one tablet | S3 order, S2 memory bar | Each app → its row in S3.1; none → Google Maps with the car-route label |
| X3 | Is Samsara Commercial Navigation licensed for the org? | Samsara admin or account manager | S3 default | Yes: Samsara first. No: the truck app from X2 first |
| X4 | How the tablets are mounted (portrait or landscape) | Owner, with a photo | S4.3 | Both outcomes in S4.3 |
| X5 | The DocAligner weights' licence | Document read, S2.4 | S2 shipping | Both outcomes in S2.4 |
| X6 | Does billing need drivers to photograph lumper receipts or revised RCs? | Billing office | Document types | Yes: a document type in the existing scanner. No: nothing |
| X7 | Is the defect report a full DVIR (49 CFR 396.11), or only a repair request, given that Samsara already does DVIR? | Safety manager | S8a scope | DVIR in Samsara: S8a is the repair request only. Not in Samsara: S8a follows 396.11's fields |
| X8 | Samsara HOS clocks endpoint and rate limit for the org's plan | Samsara API reference; S8c design step | S8c | Unavailable on the plan: S8c is dropped and recorded |
| API Kit §6 | The ten register answers (`/ws` on 22.1, test company, Lockwood's OK, `clearStop` effects…) | McLeod, both Alexes, owner | S9 | The register's own column |

## 9. Open questions

None that taste could answer. The facts are X1–X8 above. A new question found during a segment is added here as Q-DA1
onwards, with candidate answers and the evidence that decides it.

## 10. Sources

**[F] Feature sets**

- J.B. Hunt DRIVE: https://drivers.jbhunt.com/benefits/drive-app
- Schneider Compass: https://play.google.com/store/apps/details?id=com.schneider.compass
- Werner: https://werner.com/drive-werner-pro/
- Knight-Swift (Eleos): https://eleostech.com/client-success/knight-swift-transportation-custom-driver-app-improves-driver-satisfaction
- Prime: https://www.primeinc.com/prime-inc-professional-driver-phone-app/
- CRST: https://play.google.com/store/apps/details?id=com.crst.driverfirst
- Heartland: https://apps.apple.com/us/app/heartland-express-driver-app/id1290235524
- Samsara Driver: https://kb.samsara.com/hc/en-us/articles/360059559832
- Motive: https://helpcenter.gomotive.com/hc/en-us/articles/30914499707549-Driver-Workflow
- McLeod: https://www.ttnews.com/articles/mcleod-launches-new-mobile-app-connecting-drivers-fleets-tms
- Trimble: https://transportation.trimble.com/en/solutions/mapping-and-routing/trimble-smartworkflow
- Descartes: https://www.descartes.com/content/documents/descartes_mobile_and_route_planner.pdf

**[R] Regulations**

- [R1] 49 CFR 392.80: https://www.law.cornell.edu/cfr/text/49/392.80
- [R2] 49 CFR 392.82: https://www.law.cornell.edu/cfr/text/49/392.82
- [R3] 49 CFR 390.5: https://www.law.cornell.edu/cfr/text/49/390.5
- FMCSA fact sheet: https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet
- 49 CFR 395.22: https://www.law.cornell.edu/cfr/text/49/395.22

**[L] How apps lock while moving**

- [L1] Motive: https://helpcenter.gomotive.com/hc/en-us/articles/6475129978909-Getting-Started-with-Motive-for-Drivers
- [L2] Samsara: https://kb.samsara.com/hc/en-us/articles/4402783578893
- [L3] J.B. Hunt: https://drivers.jbhunt.com/blog/why-drive-with-j-b-hunt/drive-easy-with-the-j-b-hunt-drive-app
- [L4] Schneider: as [F]
- [L5] J.B. Hunt Carrier 360 "I'm Not Driving" mode (third-party report): https://www.marketscreener.com/JB-HUNT-TRANSPORT-SERVICE-9769/news/JB-Hunt-Transport-Services-Carrier-360-Introduces-I-m-Not-Driving-Mode-28700021/

**[N] Navigation**

- [N1] Google Maps intents: https://developer.android.com/guide/components/google-maps-intents
- Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
- Apple Maps: https://developer.apple.com/forums/thread/784030
- CoPilot URL launch: https://developer.trimblemaps.com/copilot-navigation/feature-guide/advanced-features/url-launch/
- Trucker Path: https://helpcenter.truckerpath.com/hc/en-us/articles/38761026838541
- [N6] Samsara Commercial Navigation: https://www.samsara.com/products/telematics/commercial-navigation and
  https://kb.samsara.com/hc/en-us/articles/12692760022285

**[U] Usability**

- [U1] NHTSA guidelines (2 s glance, 12 s per task): https://www.federalregister.gov/documents/2013/04/26/2013-09883/visual-manual-nhtsa-driver-distraction-guidelines-for-in-vehicle-electronic-devices
- [U2] Android window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- [U3] Material 3 layout: https://m3.material.io/foundations/designing/structure
- [U4] Android offline-first: https://developer.android.com/topic/architecture/data-layer/offline-first

**[S] Scanning**

- [S1] ML Kit Document Scanner: https://developers.google.com/ml-kit/vision/doc-scanner/android
- Transflo Mobile+: https://knowledge.transflo.com/mobile-menu/Content/08mobi-admin/mobile-menu-02-features/mobile-app-features.htm

## 11. Progress log

One file per entry in `docs/plans/drivers-app/enterprise-progress/` (parallel chats never edit the same file).

- **2026-11-26:** Plan written from four read-only audits (the driver code, the API Kit register, the design rules, and
  outside research). Nothing built.
