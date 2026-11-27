# HANDOFF: Driver app, from Visual 2026 to the features and logic plan

Date: 2026-11-22 · Repo: /Users/miroslavjokovic/Projects/FuelGuard (PUBLIC repo).

## Read first

1. `apps/driver/DESIGN.md`. This is the contract for every new screen:
   - the layers (palette → roles → `textStyle()` → primitives);
   - the "Screen patterns" table;
   - the primitive list;
   - the gates (`lint:tokens`, `lint:design`).

   Build features THROUGH it (D-DV16). Never style ad hoc.
2. `docs/plans/drivers-app/DRIVER-APP-VISUAL-2026-PLAN.md`:
   - §6.1 rulings and decision lines D-DV15 to D-DV25;
   - the open questions Q-DV4, Q-DV7 and Q-DV8. These are the hand-offs to features.
3. Progress, one file per step: `docs/plans/drivers-app/visual-2026-progress/`.

## State of the visual work

- **V0 to V8 and V3b (SDK 58): merged.**
- **V9: PR #2611, open.**
  - It adds the Live Activity, the Lock Screen widget, the Android widget, SF Symbols, native segmented controls, switches and sheets, and the glass map button.
  - It includes the two isolated design critiques and their fixes.
  - **It waits for the owner's screenshot sign-off and a ruling on the switch colour (Q-DV8 f).**
- **Swipe-to-act: PR #2615, open.** It is the planned V8 item: swipe to mark a notification or message read.
  - It conflicts lightly with #2611 in `app/notifications.tsx` and `app/messages/index.tsx` (imports only). Rebase whichever merges second.
- **Still to do in the visual plan:** the device gate (one iPhone, one Android, in a cab, day and night, gloves), then store screenshots from those devices. Both need owner actions:
  - "Approve and run" on the driver build workflows;
  - register the App Group `group.com.silvicom.fuelguard.driver` and the extension `com.silvicom.fuelguard.driver.ExpoWidgetsTarget` with Apple;
  - re-check whether the Apple account is Individual.

## Hand-offs to the features plan (logic, not looks)

1. **Stop photos use the OS camera, not our scanner** (owner, 2026-11-22: "BOL opens the system camera").
   - Not a simulator issue. It is by design since Phase 3C: `src/features/loads/stopCapture.ts` calls `expo-image-picker`'s `launchCameraAsync`.
   - The scanner exists, but only in Documents and hazmat capture: the capture engine `src/capture/engine.ts`, the native module `modules/capture-native` with live edges and a quality gate.
   - Routing the stop's `bol` slot (and maybe seal and trailer) through the capture engine is a feature decision. It touches:
     - the upload path;
     - the outbox payload;
     - the quality gate;
     - what the office receives.
2. **Q-DV7: a late photo for a finished stop.** The server refuses it (`driver_complete_stop`, migration 0141). The recommendation is a late-photo RPC plus an outbox kind.
3. **Q-DV8 (a): three ambers on the Stop screen while a photo is missing.**
   - The recommendation: the footer's primary becomes "Take seal photo" until nothing is missing, then "Complete stop".
   - It goes with D21's missing-photo reason.
4. **Q-DV8 (g): raw "HTTP 404" reaches drivers in banners.** Map every API failure to a sentence.
5. **Q-DV4:** the "Tight" appointment rule. It needs planned leg minutes from McLeod.
6. **Live Activity by push.** Today the app updates its own activity while it runs. Push needs an APNs key on the server and a token table. The props shape is `GlanceProps` in `src/features/glance/glanceModel.ts`: plain JSON, never null.
7. **Android 16 Live Updates** (Q-DV5, later).

## How a feature screen should be built (the visual system's rules)

- **Words of state** come from a pure model file next to the screen (`*Model.ts`) and are tested there; the `.tsx` only draws.
- **Colour roles carry state only** (D-DV5):
  - cyan = live;
  - amber = the ONE action on the screen;
  - red = safety or compliance stop;
  - green = done.
- **Status is a word in its colour,** never a pill. **Rows are not carded** (D-DV7). There is one raised signature block per screen.
- **Primitives to reach for:**
  - `ListRow`, with `swipeAction` once #2615 lands;
  - `GroupedList`, `Section`;
  - `Button`, `ActionBar` for the pinned primary;
  - `ConfirmSheet` and `ChoiceSheet` (the system's sheet);
  - `SegmentedControl`, `ToggleRow` (native);
  - `SkeletonRows`, `EmptyState`, `Banner`.
- **Icons:** name the Material Symbol. iOS draws its SF twin from `src/theme/sfSymbols.ts`. A new icon needs both the generated Material entry and an SF entry, or the typecheck fails.
- **Durations** come from `src/lib/duration.ts` ("2 hr, 10 min", the phone's own words).
- **No ETA, no miles left** (D-DV13) until a routing service exists.

## Traps (see also the V3b and V9 handoffs in the progress files)

- **The local screenshot harness** is `docs/plans/drivers-app/redesign-2026/harness/seed.tsx`. It is untracked and must never be committed.
  - Copy it to `apps/driver/app/seed.tsx` and open `fuelguard://seed?t=dark|light&duty=1&to=<path>`.
  - It seeds loads, an open shift, the driver profile, notifications, score and hazmat.
- **iOS simulator taps do not work here.** Android's emulator takes `adb shell input tap/swipe`.
  - Its AVD is `Medium_Phone_API_35`.
  - It boots without saved state, so reinstall the debug APK each time.
  - Run `adb reverse tcp:8081 tcp:8081` after each app restart.
- **`expo-modules-jsi` needs `scripts/apply-patches.mjs`** on Xcode 26.2 and 26.3 (expo/expo#52754). Remove it when Expo ships the fix.
- **A widget prop must never be `null`:** the Swift dictionary throws at app start. Registration is wrapped in `guarded()`.
- **Platform files:** a `Foo.ts` beside `Foo.ios.tsx` wins on iOS. Use the same extension for both.
- **Before every push:**
  - move `.expo/types` aside for lint and typecheck, as CI has none;
  - run `pnpm ci:local --job gates`;
  - run `CI=true pnpm --filter @silvicom/driver test`.
