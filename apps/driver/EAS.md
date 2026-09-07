# EAS — why `eas.json` says what it says

Companion to `apps/driver/eas.json`, which carries **no comments of its own on purpose**: EAS
validates that file against a closed schema and rejects any key it does not know. Not just `//` —
[`$schema` is rejected too](https://github.com/expo/eas-cli/issues/2600). An unknown key there is not
a warning, it is "eas.json is not valid" and no build at all. So the reasoning lives here.

Decisions are `D-PR*` in `docs/plans/drivers-app/DRIVER-APP-DIRECTION-B-PLAN.md` §6.1.

---

## Why EAS is used at all

This repository self-hosts what it can — over-the-air updates go through an xprem server via `eoas`,
not EAS Update, and that does not change. EAS is here for **one reason**: since **2026-04-28** an App
Store upload must be built with **Xcode 26**, and there is no macOS runner in CI. GitHub bills macOS
at roughly ten times Linux and `ci.yml` explains at length why that trade has not been made. EAS's
macOS images carry Xcode 26, so `eas build --platform ios` is how an IPA gets made without the whole
release depending on one laptop being up to date (**D-PR3**).

Android could be built in GitHub Actions — `driver-android.yml` already does. It goes through EAS
too so that both platforms are cut from the same command, at the same commit, with the same
credentials story.

## `cli.appVersionSource: "local"`

Against Expo's own recommendation, deliberately. **D-PR2** derives both build numbers from the CI run
number: `app.config.ts` reads `IOS_BUILD_NUMBER` and `ANDROID_VERSION_CODE` from the environment, and
`driver-store.yml` sets both to `github.run_number`. A remote counter would be a second source of
truth for a value that must only ever increase, and the two would disagree the first time a build ran
anywhere else. `version` itself comes from `package.json`, bumped by hand, semver.

## The profiles

| Profile | What it is for |
|---|---|
| `development` | A dev client for a laptop. `APP_VARIANT=development`, so `expo-dev-client` stays in the plugin list. |
| `preview` | An APK a tester installs by hand — the same shape `driver-android.yml` produces today. |
| `production` | The store build. `APP_VARIANT=store`, an **App Bundle** because Play requires one, and `ios.image: latest` because that is what carries Xcode 26. |

`APP_VARIANT=store` is load-bearing rather than cosmetic: it is what drops `expo-dev-client` from the
plugin list, flips `aps-environment` to `production` and closes `NSAllowsLocalNetworking`
(**D-PR10**). `tests/native-config.test.ts` asserts all three, and `tests/eas-config.test.ts` asserts
that the production profile actually sets the variable — the two halves of one claim.

## Why the `EXPO_PUBLIC_*` values are in the file and the keys are not

`EXPO_PUBLIC_*` values are **not secrets**. They are compiled into the JavaScript bundle and are
already on every phone that has the app; `driver-android.yml` writes the same set into a `.env` from
GitHub secrets purely as a convenience. Putting them in `eas.json` means what a store build talks to
is readable in the repository rather than only in a CI settings page.

The **Play service-account JSON** and the **App Store Connect `.p8` key** are real credentials and
are never committed. They are uploaded once with `eas secret:create` and resolved at submit time.
`serviceAccountKeyPath` names where EAS puts the file during a submit, not a file in this repo.

## The `<placeholders>`

Seven values are written as `<...>` and are **not** guesses:

- the four `EXPO_PUBLIC_*` / `UPDATES_*` values — copy them from the GitHub environment
  `driver-android.yml` already uses; a store build pointed at the wrong API is a build that looks
  fine and talks to nothing.
- `ascAppId` — the numeric Apple ID of the App Store Connect record, visible in its URL once the
  record exists.
- `appleTeamId` — on the Apple Developer membership page.

`tests/eas-config.test.ts` counts them and prints what is left, so "how much of P2.3 is done" is a
test run rather than a memory. It does **not** fail on a placeholder: until P2.3 they are the correct
state of the file.

## Submitting to `internal` + `draft`

A submission that goes straight to production is one nobody looked at. Android lands on the **internal
testing** track as a **draft**; iOS lands in **TestFlight** after processing. Promotion to production
is a deliberate click in Play Console / App Store Connect (**P8**). An upload is not a review
submission — metadata and screenshots are **P3**, review credentials are **P7**.

## What has NOT happened

**None of this has ever run.** There is no EAS project (`extra.eas.projectId` is absent from
`app.config.ts`), no uploaded keystore, no APNs key and no App Store Connect record. That is **P2.3**,
the owner's one-time setup, and until it is done this file is configuration on paper.

The one-time sequence, once an Expo account is logged in:

```sh
npx eas-cli login
npx eas-cli init                 # writes extra.eas.projectId — commit it.
                                 # Also mints the push project id (plan §7 Q-PR1).
npx eas-cli credentials          # Android → upload the EXISTING keystore (D-PR4)
                                 # iOS → EAS-managed cert + profile, upload the APNs key
npx eas-cli secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY --type file --value ./play-service-account.json
npx eas-cli secret:create --scope project --name APP_STORE_CONNECT_KEY     --type file --value ./AuthKey_XXXXXX.p8
```

Two steps have no CLI and must be done in a browser:

1. **Play Console → App integrity → "Use an existing key"**, enrolling the same keystore via `pepk`.
   This is what lets a phone that installed the sideloaded APK upgrade **in place** from the store
   instead of having to uninstall first (**D-PR4**). Getting it wrong is not reversible.
2. **App Store Connect → create the app record** — name "Silvicom 360" (**D-PR1b**), primary category
   Business, secondary Productivity, iPhone only.
