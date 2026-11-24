# Driver app: getting it into the stores for real-driver testing

2026-11-23. This is an analysis to support a decision. Nothing has been built or submitted yet. Every
"measured" line below was read today from EAS, GitHub or `origin/main`. Facts carried over from
September are marked as such.

## 1. Where we stand (measured today)

| Fact | Value | What it means |
|---|---|---|
| EAS project | Exists (`46eadc59…`, account `miroslavjokovic`), CLI logged in | Builds can be cut from this Mac today. No GitHub workflow is needed. |
| iOS store builds ever made | **1**: v1.0.0 (build 1), commit `590d39ed`, 2026-09-08, uploaded to App Store Connect (app id `6809905033`) | It is too old to test. It has runtime 1.2.0, while main has **1.5.0**, and **31 driver commits** have landed since. That covers the new design, the live-edge scanner and the one-scanner wiring. |
| Android store builds ever made | **0**. No Play service-account JSON exists anywhere | Nothing has ever reached Google Play. |
| Last APK from CI | 2026-08-09 | `driver-android`/`driver-ota` runs end with 0 jobs. Two things stop them: the `RELEASE_TRAIN` skip and GitHub's "possibly malicious workflow" hold. `driver-store.yml` has run once (09-07), and that run failed. |
| Over-the-air updates | **Retired.** D-AWS16 (2026-10-22): "the driver app ships through Google Play and the Apple stores" | Every fix during the pilot needs a new store build. See §5, Q-ST3. |
| EAS `production` env | API URL, Supabase URL and anon key are set. **No Sentry DSN** | During the pilot we would get no crash reports. This must be set before the build. |
| Apple membership | Was **Individual** on 2026-09-08 (team `FADWJ952AY`). **I could not re-check it today** because the portal login was refused in this session | If it is still Individual: internal TestFlight is limited to you, the seller name is your personal name, and guideline 5.1.1(ix) is a risk for public release. **External TestFlight still works.** |
| Gate D store items done | Account closure (5.1.1(v)), privacy manifest (re-verified in the binary), export compliance, target API 36, least-privilege permissions, `/privacy` `/terms` `/support` pages, review-notes text, TestFlight text | Most of the paperwork Apple and Google check is already done. |
| Gate D items still open | DSA trader status, age-rating questionnaire, Play Data Safety form, review demo account (P7), screenshots (P8), **16 KB page-size check never run on a real bundle** | Only the last two items in the table below block *testing*. The rest block *public* release. |
| Gate B (device matrix) / Gate C (no-egress, OCR latency) | Never run with a driver | This is what the pilot is for. |

## 2. Recommendation: test through the stores' tester channels, not a public listing

| | iOS: **TestFlight, external group** | Android: **Play internal testing** |
|---|---|---|
| Testers | Up to 10,000, invited by email or a public link | Up to 100, by Google-account email; they join with an opt-in link |
| Review | Beta App Review on the first build of each version, usually 24–48 h. Later builds of the same version often skip it | **None.** Testers can install within minutes of upload |
| Works on an Individual Apple account | Yes | n/a |
| Driver installs | The TestFlight app → Install. Builds expire after 90 days | Play Store, like any app |
| Fits this pilot | Yes | Yes |

We should not go public (or "unlisted") until the pilot passes. A full App Review needs the seeded
review fleet, screenshots, the age rating, and very likely the Organization account. None of that
helps 10–15 drivers test.

## 3. Steps, in order, and who does each

### Step 0: owner, in a browser (≈1 h total; only you can do it)

1. **Apple account type.** Go to developer.apple.com → Membership. If it still says Individual, start the
   Organization conversion now (Contact us → Membership and Account → Program Enrollment; you need the
   D-U-N-S number, legal name, Tax ID and address; it takes ~2 weeks). The conversion **does not block
   TestFlight**. It only blocks the public launch. The Team ID stays the same, so nothing in the repo changes.
2. **App Store Connect API key** (Users and Access → Integrations → Keys, "App Manager"). Download the `.p8`
   file (you can only download it once) and send me the Issuer ID and Key ID. EAS Submit uses this key.
3. **DSA trader status** (App Store Connect → Business). Apple requires it globally, not only for the EU.
4. **Google Play Console:**
   - Check the developer account type. **A personal account created after Nov 2023 must run a closed
     test with 12 testers for 14 days before it gets production access.** That does not affect
     internal testing, but it decides how long the path to public is. An organization account is exempt.
   - Create the app "Silvicom 360", package `com.silvicom.fuelguard.driver`.
   - App integrity → **"Use an existing key"** and enrol the existing release keystore
     (`~/FuelGuard-backups/`, D-PR4). **This cannot be undone.** It is what lets phones that already have
     the sideloaded APK upgrade in place.
   - Create a service account with release permission and give me the JSON key (it goes to EAS as a
     secret file and is never committed).

### Step 1: me, from this Mac (≈half a day)

1. Set `EXPO_PUBLIC_SENTRY_DSN` in the EAS production environment.
2. `eas build --platform all --profile production` from current `origin/main`. We use the laptop
   rather than CI, so the GitHub hold does not matter for the pilot. EAS auto-increments the iOS
   build to 2 or higher.
3. Check the artifacts, not the config: run `check-16kb.mjs` on the AAB (Play refuses non-compliant
   bundles), check the privacy manifest in the `.ipa` (4 required-reason APIs), and confirm no dev tooling is in the bundle.
4. iOS: run `eas submit` to TestFlight, fill Test Information from `TESTFLIGHT-TEXT.md`, create the internal
   group (Apple requires it before an external group), then create the **"Pilot drivers"** external group
   and submit it for Beta App Review. **Give the reviewer a working demo login even if they do not ask for one.**
   A reviewer who cannot get past the sign-in screen rejects the build, and that costs a day.
5. Android: **upload the first AAB by hand** in Play Console (Google's API cannot create an app's first
   release). Then put it on Internal testing, add the testers' emails, and copy the opt-in link.
   Every build after that goes through `eas submit`.

### Step 2: before the first driver opens the app (fleet + me)

These are not store problems, but each one alone would make the pilot look broken (from
`PILOT-TEST-PLAN.md`, last measured in September, so they need re-checking):

- **Each tester needs an app login.** In September 1 of 286 drivers had one (web → Roster → driver → App access).
- **Each tester needs loads to see.** Production had 0 loads then. Use the live McLeod connection
  if it now feeds driver loads, otherwise use `demo:loads` per tester.
- iPhone testers need the **TestFlight app**. Android testers need the **same Google account on the
  phone** as the one they were invited with.

### Step 3: the pilot

Run `RELEASE-GATE.md` **Gate B** (B1 offline first, B4 scanner). Collect feedback through
TestFlight's built-in screenshot feedback and through Sentry. Expect the first hazmat/BOL capture
in production to surface new issues: no capture had completed in production as of September.

## 4. Timeline and cost

- If Step 0 is done today: **Android testers install tomorrow; iPhone testers in 2–3 days** (Beta Review).
- Cost: both store accounts are already paid. The EAS free tier has ~30 builds/month (15 iOS) in a slow
  queue. That is enough for a pilot, but a fix-per-day cadence wants the $19/month Starter plan.

## 5. Open questions for the owner

- **Q-ST1: Who are the 10–15 testers, and which phones do they have?** This sets the size of the
  iOS/Android split and who needs a login and loads. *Recommendation:* include at least one older Android phone
  (Gate C latency) and at least one iPhone.
- **Q-ST2: Is the Apple account converted yet?** If not, start the conversion today, in parallel with the pilot.
- **Q-ST3: Should pilot fixes arrive without a store build?** D-AWS16 retired our own OTA server, so
  every fix is a new build, plus Beta Review on iOS for each new version number. Candidates: (a) accept
  this, rebuild and re-upload (~1 h per fix on Android, up to 2 days on iOS); (b) turn on **EAS Update** (Expo's
  hosted OTA, free up to 1,000 users, no server for us to run, and the app already carries `expo-updates`
  and runtime-version discipline), as a new decision rather than a revival of the retired server.
  *Recommendation: (b)* for the pilot. A day-two crash fix should not wait on Apple.
- **Q-ST4: Public listing or unlisted?** Decide this after the pilot. Apple's *unlisted* distribution fits a
  carrier-only app (still a full App Review, but the app is not searchable). It needs the Organization account.
