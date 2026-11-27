# Driver app: the enterprise plan (2026-11-26, revision 2)

**Status:** revision 2, 2026-11-26. It replaces revision 1 (PR #2674, merged the same day).

- Decisions are numbered D-DA1 onwards, owner questions Q-DA1 onwards, and outside facts X1 onwards.
- Revision 2 comes from a second audit layer, four read-only audits run 2026-11-26:
  1. every earlier driver-app decision document;
  2. every owner statement in the chat history since 2026-08-14;
  3. the collectors (McLeod agent, Samsara tiers, EFS, the fuel planner);
  4. the test and device harness.
- **§0 lists what revision 2 changed, and why.**

**What this plan is.** One plan that takes the driver app from "works in a development build on one tablet" to "every
company driver uses it every day, and McLeod is written from it". It is cut into **segments** that separate chats can run at
the same time. Each segment lists the files it owns.

**Where each answer comes from.** In order of authority:

1. **An owner ruling**, quoted with its date and the document that records it (§2 is the full trail).
2. **A code read** on `origin/main`, cited as `path:line`.
3. **A measurement**, with its date.
4. **A published primary source**: a regulation, platform documentation, or vendor documentation (§11).

A question none of these can answer is listed as an **outside fact** (§9), with the person who answers it and a build for
each possible answer. A question only the owner can answer, a business choice rather than a fact, is a **Q-DA** (§10), with
a recommendation and its evidence.

**What outranks this file:**

- Owner rulings (§2).
- `apps/driver/DESIGN.md` and `DRIVER-APP-VISUAL-2026-PLAN.md` for the look. This plan adds one visual rule (wide windows,
  S4), and that rule lands in DESIGN.md itself.
- `docs/plans/mcleod/DECISION-REGISTER-2026-11-20-API-KIT.md` (branch `claude/mcleod-api-kit-build-plan`) for every McLeod
  write. Its D-MK ids are cited here, never re-decided.
- `redesign-2026/IN-APP-NAVIGATION-ANALYSIS.md` for navigation's options and its Q-NV questions.

---

## 0. What revision 2 changed, and why

| # | Revision 1 said | Revision 2 says | Evidence |
|---|---|---|---|
| R1 | Navigation is only a hand-off to a truck GPS app; in-app routing is out of scope | **In-app navigation is in the first build** (owner 2026-11-23). It is built as the analysis's Option A: our HERE truck route drawn in the app, then "Start" hands off. Option B (in-app guidance) is designed behind it | `DRIVER-APP-FEATURE-LIST-FOR-RULING.md` "Owner ruling 2026-11-23"; `IN-APP-NAVIGATION-ANALYSIS.md` §3 |
| R2 | Through the Play internal track to drivers | **Builds stay local until the app is 100 % finished** (owner 2026-11-25 18:55). The store lane is prepared; nothing is published until the owner says so | Chat, 2026-11-25 (recorded here for the first time) |
| R3 | A full lock while moving; with permission refused the app works and shows a banner | **The next-stop view stays while moving; typing, capture and message composition lock** (DF-20 default, Q-NV7). **Refused permission means locked, with an "I've parked" attestation** (D58, O17) | `FEATURE-LIST:DF-20`; `DRIVER-APP-PLAN.md:483,2240`; `IN-APP-NAVIGATION-ANALYSIS.md` Q-NV7 |
| R4 | HOS: confirm a Samsara endpoint, then build | **HOS is already collected** every 5 min into `driver_hos_clocks` (0450). The app reads that table; there is no new poller | `samsara/hosClocksFeed.ts:56`; `hosClocksReads.ts` |
| R5 | Stable stop ids need new collection | **McLeod's stable `stop_id` is already collected** in `mcleod_dispatch_stops` (0364). The projection drops it (`mirrorLoads.ts:109-126`), so the fix is in the projection | Collector audit |
| R6 | Accept and Decline are hidden on McLeod loads | They are hidden, **and DF-2 "Got it" replaces them; the office sees "seen by driver"** | `FEATURE-LIST:DF-2` |
| R7 | No driver ETA at all | **DF-10 "Running late": the driver sends a new ETA and a reason.** This is a driver statement, not a computed ETA. It is saved in 360 now and sent to McLeod as a call-in at MK6. The app still computes no ETA (D-DV13) | `FEATURE-LIST:DF-10`; register O-8 |
| R8 | Training plays inside the app | **Training stays the texted web portal** (D-TR2). The app gets only a "Training" row that opens the same portal link, and only after the owner reopens DF-23 (default *Not now*) | `training/SAFETY-VIDEOS…:254-256`; `FEATURE-LIST:DF-23` |
| R9 | Fuel stops on the load (S8d) | **Removed from this plan.** No per-load planned-stop table exists (`fuel_plans`, 0074, is office history), FP8 is open, and D52 removed the deliverable | Collector audit; `DRIVER-APP-PLAN.md:466,477` |
| R10 | A defect report, with Samsara DVIR assumed | **DF-11 "Report a problem"**: breakdown (to roadside repair), damage or shortage, refused load. Lumper and detention are out (D-DA1). DVIR: FleetPal has no DVIR endpoint, and Samsara DVIRs are not collected on a schedule. That makes it outside fact X7, never a second DVIR channel | `FLEETPAL-INTEGRATION-PLAN.md:370-372`; `inspections/attribution/attribute.ts:110` |
| R11 | Forgotten | **Added:** DF-8 one-tap call (dispatch, safety, payroll); DF-9 McLeod's truck listed first at check-in; DF-12 HOS on Today and the lock screen; DF-14 my documents (med card and CDL renewal); DF-16 fuel receipt photo; DF-18 home time (read side); DF-19 refer a driver; I13 truck kit check; the widget and Live Activity device gate | `FEATURE-LIST`; `maintenance/INVENTORY-PLAN.md:229,589-600`; Visual `:405-426` |
| R12 | `driver-store.yml` "has never run"; tag `driver-v0.1.0` | It **ran once, 2026-09-07, and failed**. The first tag is `driver-v1.0.0-rc.1` (App Store Connect already holds v1.0.0 build 1). A Mac `eas build` needs no workflow | `STORE-TESTING-ROUTE-2026-11-23.md:12-14`; `driver-store.yml:15` |
| R13 | Owner actions | **Added:** App Group and widget-extension registration; Play App Signing choice; Sentry DSN in EAS production; driver logins (1 of 286 in September) | `STORE-TESTING-ROUTE:16,52-54,79`; Visual `:467-469` |
| R14 | Location is blocked by the hardening plan | It is blocked by **D-PR6/D-PR7** and `RELEASE-GATE.md:125`. S6 supersedes D-PR6, D-PM4 and D-PM9 by name. The iOS purpose string, the privacy manifest and `NSMotionUsageDescription` change too | `DRIVER-APP-DIRECTION-B-PLAN.md:861-862,902` |
| R15 | `supportsTablet: false` is the tablet problem | It is **iOS-only**. Android behaviour comes from `orientation` and `Screen.tsx`. The fleet tablets are Android (D-DE1); the Tab A9 runs Android 15 | `app.config.ts:120,130` |
| R16 | Scanner rulings | The owner's 2026-11-23 rulings are **written down here for the first time** (D-DA14), because no repo doc held them | Chat 2026-11-23; `SCANNER-TOP-OF-LINE-PLAN.md:118-133` is stale |
| R17 | S1 proves on the "D-MK12 test company" | That company **does not exist**. S1 proves by posting an ingest fixture twice to staging with a token from `issueMcleodToken.ts` | Harness audit; register `:89-100` |
| R18 | Co-driver source unstated | **`loads.co_driver_id` from McLeod continuity** decides who sees a load. Samsara's `vehicles.co_driver_id` is not used for loads | D-DA3; `mirrorLoads.ts:31,65` |

---

## 1. Where the app is today (measured 2026-11-25/26 on origin/main)

### 1.1 What works

- **Sign-in and the four tabs:** Home, Loads, Documents, More.
- **Loads:** Load detail and Stop, with photos and late photos (0645).
- **Messages and notifications.**
- **Shift check-in and end of shift.**
- **Hazmat BOL check, safety score and leaderboard, and Settings.**
- **The Lock Screen glance and the widgets** (#2611).
- **The Stop screen's Navigate button,** which opens the phone's maps app (`app/loads/[id]/stop/[stopId].tsx:201-208` calls
  `itineraryModel.ts:220-229`; tested at `tests/itinerary-model.test.ts:197`).
- **The SQLCipher outbox,** with its key in SecureStore (`src/data/db.ts:6-32`).

### 1.2 Findings, ranked by how much they stop a driver

| # | Finding | Evidence | Segment |
|---|---|---|---|
| F1 | **No build has ever reached a driver.** The only store run failed on 2026-09-07. There is no `EXPO_TOKEN`, no `driver-v*` tag, and no Firebase file. The APK and OTA lanes were deleted on 2026-10-22, and OTA is retired (D-AWS16) | `STORE-TESTING-ROUTE:12-14`; `d313fa8a1` | S7 |
| F2 | **A load dispatched in McLeod is invisible to its driver.** The projection gives `approved`, and the driver policies and API never admit `approved` | `mcleodLoadProjection.ts:190-199`; `0371:71,85,99`; `driverLoads.ts:128-129` | S1 |
| F3 | **Stop actions on a McLeod load are refused** (DL003). Accept and Decline can never work on it, because the load is never `offered` | `0141:122,304,365-399` | S1 |
| F4 | **Stop ids churn on every McLeod sync.** The raw `mcleod_dispatch_stops.stop_id` is stable, but the projection deletes pending stops and inserts them again on `(load_id, seq)` | `mirrorLoads.ts:109-126`; `tmsLoadIngestWriters.ts:134-162`; `0364` | S1 |
| F5 | **From 2026-07-28 to 2026-11-25 nothing queued on a phone was ever sent.** Fixed in #2667. FR3 falls inside that window and is still marked Open | `outbox.ts:101-121`; `FIELD-REPORTS.md:10` | S5 |
| F6 | **The outbox gives up after 8 attempts, 5xx included.** D-MK21 says never | `src/data/policy.ts:24,99-101` | S1 |
| F7 | **On Android, Navigate opens Google Maps, which routes a truck as a car.** There is no height, weight or hazmat profile (§11 [N1]). The server already has a HERE truck route that the app never shows | `itineraryModel.ts:229`; `IN-APP-NAVIGATION-ANALYSIS.md` §3 | S3 |
| F8 | **The Android scanner is Google's ML Kit,** not ours. That breaks the owner's 2026-11-25 "start with our own scanner". Our Android camera is uncommitted in `../FG-driver-device` (branch `claude/scanner-android`). On the tablet the scan screen holds about 1 GB, and swap grew about 50 MB in 4 min. One JVM test fails. A `LEAK-EXPERIMENT` stub is still in place | dumpsys meminfo, 2026-11-25; worktree | S2 |
| F9 | **Android gets no push notifications:** there is no `googleServicesFile` | device pass 2026-11-25 | S7 |
| F10 | **On Android, tablets get the phone layout.** The app is portrait-locked, and on a window 600 dp or wider it is one 560 dp column | `app.config.ts:120`; `Screen.tsx:81-89` | S4 |
| F11 | **Nothing stops typing or capture while the truck moves.** Location is blocked by D-PR6/D-PR7 | `app.config.ts:288-293`; `RELEASE-GATE.md:125` | S6 |
| F12 | **Three places where the code breaks DESIGN.md:** row height 52 where the rule says 56 (`tokens.ts:30,42`); `IconButton` 44 where the rule says 48; `EmptyState` uses a second amber button at 44 pt | `DESIGN.md:110-113`; `IconButton.tsx:57`; `EmptyState.tsx:30` | S5 |
| F13 | **Never run on a device:** the Stop footer, late photos end to end, the map in both themes (#2650), the widgets and Live Activity, and NextStep reachability (Q-DV8(b)) | visual-2026-progress | S5 |
| F14 | **The driver API exposes almost none of the collected data.** Stops leave out `actual_arrival_at`, `actual_departure_at` and the dispatcher. There is no HOS, no home time, and no route | `driverLoads.ts:74-76`; `me.ts:66-431` | S1, S8 |
| F15 | **Whether drivers can sign in at all is unmeasured:** in September 1 of 286 drivers had an app login, and `tab.loads` was OFF for our org (D-PM1) | `STORE-TESTING-ROUTE:79`; `DRIVER-APP-DECISIONS-2026-08-07.md:21-34` | S0 |

**What F2–F4 mean:** today the app works only for loads Silvicom itself sends as `offered`. Every company driver runs McLeod
loads, so **S1 comes before any new feature.**

---

## 2. Owner rulings this plan builds on (the full trail)

| Date | Ruling | Where it is recorded | In this plan |
|---|---|---|---|
| 2026-09-17 | Loads come from McLeod; Silvicom 360 does not create loads | LOADS-MIRROR-PLAN | D-DA3 |
| 2026-10-22 | The driver app ships through Google Play and Apple, never self-hosted; OTA is retired | AWS-MIGRATION D-AWS16 | S7 |
| 2026-10-27 | Tablets follow the driver; the fleet's tablets are Android | `DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md` D-DE1 | S4, I13 |
| 2026-11-19 | Buy McLeod's full API Kit and write to McLeod; "start small" | API Kit register | S9 |
| 2026-11-20 | Visual 2026 design and colours approved; native tab bar | `DRIVER-APP-VISUAL-2026-PLAN.md` | all UI |
| 2026-11-20 | Driver password of 8 characters, as in Samsara | `DRIVER-CREDENTIALS-PLAN.md` | — |
| 2026-11-20 | Scanner: build our own live outline (Q-LED1) | `LIVE-EDGE-DETECTION-PLAN.md` | S2 |
| 2026-11-23 | "Simple and easy to use." No pay or finance. **First build: loads pages, stop form, scanner, images, in-app navigation.** Every other row keeps its recommended default | `FEATURE-LIST`, "Owner ruling 2026-11-23" | §3, D-DA4 |
| 2026-11-23 | **One scanner for every document.** Shoot only when the page is placed well and the phone is still; the trace's end takes the photo (D-LED6). The S2–S6 extras of `SCANNER-TOP-OF-LINE-PLAN` are not approved | Chat; LIVE-EDGE plan D-LED6; written here as D-DA14 | S2 |
| 2026-11-23 | Notification settings split from Messages | Q-DF-7, #2618 | — |
| 2026-11-24 | Training: texted link to a web portal, no app (D-TR2) | `training/SAFETY-VIDEOS…:254-256` | R8 |
| 2026-11-25 16:27 | The Samsung tablet is appropriate; follow Google and Apple guidance | Chat | S4, D-DA11 |
| 2026-11-25 | "Start with our own scanner" on Android | Chat | S2 |
| **2026-11-25 18:55** | **"We will add this later in stores; for now keep it locally until it is 100 % finished and ready for production"** | **Written here for the first time** (D-DA12) | S7 |
| 2026-11-26 | Like J.B. Hunt's app. **~100 % company drivers, so no pay, settlements, detention or lumper requests.** Answers from research, not opinion | This plan, D-DA1 | §3 |

**Not ruled by the owner, and decided here from research.** Each is marked with the evidence that decides it:

- the speed and lock thresholds (D-DA5);
- message reading while moving (D-DA5);
- the tablet layout (D-DA11);
- the HOS display (D-DA8).

---

## 3. Feature scope: the owner's DF rows, with evidence

**How a row's status was set.** The owner ruled on 2026-11-23 that the first build is DF-1–7, DF-5/14 and DF-21. Every
other row keeps its recommended default. Pay (DF-17) and advances (DF-22) are out, and on 2026-11-26 detention and lumper
were added to the out list.

| DF | Feature | Status | Segment | Evidence or reason |
|---|---|---|---|---|
| DF-1 | See my load as soon as dispatch assigns it; the co-driver too | **First build** | S1.1 | F2 |
| DF-2 | "Got it" replaces Accept/Decline; the office sees "seen by driver" | **First build** | S1.1 | F3; the load is never `offered` |
| DF-3 | Load details: pickup number, references, customer, weight, pieces, notes, appointments | **First build** | S1.6 | Columns exist in `load_stops` and `loads`, but not in the driver projection (F14) |
| DF-4 | One big button per step: Got it → Arrived → BOL → Complete → next stop | **First build** (Stop footer D-DV27 is built) | S1.3, S5.4 | McLeod write at S9 |
| DF-5 | Photos inside the step; the scanner opens from the step | **First build** | S2 | D-DA14 |
| DF-6 | Sent or waiting shown on every action; "Not sent yet" after 60 min | **First build** | S1.4 | D-MK21 |
| DF-7 | Delivered loads for 14 days; late photos accepted | **First build** | S1.5 | D-MK25; 0645 |
| DF-8 | Messages plus one-tap call to dispatch, safety and payroll | Default yes | S8 | One tap starts a call, which 49 CFR 390.5 allows while driving |
| DF-9 | Check-in lists McLeod's assigned truck and trailer first | Default yes | S1 (Track N B6) | `dutySessions.ts:94-104` lists every unit |
| DF-10 | Running late: a new ETA and a reason | Default yes | S8 (saved), S9 (call-in) | R7 |
| DF-11 | Report a problem: breakdown, damage or shortage, refused load (**not** detention or lumper) | Default yes, narrowed by D-DA1 | S8 | R10 |
| DF-12 | HOS left, on Today and the lock screen | Default yes | S8 | `driver_hos_clocks` (R4) |
| DF-13 | Score with idle time | Default yes | S8 | Idle data is in `idle_*` (6 h tier) |
| DF-14 | My documents, plus med card and CDL renewal photo to Safety | **First build** (with DF-5) | S8 | Scanner (S2); McLeod write at MK5 |
| DF-15 | Hazmat placard calculator, only on hazmat loads | Exists | — | FR2: the HazmatGuard grant |
| DF-16 | Fuel receipt photo; the upload wins over the card feed (D-IP7) | Default yes | S8 | A document type in the one scanner. It is a photo, not D41's banned manual entry |
| DF-18 | Home time: see the next and last home date (read side first) | Default yes, read first | S8 | RLS 0136 already lets a driver read their own `driver_time_off`; the request waits on B-MK8 |
| DF-19 | Refer a driver into recruiting leads | Default yes | S8 | Q-DF-3: no bonus figure known (outside fact X9) |
| DF-20 | Lock while driving: the next-stop view only | Default (next-stop view) | S6 | D-DA5 |
| DF-21 | Navigation | **First build**, Option A | S3 | R1 |
| DF-17, DF-22 | Pay; advances | **Out** (owner 11-23) | — | — |
| DF-23–27 | Training, news, surveys, load board, maintenance schedule | **Not now** (default) | — | Training is the web portal (D-TR2) |
| — | Detention and lumper requests | **Out** (owner 11-26) | — | D-DA1 |
| I13 | Truck kit check from Home's rig card | Built in its own plan; ships with S7 | — | `INVENTORY-PLAN.md:229,589-600` |
| — | Spanish | Not in scope (the app is English-only by scope) | — | `DRIVER-APP-DESIGN-SYSTEM-2-AUDIT.md:88`; no owner ruling for the driver app |

**What Silvicom has that none of the 12 compared apps document:** the hazmat placard check, the shift check-in with the rig,
and late photos (§11 [F]).

---

## 4. Decisions

- **D-DA1, scope.** No pay, settlement, advance, detention or lumper request.
  - Lumper and revised-RC **documents** stay a document type only if billing needs them (X6).
  - Basis: the owner, 2026-11-23 and 2026-11-26.
- **D-DA2, order.** No new S8 screen merges before S1.1–S1.4 are on staging.
  - Basis: F2–F4. A feature on a load the driver cannot see is not a feature.
- **D-DA3, one source per fact.** Every fact has one source:

  | Fact | Source |
  |---|---|
  | Loads, stops, co-driver, actual times | McLeod, through `mcleod_dispatch_*` |
  | HOS | `driver_hos_clocks` |
  | Speed in the office | `vehicle_positions` |
  | Route | The server's HERE truck route, cached for the load |
  | Home time | `driver_time_off` |
  | Training | The training module |
  | Documents | The one scanner pipeline |

  - The app never computes an ETA (D-DV13).
  - Basis: CLAUDE.md "Deriving beats restating".
- **D-DA4, navigation is Option A,** "route preview plus Start", from `IN-APP-NAVIGATION-ANALYSIS.md` §3.
  - The app shows the load's HERE truck route on MapLibre: the route line, numbered stops, the next three turns from HERE's
    `instructions`, and miles and time left on the route.
  - **"Start"** hands the next stop's **coordinates** to the driver's turn-by-turn app.
  - Car apps carry the "not truck-checked" label (NAV-17).
  - Option B (Ferrostar guidance on HERE) is designed behind it and spiked only after A (Q-NV3). Options C and D are not
    started.
  - Basis: owner 2026-11-23. A takes about 2–3 weeks, against 6–10 for B (analysis table).
  - **Miles and time left on a route are an exception to D-DV13 that must be named.** D-DV13 bans "miles left" in the app's
    figures. A route preview without them is not a route preview, so the S3 design step brings this exact sentence to the
    owner as **Q-DA1** before any route figure is drawn.
- **D-DA5, while moving.**
  - **What stays:** the next-stop view, the route map and the "Start" hand-off, all read-only (DF-20 default, Q-NV7).
  - **What locks:** text entry, photo capture, the hazmat step, the odometer field and message composition (D58's list).
  - **Message reading also locks.** 49 CFR 390.5 defines texting as "reading text from" a device, and 392.80 bars a carrier
    from allowing it. This replaces D58's "reading a message is not gated", by name.
  - **What does not lock:** a call, and "Got it".
    - A call is exempt because 390.5's texting definition excludes "pressing a single button to initiate or terminate a
      voice communication".
    - "Got it" is exempt because it is one tap that neither enters nor shows text, so it is not "texting" as 390.5 defines it.
      It is still subject to NHTSA's glance budget (§11 [U1]).
  - **Thresholds:** lock above 5 mph and unlock after 3 s at 0 mph. Motive, Samsara and J.B. Hunt all use 5 mph, and Motive
    unlocks after 3 s (§11 [L1–L3]). D58 used 2.2 m/s with 3–5 s hysteresis, which is the same number. These are tunables.
  - **Permission refused or no fix:** locked, with an "I've parked" attestation tap that is never a dead end (D58, O17).
  - **Built as one shared, tested motion service** (NAV-16). Training's "watch only while parked" will also read it.
- **D-DA6, report a problem** (DF-11): breakdown, damage or shortage, refused load.
  - Breakdown lands in the roadside-repair flow (`safety-dqf/ROADSIDE-REPAIR-FLOW-PLAN.md`), never a second ticket system.
  - DVIR is X7.
- **D-DA7, training.** The training module and its texted portal stay the channel (D-TR2). No app work unless the owner
  reopens DF-23.
- **D-DA8, HOS is shown, never edited.** It is read from `driver_hos_clocks` with its `fetched_at` age.
  - The ELD of record stays Samsara (49 CFR 395.8, 395.22).
- **D-DA9, not now:** referral bonus figures (X9), company news, surveys, a load board.
- **D-DA10, ETA.** The app computes none (D-DV13).
  - DF-10 is a driver statement: a new time and a reason, saved in 360, and sent at MK6 as a McLeod call-in (O-8, C-18).
- **D-DA11, the tablet layout uses Android's window size classes,** never an `isTablet` test (§11 [U2]): compact under
  600 dp, medium 600–840 dp, expanded 840 dp and up.
- **D-DA12, distribution.** Builds stay **local** until the owner rules the app 100 % finished (owner 2026-11-25 18:55).
  - "Local" means release builds made on the Mac and installed by `adb` onto the fleet's tablets.
  - The store lane (S7) is prepared but publishes nothing.
  - Whether Play's *internal* track (up to 100 named testers, no review) counts as local is **Q-DA2**.
  - Every driver-visible change is seen on the Tab A9 before it is called done, and the owner sees screenshots before merge
    (DESIGN.md:358).
- **D-DA13, the defaults behind the nav and settings choices are catalog features.** The org's default navigation app and the
  motion-lock tunables live in `driver_app_features`, which is how D-PM5 and D-PM8 define per-org app settings. They are
  never an ad-hoc setting.
- **D-DA14, the scanner** (owner 2026-11-23, written down here):
  - one scanner for every document;
  - the photo is taken only when the page is placed well and the phone is still, and the end of the trace takes it (D-LED6);
  - the `SCANNER-TOP-OF-LINE-PLAN` S2–S6 extras (burst, torch, page tray and so on) are not approved and are not started.

---

## 5. Segments: who runs what, and in parallel

```
        ┌─ S1 Data correctness (Track N) ──────────────┐
S0 ─────┼─ S2 Android scanner ─┐                        ├─► S8 Default-yes features ─► S9 McLeod writes
(facts) ├─ S3 In-app navigation (A) ┼─► S5 Defects + device gate ┘
        ├─ S4 Tablet layout ───┘
        ├─ S6 Motion service
        └─ S7 Release lane (prepared, local only)
```

**Rules for every segment:**

- Branch from `origin/main` as `claude/driver-<segment>`, in its own worktree.
- Migrations take the next free number at merge.
- Progress goes in `docs/plans/drivers-app/enterprise-progress/<YYYY-MM-DD-HHMM>-<segment>.md`.
- Run `lint`, `lint:tokens`, `lint:design` and `test` for the driver app before every push.
- Native changes bump `runtime-version.json` and run CI's `native-android` job. All of `apps/driver/` is already on its
  `NATIVE_INPUTS` list (`ci.yml:670-675`).

**Where two segments share a file:**

| File | Segments | Order |
|---|---|---|
| `stop/[stopId].tsx` | S1 (actions), S3 (Navigate call site) | S1 first |
| `app.config.ts` | S7 (`googleServicesFile`), S6 (location) | S7 first |
| `app/_layout.tsx` | S6 (lock overlay), S7 (push init) | S7 first |

### S0: Facts first (half a day, one chat, no code)

- **S0.1** The tablet's screen: `adb shell wm density; adb shell wm size`. The dp width is px × 160 ÷ density. At 213 dpi,
  800 px is about 601 dp (medium); at 240 dpi it is about 533 dp (compact). S4 depends on this number.
- **S0.2** `adb shell pm list packages | grep -iE 'samsara|copilot|trimble|truckerpath|garmin|sygic|waze|google.android.apps.maps'`
  on the tablet. This is fact X2 (= Q-NV4).
- **S0.3** Production, read-only:
  - how many active drivers have an app login (F15);
  - whether `tab.loads` is still OFF for our org (D-PM1);
  - whether `driver_time_off` is still being fed (the collector audit could not tell whether `--service` still runs the
    `driver-time` post).
  - Each is a count, recorded with its query.
- **S0.4** Ask for X1 (the owner's bug list from 2026-11-25), X3 (Samsara Commercial Navigation = Q-NV5), X4 (how the tablet
  is mounted), and the HERE plan's licence line (Q-NV2).

**Done when:** every item is answered or marked as waiting, with a date.

### S1: Data correctness (API Kit Track N, which needs no API Kit)

**Owns:**

- `supabase/migrations/*`;
- `apps/api/src/modules/loads/**` and `apps/api/src/modules/mcleod/**` (projection and writers);
- `packages/shared/src/mcleodLoadProjection.ts`;
- `apps/driver/src/features/loads/**` (except `mapsUrl`);
- `apps/driver/src/data/**`;
- the stop-action half of `stop/[stopId].tsx`.

The order is the register's: `api-kit-round3/2-sequence.md:61-108` with D-MK18.

- **S1.0** Write the driver track of `MCLEOD-API-KIT-PLAN-V2.md` (`HANDOFF-2026-11-20-V2-WRITING.md:59-73`).
  - It contains no `/ws` host, IP or account name, because the repo is public.
  - It removes `MCLEOD-API-KIT-PLAN.md:33,35`'s internal IP and imaging host.
- **S1.1 (DF-1, DF-2)** A dispatched McLeod load reaches its driver and the co-driver (`loads.co_driver_id`, O-3, R18).
  - Accept and Decline are hidden on McLeod loads, and "Got it" writes a `load_events` acknowledgement the office sees as
    "seen by driver".
  - The OfferDeck stays only for `offered` loads Silvicom sends itself.
  - Test: a PGlite matrix row in which an `approved` McLeod load with a dispatch is seen by the driver and the co-driver, and
    not by another driver.
- **S1.2 (F4)** `load_stops.mcleod_stop_id` is **copied from `mcleod_dispatch_stops.stop_id`**.
  - The projection updates by that id instead of deleting and re-inserting.
  - `load_stops_seq_check` widens to 1..1999, and there is one RPC with a sub-block per load (D-MK15, D-MK16).
  - Stops McLeod removes are kept and labelled.
  - Test: the `api-kit-round4/pg/tail.mjs` cases (two sweeps, an added stop, a swap) become a `supabase/tests` matrix.
- **S1.3 (DF-4)** `driver_complete_stop` changes signature exactly once (M-A, D-MK19):
  - it takes `p_action_id`, a sha256 per photo, and `p_mcleod_write`;
  - stop actions are accepted on dispatched McLeod loads;
  - for a load the driver no longer holds it returns `late_evidence` (D-MK20).
  - It extends `load-lifecycle.test.mjs`.
- **S1.4 (DF-6)** `action_id` on every load action (D-MK23).
  - The outbox never dead-letters on network failures or 5xx: backoff caps at 15 min, and "Not sent yet" shows after
    60 min.
  - A 4xx that carries a code goes to Needs attention, and every error body carries `{code}` (D-MK21).
  - Tests: `src/data/policy.test.ts` table rows.
- **S1.5 (DF-7)** Delivered loads stay for 14 days (D-MK25). The office sees "phone last reached us" after 60 min (D-MK22).
- **S1.6 (DF-3, F14)** The driver projection adds the fields McLeod already sends:
  - pickup and reference numbers, customer, weight, pieces, stop notes, appointment windows;
  - `actual_arrival_at` and `actual_departure_at`, as McLeod's record of what was cleared.
  - The app shows **no McLeod ETA** (D-DA10).
- **The remaining Track N items:** B1, B2, B4–B7 (B6 = DF-9 truck first), S0c and C-A1.

**Done when:**

- S1.1–S1.4 are on staging.
- On the tablet, a McLeod-shaped load posted twice to staging through `/api/tms/dispatch-movements` shows to the driver and
  co-driver, keeps its stop ids, and completes a stop with photos.
- The token comes from `apps/api/src/scripts/issueMcleodToken.ts`, and the fixture shape comes from
  `modules/mcleod/routes/tmsIngest.*.test.ts`.

### S2: Our own Android scanner (L4)

**Owns:**

- `apps/driver/modules/capture-native/android/**` and `apps/driver/src/capture/**`;
- `app/scan.tsx` and `app/live-edge.tsx`;
- `packages/capture-engine/src/edges/**`;
- `LIVE-EDGE-DETECTION-PLAN.md` §8;
- a new `apps/driver/scripts/mem-soak.mjs`.

- **S2.1** Move the `../FG-driver-device` work onto `claude/driver-scanner-android` from origin/main.
  - That checkout is a branch with about 25 uncommitted files; it is not "detached at main".
  - Remove the `LEAK-EXPERIMENT` stub and keep `app/seed.tsx` out.
  - Make the plan doc's LiteRT version agree with `build.gradle` (the doc says 2.2.0; the build uses 1.4.2).
- **S2.2** Fix the failing `LiveEdgeGeometryTest` ("the outline appears after three valid frames and goes only after a 180 ms
  gap"), held to D-LED6.
- **S2.3** Memory. With the JS detection events stubbed out, memory held flat, so the suspect is `setDetection` re-rendering
  on every event.
  - Throttle it, or move the headline to native.
  - `mem-soak.mjs` logs `dumpsys meminfo` and `logcat -b events am_kill` over time.
  - **Pass:** on the Tab A9, with Samsara's driver app running if X2 lists it, 20 scans and 10 minutes on the screen with no
    low-memory kill, and PSS growth of 5 % or less between minute 2 and minute 10.
- **S2.4** DocAligner's weights licence (Q-LED2 = X5). Read the licence text and record its URL.
  - Usable: ship it.
  - Not usable: ML Kit stays the Android default until weights we may ship exist.
- **S2.5** Every document type opens the one scanner (D-DA14): the stop BOL and POD, Capture BOL, my documents (DF-14), and
  the fuel receipt (DF-16).
  - When our camera reports unsupported, fall back to ML Kit, which needs Play services and 1.7 GB of RAM (§11 [S1]).
- **S2.6** Runtime 1.6.0, then CI's `native-android` job.

**Done when:**

- the S2.3 pass is recorded;
- 10 real BOLs are accepted, or refused with a plain-language reason (`RELEASE-GATE.md:83`);
- `capture_metrics` rows land on staging.

### S3: In-app navigation, Option A (DF-21)

**Owns:**

- a new `apps/driver/src/features/navigate/**`;
- `app/(tabs)/navigate.tsx`, which becomes a real route reached from Today's card and the Stop screen, never a tab;
- `src/features/nav/**`, where the sample data goes;
- `itineraryModel.ts` (`mapsUrl` only);
- a new driver route endpoint in `apps/api/src/modules/driver-app/`.

- **S3.0** Answer the analysis's blockers first:
  - Q-NV1, the basemap: one answer for web and phone, as Q-DR35 says;
  - Q-NV2, the HERE licence line for showing routes in-app (outside fact);
  - Q-NV6, the truck profile per load: a load with unknown weight shows "profile incomplete" (NAV-6);
  - **Q-DA1**, miles and time left on the route versus D-DV13.
- **S3.1** `GET /api/me/loads/:id/route` returns the load's cached HERE truck route.
  - Only for the driver's own dispatched load, scoped by org and by driver, and tested with `expectOrgScoped`.
  - No new HERE call per driver: it reads the route the server already computes for the board.
  - The S3.1 design step names that cache by a code read.
- **S3.2** The Navigate screen:
  - MapLibre (`src/lib/basemap/`, D-DV28), the route line, numbered stops, the next three turns;
  - one primary **Start** in `ActionBar`;
  - offline: the last route, with its age.
- **S3.3** `navigateTargets(stop, installed, orgDefault)` is a pure model that orders the documented link forms:

  | App | Link | Truck-checked |
  |---|---|---|
  | Samsara Commercial Navigation | if X3 = licensed; the route is read from Samsara's docs first (§11 [N6]) | yes |
  | CoPilot Truck | `copilot://mydestination?type=LOCATION&action=GOTO&lat=&long=`; Android 12+ uses the `https://copilotgps.com/copilotgps?` form | yes |
  | Trucker Path | `geo:` (their Android 12+ guidance) | the app's own profile |
  | Garmin dēzl | `geo:lat,lng` (forum-reported) | the device's profile |
  | Google Maps / Apple Maps | `google.navigation:q=` / unified Maps URL | **no**: labelled "not truck-checked" (NAV-17) |

  - Start always passes **coordinates, never the street address** (the analysis: shipper addresses geocode badly).
  - Detection uses `Linking.canOpenURL` with Android `<queries>`, and a target is offered only if it resolves (§11 [N1]).
  - The org default is a `driver_app_features` setting (D-DA13). A driver's own pick is remembered on the device.
- **S3.4** Option B is designed only: the Ferrostar spike (Q-NV3), after A ships.
- **S3.5** D-PM5 keeps the catalog's navigation module row hidden "until the nav programme ships". Option A is that release
  for our org.
  - The row moves to `released` for our org through the catalog, audited (D-PM8).
  - It is never a code path around the flag.

**Done when:**

- on the tablet, a staging load shows its truck route;
- Start opens every app X2 lists with the stop's coordinates;
- the owner has seen screenshots.

### S4: The tablet layout

**Owns:** `src/components/Screen.tsx`, a new `src/lib/windowClass.ts` (with a test in the pattern of
`screen-padding.test.ts`), and the DESIGN.md wide-windows section.

- **S4.1** `windowClass(width, height)` replaces the `width >= 600` test (D-DA11).
- **S4.2** Medium and expanded windows get list–detail layouts: Loads (list | load) and Messages (list | thread). The
  Navigate map uses the full width. Every other screen keeps the centred column (§11 [U3]).
- **S4.3** Orientation follows X4 (the mount).
  - Landscape mount: landscape is supported on medium and expanded windows.
  - Portrait mount: the lock stays. The Tab A9 runs Android 15, so the lock holds there.
  - Both are rules in `windowClass`, not device checks.
- **S4.4** A "Wide windows" row goes into DESIGN.md's pattern table (:242-254), with screenshots in light and dark at both
  text sizes (:270). The owner sees them before merge.

**Done when:** the S4.4 screenshots are taken on the tablet, in the X4 orientation.

### S5: Defects and the device gate

**Owns:** the screens named in X1, `tokens.ts`, `IconButton.tsx`, `EmptyState.tsx` and `FIELD-REPORTS.md`.

- **S5.1** Each X1 item is fixed in one PR per screen, with a model test where the bug is logic.
- **S5.2** F12:
  - rows 56;
  - `IconButton` 48;
  - `EmptyState`'s action becomes `secondary` at 48 pt.
- **S5.3** FR3:
  - Reproduce it on a post-#2667 build.
  - If it is gone, close it as F5 with the evidence.
  - If it is not, open its own investigation.
  - Re-test FR2 after the HazmatGuard grant.
- **S5.4** The device gate on the tablet against staging:
  - `RELEASE-GATE.md` gates B–D;
  - the Stop footer;
  - late photos with a real staging login (the dev bypass has no token);
  - #2650's map in both themes, which is the owner's look (D-DV28);
  - the widgets and Live Activity;
  - Q-DV8(b).

**Done when:** every X1 item is closed or has a recorded reason, and gates B–D pass.

### S6: The shared motion service and the lock while moving

**Owns:**

- a new `apps/driver/src/features/motion/**`;
- the lock overlay in `app/_layout.tsx` (after S7);
- the location lines of `app.config.ts`, the iOS purpose strings, the privacy manifest;
- `scripts/check-android-manifest.mjs` and `tests/android-manifest.test.ts`.

- **S6.1** The speed source is the phone's GPS, used only while the app is in use (`ACCESS_FINE_LOCATION`, never background).
  - Why the phone and not Samsara's `vehicle_positions.speed_mph`: the lock must hold without signal, and a server read
    needs a network (§11 [U4]).
  - Samsara's speed and `driver_hos_clocks.duty_status` stay the office's signal.
  - This supersedes D-PR6, D-PM4 and D-PM9 by name.
  - The Play Data Safety form and the iOS privacy manifest declare location for this purpose only. Nothing is stored or
    sent.
- **S6.2** `motionModel(samples)` is pure and tested: lock above 5 mph, unlock after 3 s at 0, hold the last state with no
  fix. The tunables come from `driver_app_features` (D-DA13).
- **S6.3** D-DA5's lists, applied through one `useMotion()` hook:
  - locked surfaces show "Pull over to finish this" with the "I've parked" attestation tap (D58, never a dead end);
  - "Got it" and a call stay available.
- **S6.4** The co-driver.
  - On a load with a second seat (`loads.co_driver_id`), the passenger can tap "I'm not driving".
  - The office sees each one with the time, and `driver_hos_clocks` shows whose duty status is driving.
  - It is never offered on a solo load.
  - Basis: J.B. Hunt's Carrier 360 added an admin-controlled "I'm not driving" mode (§11 [L5]).
- **S6.5** Permission refused: locked with the attestation (D58, O17).

**Done when:**

- `motionModel`'s tests pass;
- a drive in a vehicle with the tablet locks and unlocks at the tunables, recorded;
- CI's merged-manifest check is updated.

### S7: The release lane, prepared and kept local (D-DA12)

**Owns:** `.github/workflows/driver-store.yml`, `apps/driver/eas.json`, `app.config.ts` (`googleServicesFile`), the
CLAUDE.md lane paragraph, `RELEASE-GATE.md` and `STORE-TESTING-ROUTE-2026-11-23.md`.

**Owner actions** (one complete list):

- **S7.1** Firebase project for `com.silvicom.fuelguard.driver`.
  - `google-services.json` goes in as an EAS file secret, never committed. It is needed for push even on local builds.
- **S7.2** Sentry DSN in the EAS `production` environment.
- **S7.3** Apple:
  - register the App Group `group.com.silvicom.fuelguard.driver` and the widget extension;
  - the Individual → Organization conversion (Q-5), needed only for the stores later.
- **S7.4** `EXPO_TOKEN`, only if CI builds are wanted. A Mac `eas build` needs none.
- **S7.5** Play Console, only when Q-DA2 says yes:
  - the internal track;
  - App Signing with "use an existing key" (this cannot be undone; D-PR4);
  - the service-account JSON;
  - Data Safety with S6's location purpose;
  - the review account.

**Claude actions:**

- **S7.6** `is-ancestor` on every trigger (D-MK26).
- **S7.7** Measure the 16 KB page size on the release bundle with `scripts/check-16kb.mjs` (`RELEASE-GATE.md:127`).
- **S7.8** CLAUDE.md's lane list: remove `driver-ota` and `driver-android`.
- **S7.9** A local **release** build, version 1.0.0 with runtime 1.6.0, installed by `adb` on the tablet. The first store tag,
  when ruled, is `driver-v1.0.0-rc.1`.
- **S7.10** Driver logins for the tablet testers, from S0.3's count. They are issued in web → Roster → App access.

**Done when:** the tablet runs a local release build, receives a push, and its outbox sends.

### S8: Default-yes features (after D-DA2)

Each item is its own chat, its own pure `*Model.ts` and one named DESIGN.md pattern, with screenshots to the owner.

- **S8a, DF-11 Report a problem** (D-DA6). Pick the load, then the kind: breakdown, damage or shortage, or refused load. Then
  photos through the one scanner and a sentence.
  - A breakdown becomes an intake in `ROADSIDE-REPAIR-FLOW-PLAN.md`; read that plan first.
- **S8b, DF-12 HOS** (D-DA8). `GET /api/me/hos` reads `driver_hos_clocks` by `drivers.samsara_driver_id`, shows "as of
  HH:MM", and feeds Today and the lock-screen widget.
- **S8c, DF-8 one-tap call.** Dispatch is the load's dispatcher (`tms_dispatchers` via `movement.dispatcher_user_id`). Safety
  and payroll are org phone numbers in `driver_app_features`.
- **S8d, DF-10 Running late.** A time and a reason picked from a list. It is saved as a `load_events` row the board shows; it
  reaches McLeod at S9.
- **S8e, DF-18 Home time (read).** The next and last home date from `driver_time_off`, derived by D-HT21
  (`HOME-TIME-VISIBILITY-PLAN.md:61`). The request waits on B-MK8.
- **S8f, DF-13 Idle on the score.** Read from the existing `idle_*` tables, never recomputed.
- **S8g, DF-14 and DF-16 document types:** med card, CDL renewal and fuel receipt, in the one scanner. Med card and CDL go to
  Safety's DQ flow (`dq-into-drivers`); the fuel receipt follows D-IP7.
- **S8h, DF-19 Refer a driver:** name and phone into recruiting leads. No bonus text until X9.

### S9: The driver half of McLeod writes (API Kit)

The app needs nothing beyond S1: `action_id`, the outbox that never gives up, `late_evidence`, and "Not sent yet". The
pipeline is the register's:

1. Track T: from T-1 (MK0 tables) to T-12 (canary), then `live` for `stop_clear`.
2. Track D: MK4 images.
3. MK6: DF-10's call-in, behind C-18.

**Gates:**

- switches only from the platform console (D-MK12);
- canary order pickups → non-EDI deliveries → EDI (C-19, D-MK33);
- no write without Alex Lockwood's written OK.

**Read-back is already collected.** McLeod's `actual_arrival`, `actual_departure` and `status` come back on the 60-second
sweep (`loads.mjs:183-205`), so the write is verified from the data we already have.

For the driver, a live `stop_clear` means: Complete clears the stop in McLeod with both dates and `isReportable=false` (O-4).

---

## 6. Out of scope, with the reason

| Item | Reason |
|---|---|
| Pay, settlements, advances, detention and lumper requests | D-DA1 |
| Navigation Options C and D (`@nav/compliance`) | D-DA4 |
| A computed ETA | D-DA10 |
| Editing duty status | D-DA8 |
| Accept and Decline on McLeod loads | The load is never `offered` |
| Fuel stops on the load | R9 |
| Training in the app | D-DA7 |
| News, surveys, a load board, the maintenance schedule, and Spanish | §3 defaults |

## 7. What already exists, so nobody rebuilds it

**Collectors:**

- **McLeod, every 60 s:** movements and stops, with stable `stop_id`, actual times, `eta`, the dispatcher and the
  co-driver codes (`schedule.mjs:18-39`, `loads.mjs:183-215`).
- **Samsara:**
  - positions every 5 s (`vehicle_positions.speed_mph`);
  - HOS clocks every 5 min (`driver_hos_clocks`);
  - HOS logs and scores every 6 h;
  - Samsara-app documents every 15 min (`samsara_documents`).
- **Not collected:** DVIRs, McLeod `mc_position`, call-ins and imaging.
- **Not used:** Samsara routes and messages.

**Tests and harness:**

- 49 driver vitest files: outbox claim, policy, native scan outcome, itinerary/`mapsUrl`, deep links, the manifest, 16 KB,
  and design tokens.
- PGlite matrices: `load-lifecycle`, `late-stop-photo`, `load-dispatches`, `loads-mirror-*`, `hazmat_rls`, `rls`.
- `supabaseRecorder.expectOrgScoped`.
- CI `native-android`: the metric-parity test and the merged-manifest check.
- `capture-engine` `edges:score`, with SmartDoc and DocAligner in `~/.cache/silvicom-datasets/`.

**Device:** the Tab A9 recipe (adb, `.env` built from `STAGING_*` variables, the dev client), and `adb exec-out screencap`.

**Gaps this plan fills:**

| Gap | Segment |
|---|---|
| `mem-soak.mjs` | S2 |
| `motionModel` and the drive test | S6 |
| `navigateTargets` tests | S3 |
| `windowClass` test | S4 |
| A matrix for the stop-id tail | S1 |

**Not repo tooling:** the seed harness (`redesign-2026/harness/seed.tsx`) is untracked and excluded locally, and the plan
does not rely on it. There is no Maestro or Detox.

## 8. Risks

- **The first build carries the `action_id` requirement.** That is safe only while no build is installed (D-MK23). Run
  R3-21's install count before refusing any request without one.
- **Memory on the Tab A9:** about 3.7 GB of RAM, against the 1.7 GB ML Kit needs, with Samsara's app also running. The S2.3
  pass is measured with both running.
- **A public repo.** Never commit a `/ws` host, IP, account, token, Firebase file or keystore. `lint:mcleod-secrets` is not
  built yet.
- **The HERE licence (Q-NV2)** may exclude showing routes in-app. S3 does not reach drivers until it is answered.

## 9. Outside facts

| # | Fact | Who | Blocks | Build for each outcome |
|---|---|---|---|---|
| X1 | The owner's list of UI bugs from 2026-11-25, with screenshots | Owner | S5.1 | No list: the device gate becomes the list |
| X2 (= Q-NV4) | The navigation and ELD apps on the fleet tablets | S0.2, then fleet IT or three drivers | S3.3 order; S2.3 bar | One row each; none: Google Maps labelled "not truck-checked" |
| X3 (= Q-NV5) | Is Samsara Commercial Navigation in our contract? | Samsara rep, in writing | S3.3 default | Yes: Samsara first. No: the X2 truck app first |
| X4 | Tablet mount: portrait or landscape, with a photo | Owner | S4.3 | Both outcomes are in S4.3 |
| X5 (= Q-LED2) | DocAligner weights licence | A document read | S2 shipping | Both outcomes are in S2.4 |
| X6 | Does billing need driver photos of lumper receipts or revised RCs? | Billing | Document types | Yes: one more scanner type. No: nothing |
| X7 | Do drivers file DVIRs in Samsara today? | Safety manager + a `/dvirs/stream` sample | DVIR | Yes: collect Samsara DVIRs on a schedule into one table (no app work). No: an S8a DVIR to 49 CFR 396.11 fields, owner-ruled first |
| X8 (= Q-NV2) | Does the HERE plan's licence allow showing routes in the driver app? | Owner, in the HERE console | S3 reaching drivers | No: Option A waits for a licence change, and Start (hand-off) ships alone |
| X9 (= Q-DF-3) | Is there a referral bonus to show? | Owner or HR | S8h text | Yes: the figure from HR. No: no bonus line |
| API Kit §6 | The ten register answers | McLeod, both Alexes, the owner | S9 | The register's own column |

## 10. Owner questions (business choices no source can make)

- **Q-DA1: miles and time left on the route preview.**
  - D-DV13 bans "miles left" because there was no honest source. Option A has one: HERE's route for the load, labelled as
    the route's figure, not an arrival promise.
  - **Recommendation:** allow both on the Navigate screen only, labelled "on this route".
  - Evidence: the analysis's Option A definition; DB7 measured the *board's* verdict as unreliable, not a route's length.
- **Q-DA2: does Play's internal testing track count as "local"?**
  - **Recommendation:** yes, for up to 100 named drivers.
  - Evidence: it needs no review, is invisible to the public, and is the only way Android push and real-network behaviour
    are tested on drivers' own devices (`STORE-TESTING-ROUTE:§2`).
  - Until it is ruled, S7 stays at adb installs.

## 11. Sources

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

- 49 CFR 392.80: https://www.law.cornell.edu/cfr/text/49/392.80
- 49 CFR 392.82: https://www.law.cornell.edu/cfr/text/49/392.82
- 49 CFR 390.5: https://www.law.cornell.edu/cfr/text/49/390.5
- FMCSA fact sheet: https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet
- 49 CFR 395.22: https://www.law.cornell.edu/cfr/text/49/395.22
- 49 CFR 396.11: https://www.law.cornell.edu/cfr/text/49/396.11

**[L] Lock while moving**

- [L1] Motive: https://helpcenter.gomotive.com/hc/en-us/articles/6475129978909-Getting-Started-with-Motive-for-Drivers
- [L2] Samsara: https://kb.samsara.com/hc/en-us/articles/4402783578893
- [L3] J.B. Hunt: https://drivers.jbhunt.com/blog/why-drive-with-j-b-hunt/drive-easy-with-the-j-b-hunt-drive-app
- [L5] Carrier 360 "I'm Not Driving" (third-party report): https://www.marketscreener.com/JB-HUNT-TRANSPORT-SERVICE-9769/news/JB-Hunt-Transport-Services-Carrier-360-Introduces-I-m-Not-Driving-Mode-28700021/

**[N] Navigation**

- [N1] Google Maps intents: https://developer.android.com/guide/components/google-maps-intents
- Apple unified Maps URLs: https://developer.apple.com/forums/thread/784030
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

## 12. Progress log

One file per entry in `docs/plans/drivers-app/enterprise-progress/`.

- **2026-11-26:** Revision 1 (PR #2674).
- **2026-11-26:** Revision 2, from the second audit layer (§0).
