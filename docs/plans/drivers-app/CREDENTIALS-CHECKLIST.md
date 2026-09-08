# Store credentials — exactly what to provide, and where to put it

**Written 2026-09-08** for external TestFlight (iOS) and Play internal testing (Android), per the
owner's 2026-09-08 ruling on **Q-PR7**.

---

## Where secrets go, and where they must never go

**Do not paste any of this into a chat.** Two rules cover every value below.

| Kind | Home | Why |
|---|---|---|
| **Files** (`.p8`, service-account JSON, keystore) | On disk **outside the repo** — `~/FuelGuard-backups/` already holds the keystore, so use that. Then uploaded to **EAS**. | A file in the working tree is one `git add -A` away from a public repo. `lint:secrets` scans the tracked tree, but it cannot un-push a commit. |
| **Identifiers** (Issuer ID, Key ID, App Apple ID) | This document is fine for the App Apple ID; the Issuer ID and Key ID go in a note beside the `.p8`. | None of them is usable without the private key, but they are still account identifiers. |

⚠ **Not `.env`.** `apps/driver/.env` holds `EXPO_PUBLIC_*` values that are **compiled into the app
bundle by design** — anything put there ships to every phone. It is the wrong shape for a secret even
though it is gitignored.

**The real home is EAS.** `eas env:set` and `eas credentials` store these on Expo's servers, encrypted,
and the build machine reads them there. Nothing needs to live on a laptop long-term.

---

## Already done — no action needed

| Item | Value | How it was obtained |
|---|---|---|
| Apple Team ID | `FADWJ952AY` | Read from Xcode's signed-in account, 2026-09-08 |
| Apple Developer Program | Paid, active, **Individual** | Same |
| `eas.json` → `appleTeamId` | Filled | This PR |
| EAS `production` environment | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` set | This PR — a build before this would have compiled with no backend and installed a dead app |
| EAS `preview` environment | Same three | This PR — this is the profile an Android test APK uses |
| Android keystore | `~/FuelGuard-backups/fuelguard-release.keystore` | Already on the machine; matches the GitHub secret |

---

## 1 · Apple — what to provide

### 1a. App Store Connect API key — **the one blocking item**

Create at **App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys →
`+`**. Name it something like `silvicom-eas`. Role: **App Manager**.

Three things come out of it:

| Field | Looks like | Where it goes |
|---|---|---|
| **Issuer ID** | a UUID, `69a6de7e-…` — shown once at the top of the Keys page | note beside the file |
| **Key ID** | 10 characters, `A1B2C3D4E5` | note beside the file |
| **The `.p8` file** | `AuthKey_A1B2C3D4E5.p8` | save to `~/FuelGuard-backups/` |

⚠ **The `.p8` downloads exactly once.** Apple will not let you download it again — if it is lost the
key must be revoked and a new one made. Save it before closing the page.

Tell me the path and I upload it to EAS. Nothing needs to be typed into a chat.

### 1b. The app record

Confirm whether one exists in App Store Connect for bundle id **`com.silvicom.fuelguard.driver`**.

- **If it exists:** I need its **Apple ID** — a 10-digit number on the app's General → App Information
  page, labelled "Apple ID". It fills `eas.json`'s last placeholder (`ascAppId`).
- **If it does not:** I can create it once the API key above exists. Confirm the details:
  name **Silvicom 360**, primary category **Business**, secondary **Productivity**, iPhone only.

### 1c. The bundle identifier

In the Developer portal → Identifiers, `com.silvicom.fuelguard.driver` must exist with the
**Push Notifications** capability ticked. EAS can create it during the first build if the API key has
the rights; worth checking rather than assuming.

### 1d. Test Information — required before external testers can be invited

Apple's own requirement list for an external group. Not secret; give me the text or let me draft it:

- **Feedback email** — where tester feedback lands. Can be the support address below.
- **Contact information** — first name, last name, email, phone, for the review team.
- **"What to Test"** — per build. I will draft this from `PILOT-TEST-PLAN.md` §3.
- **Privacy policy URL** — already live from PR #672.

### 1e. External testing sequence, so nothing surprises you

1. An **internal group must exist first** — Apple requires it before an external group can be made.
   On an Individual account that group contains only you, and that is fine.
2. Build uploaded → added to an external group → **submitted for TestFlight App Review**.
   This is a lighter review than App Store review, typically a day or two, and it is per-version
   rather than per-build.
3. Then testers, by email invite, CSV, or a **public link** (up to 10,000, with an optional cap).

**A demo account is NOT required for TestFlight** — that is an App Store review requirement.
`STORE-REVIEW-NOTES.md` still holds it for the eventual store submission.

---

## 2 · Google Play — what to provide

### 2a. Confirm the account

- The Play Console developer account is registered (the one-time $25 fee paid).
- Whether it is an **Organization** or a **personal** account.
- The Google account email that holds **Admin** or **Release Manager** on it.

### 2b. Service account JSON — for `eas submit`

Play Console → **Setup → API access**. Either link an existing Google Cloud project or let the console
create one, then **Create new service account**, which sends you to Google Cloud. Give it a key
(**JSON**), download it, then back in Play Console **grant it access** with at least *Release
manager* on this app.

Save the JSON to `~/FuelGuard-backups/`. Tell me the path — I upload it to EAS as the secret
`eas.json` already names (`./play-service-account.json` is resolved from an EAS secret at submit
time, not from the repo).

### 2c. Signing

**Recommendation: let Google generate a fresh key.** The plan originally said to enrol our existing
keystore so a sideloaded APK would upgrade in place — but no APK has ever shipped, so there is
nothing to upgrade in place from, and the constraint is moot. A fresh Google-managed key is simpler
and safer.

Say if you would rather enrol `~/FuelGuard-backups/fuelguard-release.keystore` and I will do that
instead.

### 2d. App content — Play blocks every track, internal testing included, until these are done

None is secret; all are console forms.

- **Privacy policy URL** — live since #672.
- **Data safety** — answered from `apps/web/src/features/legal/legalMeta.ts`'s `DATA_MATRIX`, the same
  table the policy page renders. I can give you the exact answers to click.
- **App access** — declare that all functionality is behind a login and supply demo credentials.
- **Content rating** questionnaire, **target audience**, **ads** declaration (we have none),
  **government apps** (no), **financial features** (no).

### 2e. Testers

Google account emails, or one Google Group address to point the internal track at. A Group is easier
to change later than a list.

---

## 3 · Both

| Item | Why |
|---|---|
| **Support email** | `VITE_SUPPORT_EMAIL`. Without it, `/support` and the app say "ask your fleet manager", which is true but weaker than an address. Also serves as the TestFlight feedback email. |
| **Company legal name and address** | Both store listings. The privacy policy already names `Silvicom Inc.` |

---

## 4 · What happens once each arrives

| You provide | I do |
|---|---|
| `.p8` path + Issuer ID + Key ID | Upload to EAS, create the app record if needed, fill `ascAppId` |
| Play service account JSON path | Upload to EAS as the submit secret |
| Support email | One Railway variable; `/support` and the app stop saying "ask your fleet manager" |
| Nothing at all | **An Android preview APK can be built today** — `eas build --profile preview --platform android` needs no Apple account, no Play Console and no forms, and produces an install link |
