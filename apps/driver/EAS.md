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

## Where the build's values come from — EAS environments, not this file

Every profile names an **EAS environment** (`environment: "development" | "preview" | "production"`),
and EAS injects that environment's variables into the build. `eas.json` itself declares only
`APP_VARIANT`, because that is a *decision* rather than an environment lookup: it says what kind of
build this is, and it should be reviewable in a pull request.

The first version of this file listed the `EXPO_PUBLIC_*` and `UPDATES_*` values inline, on the
argument that they are not secrets — they compile into the JavaScript bundle and are already on every
phone that has the app. That argument is still true and it is **not** why they moved. They moved
because the Supabase publishable key is a **JWT**, this repository runs `gitleaks` and
`scripts/scan-secrets.mjs` over all tracked content, and a JWT-shaped string in a committed file is
exactly what those gates exist to stop. Arguing with a secret scanner about a key that is genuinely
public is a fight worth losing (owner ruling, 2026-09-07).

Set them once, per environment:

```sh
eas env:set production --name EXPO_PUBLIC_API_URL          --value "<prod api url>"        --visibility plaintext
eas env:set production --name EXPO_PUBLIC_SUPABASE_URL     --value "<prod supabase url>"   --visibility plaintext
eas env:set production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<publishable key>"    --visibility sensitive
eas env:set production --name EXPO_PUBLIC_SENTRY_DSN       --value "<dsn>"                 --visibility sensitive
eas env:set production --name UPDATES_URL                  --value "<xprem origin>"        --visibility sensitive
eas env:set production --name UPDATES_APP_ID               --value "<xprem app id>"        --visibility sensitive
```

`plaintext` for the two URLs because they appear in build logs anyway; `sensitive` for the rest,
which keeps them out of logs without pretending they are unreadable — a `sensitive` variable is still
injected into the bundle, and the anon key still ships on every phone. Nothing here is `secret`,
because a `secret` variable cannot be read back and these are values we will want to check.

`eas env:list production` prints what is set, which makes "is the store build pointed at production?"
a command rather than a memory. `eas env:pull production` writes them to a local `.env` if you need
to reproduce a build.

**The real credentials are different.** The Play service-account JSON and the App Store Connect `.p8`
key are uploaded as files and never committed:

```sh
eas env:set production --name GOOGLE_SERVICE_ACCOUNT_KEY --type file --visibility secret --value ./play-service-account.json
eas env:set production --name APP_STORE_CONNECT_KEY      --type file --visibility secret --value ./AuthKey_XXXXXX.p8
```

`serviceAccountKeyPath` in the submit profile names where EAS places that file during a submit; it is
not a path in this repository.

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
# then the environment variables and key files above (eas env:set).
# `eas secret:create` still exists and is the older name for the same store; env:set is the
# current one and is what this document uses throughout, so there is one mechanism to learn.
```

Two steps have no CLI and must be done in a browser:

1. **Play Console → App integrity → "Use an existing key"**, enrolling the same keystore via `pepk`.
   This is what lets a phone that installed the sideloaded APK upgrade **in place** from the store
   instead of having to uninstall first (**D-PR4**). Getting it wrong is not reversible.
2. **App Store Connect → create the app record** — name "Silvicom 360" (**D-PR1b**), primary category
   Business, secondary Productivity, iPhone only.
