# Driver app 2026: trends, rebuild or rewrite, store readiness, references

2026-11-20. An analysis written to support a decision; nothing has been built yet. The reference images are in `REFERENCE-GALLERY.html`, next to this file.

## 1. What exists today (measured, not remembered)

- `apps/driver`: Expo SDK 57, React Native 0.86, React 19.2, Expo Router, NativeWind 4, Reanimated 4. **The stack is current, so it isn't the problem.**
- 27 route files, about 18.9k lines of app, src and native-module code, and 32 test files.
- The expensive and proven parts are:
  - `@silvicom/capture-engine` plus the Swift and Kotlin `capture-native` module. Both are bit-identical to the reference implementation.
  - The offline outbox in `src/data/sync.ts` and `handlers.ts`.
  - Session and auth, Sentry, the OTA runtime-version discipline, and EAS store config.
- This is the fourth design pass: DS 2.0, Direction B, the D-DB10–18 polish, and now this one. **None of the earlier passes ever reached a driver's phone**, because the GitHub "possibly malicious workflow" hold (memory `driver-release-lanes-need-approval`) stopped every APK and OTA after 2026-08-22. Production also holds zero completed captures.

## 2. Rebuild the front end, keep the engine (recommendation)

| | Update the existing screens | New app from scratch | **New front end on the existing engine** |
|---|---|---|---|
| Design freedom | Limited, because the old IA keeps pulling the design back | Full | Full |
| Scanner, offline sync, auth, OTA, store config | Kept | Rewritten, which means weeks of work and repeating the Phase 4 traps | Kept |
| Store approval | Same history | A new bundle id means a new review, and drivers re-install | Same bundle id, same listings |
| Rough time to a pilot | Fast, but only gets to "same, prettier" | 10–14 weeks | **5–7 weeks** |

How to do it: create a fresh `app/` route tree and a new design system in the same `apps/driver` package, behind a build flag. Then delete the old screens as each new one replaces them. The packages `capture-engine`, `src/data`, `src/session`, `modules/capture-native`, and the shared contracts stay untouched.

**Do features before design.** The owner's complaint is that the features are wrong, and new paint won't fix wrong features. The McLeod API Kit decides what the driver can actually *do*:
- `clearStop` for stop completion
- call-in ETA
- image upload to McLeod Imaging
- home time

Two corrections already found also constrain the feature list:
- Accept/Decline can never work on McLeod loads.
- Dispatched loads in `approved` status are invisible to drivers.

So step one is a one-page feature list the owner rules on. Design starts after that.

## 3. 2026 trends, and what each one means for this app

| # | Trend | For our drivers |
|---|---|---|
| 1 | **Liquid Glass** (iOS 26) | **Adopt for native chrome only.** Expo Router `NativeTabs` and native stack headers get it free with the iOS 26 SDK. This replaces our custom 11 KB `TabBar.tsx`. Never put glass on content. |
| 2 | **Material 3 Expressive** (Android 16) | **Adopt.** `NativeTabs` renders M3 on Android. Don't fake iOS glass on Android. |
| 3 | **Native UI from JS** (`@expo/ui` SwiftUI/Compose, stable since SDK 56) | **Adopt** for sheets, pickers, toggles, and menus. It looks native rather than "RN generic". |
| 4 | **Live Activities and Android 16 Live Updates** | **Highest value.** The next stop, the appointment window, and HOS remaining go on the lock screen and Dynamic Island, the way Flighty does it. Guideline 4.5.3 bans using them for spam, which is fine for us. |
| 5 | **Proactive "next action" home** (agentic UX) | **Adopt.** One recommended next step rather than a dashboard: "Scan BOL for stop 2" or "Med card expires in 9 days". |
| 6 | **Thumb zone, bottom-anchored actions** | **Adopt.** The primary action goes in the bottom third. 56 pt targets for gloves, which is above the 44/48 minimum. |
| 7 | **Dark mode as its own design** | **Adopt, dark first.** Night driving. See the palette in the gallery. |
| 8 | **Purposeful motion and haptics** | **Adopt, lightly.** Haptics confirm a scan or an upload. No decorative animation. |
| 9 | **Passkeys and biometric sign-in** | **Adopt.** Face ID or fingerprint unlock. Passkeys through Supabase need a check. |
| 10 | **Accessibility built in** (Dynamic Type, WCAG 2.2) | **Required.** Sunlight readability and large text. Many drivers are over 50. |
| 11 | **Speed and offline as design** | **Already our strength.** Skeletons, the outbox, and a "saved, will send" state. |
| 12 | **Bento / grouped content** | **Use carefully.** It quickly becomes the generic AI dashboard. At most one grouped block per screen. |
| 13 | **Hands-free and in-car** (CarPlay / Android Auto) | **Constrained.** 49 CFR 392.80/392.82 forbids hand-held phone use while driving, so we need a locked "driving" mode, and CarPlay later. |
| 14 | **Expressive type and variable fonts** | **Adopt.** One display face for numbers, separate from the text face. Not Inter (brand rule). |
| 15 | **Camera-first capture** | **Already built** (capture engine). Make the camera one tap away from every load. |

## 4. Store acceptance: blockers to clear before any design work matters

1. **Apple account type.** As of 2026-09-08 it was **Individual**. That carries a guideline 5.1.1(ix) risk for apps holding sensitive data, and it limits internal TestFlight to one seat. Re-check before anything else; the conversion is a support request to Apple.
2. **Xcode 26 / iOS 26 SDK.** Required for uploads since 2026-04-28.
3. **In-app account deletion, guideline 5.1.1(v).** Ours is the P4 "closure request" flow with §391.51 retention, explained in the review notes.
4. **New age-rating questionnaire.** It now includes the social-media questions (required since Sept 2026). Messaging with dispatch counts as messaging, so answer it honestly.
5. **Demo account for App Review.** Invite-only login means Apple needs a seeded review fleet (P6). Alternative: **Apple Business Manager custom or unlisted distribution**, which suits a carrier-only app and has a lighter review on 4.2.
6. **Google Play target API 36.** Required for every update since 2026-08-31; the extension ended 2026-11-01.
7. **16 KB page size.** Mandatory for updates from **2027-02-01**. `check-16kb.mjs` has never run on a real bundle (Q-PR5).
8. **Google Play account type.** If it is a personal account created after Nov 2023, Google requires a closed test with 12 testers over 14 days before production. If it is an organization account, the D-U-N-S number is needed.
9. **Location, camera, and notification purpose strings, plus the privacy manifest and the Data Safety form.** These must match what the new features actually collect.
10. **The CI hold on the driver workflows.** Without the owner clicking "Approve and run", no build ever leaves CI.

## 5. Design-skill tooling

Already installed on this machine:
- the Expo plugin, which includes `expo-design-system` (with a native-slop "tells" catalogue), `expo-native-ui`, `expo-ui`, and `expo-animation`
- `impeccable` (critique, audit, polish)
- `ui-ux-pro-max`
- `apple-design`
- the project's own `silvicom-brand` skill

Worth adding:
- **draftbit/mobile-taste-skill** (MIT). Six skills: taste, nav plan, design system, design review with an "AI Slop score", redesign screen, and redesign app. It's built for Expo, Expo Router, NativeWind, and Reanimated, and bans the indigo gradient, five tabs with a FAB, white card stacks, emoji icons, and "Welcome back, John". It's very young (11 stars, 4 commits), so read it before trusting it. Install: `claude plugin marketplace add draftbit/mobile-taste-skill`.
- **vercel-labs/agent-skills → react-native-guidelines** (34k stars). Covers performance and architecture (FlashList, expo-image, Reanimated), not visual taste. Install: `npx skills add vercel-labs/agent-skills`.

Skipped:
- `ceorkm/mobile-app-ui-design` (572 stars) is oriented to web and Tailwind, not React Native.
- `reyjoypsabino/mobile-app-ux-design-skill` has no license ("all rights reserved").
