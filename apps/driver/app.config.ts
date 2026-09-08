import { existsSync, readFileSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';

/** Resolved against both plausible working directories: Expo runs this config from apps/driver, but
 *  workspace tooling sometimes loads it from the repository root. Neither `__dirname` nor
 *  `import.meta.url` is dependable here — @expo/config transpiles and loads this file, and its module
 *  format is not ours to rely on. Two candidate paths is the honest, portable answer. */
function fromDriverDir(relative: string): string | null {
  for (const candidate of [relative, `apps/driver/${relative}`]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function readJsonFromDriverDir<T>(relative: string): T {
  const contents = fromDriverDir(relative);
  if (!contents) throw new Error(`apps/driver/${relative} is missing`);
  return JSON.parse(contents) as T;
}

/**
 * NATIVE RUNTIME VERSION — read from runtime-version.json, bumped whenever the native side changes
 * (ship-pipeline plan D2, decision D-S5).
 *
 * An over-the-air update is only ever served to a binary whose runtime version matches, which is what
 * stops a JavaScript bundle landing on an app that lacks the native module it calls. "Native change"
 * means anything under the local capture module, a new or upgraded native dependency, a config
 * plugin, a permission, an entitlement, or expo-updates itself.
 *
 * Deliberately a fixed string rather than `{ policy: 'fingerprint' }`. The fingerprint policy is the
 * more automatic answer and was this plan's original decision, but it hashes the resolved dependency
 * tree — and in a pnpm workspace a `--frozen-lockfile` CI install and a laptop install can produce
 * different hashes for the SAME commit. The failure mode is silent: updates simply never arrive, with
 * nothing logged anywhere. The safety it would have bought is bought instead in CI, which compares
 * the fingerprint of the last shipped APK against this build's and refuses to publish a JavaScript
 * update when the native side moved (.github/workflows/driver-ota.yml). Loud check, boring config.
 */
const NATIVE_RUNTIME_VERSION = readJsonFromDriverDir<{ runtimeVersion: string }>(
  'runtime-version.json',
).runtimeVersion;

/**
 * The marketing version (D-PR2) comes from package.json rather than being restated here. It was
 * restated here until 2026-09-07, and `driver-android.yml` names the APK from the package.json copy
 * — two values that had to agree with nothing checking that they did. One home, read from it.
 * Bumped by hand, semver; the BUILD numbers below are never hand-edited.
 */
const MARKETING_VERSION = readJsonFromDriverDir<{ version: string }>('package.json').version;

/**
 * The three chrome colours below are read from the theme rather than typed as hex, because they are
 * the same values the app paints with: `hero` is the navy the splash and the adaptive icon's
 * background stand on, and `action` is the amber Android tints a notification's small icon with.
 * A literal here is a fourth copy of a value that already has one home (Direction B §2.1, D-DB2).
 */
type RoleValues = Record<string, Record<string, string>>;
const roles = readJsonFromDriverDir<RoleValues>('src/theme/theme.roles.json');

/** theme.roles.json stores channels as "R G B" for NativeWind's `rgb(var(--role))`; a plist and a
 *  Gradle resource both want #RRGGBB. */
function hex(appearance: string, role: string): string {
  const value = roles[appearance]?.[role];
  if (!value) throw new Error(`theme.roles.json has no ${appearance}.${role}`);
  const channels = value.trim().split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new Error(`theme.roles.json ${appearance}.${role} is not three 0-255 channels: ${value}`);
  }
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * No hex literal in a comment here either. These three carried one each — `#14263F`, `#0A1422`,
 * `#F4A340` — and by 2026-09-08 all three were WRONG: the roles had moved to #20283A, #0F1219 and
 * #F2B267 while the annotations stayed put. A comment that restates a derived value is the same copy
 * with the same delay fuse as a literal, and it is worse than none, because a reader trusts it.
 */
const HERO = hex('light', 'hero');
const HERO_DARK = hex('dark', 'hero');
const ACTION = hex('light', 'action');

/**
 * STORE BUILD vs everything else (D-PR10). `APP_VARIANT=store` is set by the EAS production profile
 * (P2) and by the CI manifest assertion; it is what removes the dev launcher, flips APNs to the
 * production environment and closes local networking. Anything not explicitly a store build is
 * treated as a development build, which is the safe default: a dev build that accidentally ships is
 * caught by review, a store build that accidentally carries the dev launcher is not.
 */
const storeBuild = process.env.APP_VARIANT === 'store';

// The camera string is the one Apple's reviewer reads and the one the driver sees in the permission
// sheet, so it says what the photograph is FOR. Declared once and used twice — the Info.plist entry
// and the expo-image-picker plugin must not disagree.
const CAMERA_PERMISSION =
  'Silvicom 360 uses your camera to photograph load stops — bill of lading, seal, trailer and any damage — as proof of work.';

// Self-hosted update server (xprem). All three values are baked into the NATIVE build and can never
// be changed by an update — a new server URL, certificate or app id means a new APK, always. Absent
// = updates disabled entirely, which is the correct state for a laptop dev client.
const updatesUrl = process.env.UPDATES_URL;
const updatesAppId = process.env.UPDATES_APP_ID;
const hasCertificate =
  existsSync('certs/certificate.pem') || existsSync('apps/driver/certs/certificate.pem');

// Public config only — NEVER put secrets in `extra` (it ships in the bundle). Plan §12.5 / §21 F5.
const config: ExpoConfig = {
  // The store and home-screen name. "Driver" was dropped on 2026-09-07 (D-PR1b, owner ruling):
  // an iOS home screen truncates at roughly twelve characters, so "Silvicom 360 Driver" reads as
  // "Silvicom 36…" on the one surface a driver actually looks at. `slug` and both bundle
  // identifiers deliberately do NOT change — they are what a sideloaded install upgrades from and
  // what the OTA channel is keyed on (D-PR1).
  name: 'Silvicom 360',
  slug: 'fuelguard-driver',
  scheme: 'fuelguard',
  version: MARKETING_VERSION,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // @ts-expect-error @expo/config-types has never carried `newArchEnabled`, and Expo reads it. The
  // suppression is NEW here and the key is not: it was hidden behind the `@ts-expect-error` that
  // sat on `edgeToEdgeEnabled` in the android block until that key was removed above — TypeScript
  // was reporting one excess-property error for the pair and the directive absorbed it.
  newArchEnabled: true,
  experiments: { typedRoutes: true },
  icon: './assets/icon.png',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.silvicom.fuelguard.driver',
    /**
     * IGNORED under `appVersionSource: "remote"`, which eas.json has set since 2026-09-08 — EAS
     * writes `CFBundleVersion` into the native project at build time and this value only seeds the
     * remote counter the first time. Kept, rather than deleted, because `expo run:ios` and
     * `expo prebuild` on a laptop still read it and a missing key there means no build number at all.
     *
     * It reads `IOS_BUILD_NUMBER` for the same reason: driver-store.yml still exports the CI run
     * number, and a local source of truth that disagrees with CI is worse than a redundant one.
     *
     * ⚠ D-PR2 said this WAS the counter and `appVersionSource` was `local`. That decision assumed
     * every store build came from `driver-store.yml`. Measured 2026-09-08: that workflow's only run
     * ended `action_required` in 2 seconds and has never executed, while two production builds were
     * cut from a laptop — both stamped `1`, because `IOS_BUILD_NUMBER` is unset outside CI. App Store
     * Connect refuses a `CFBundleVersion` it has already seen, so the second upload would have been
     * rejected. The remote counter cannot go backwards and cannot be forgotten, which is the property
     * D-PR2 actually wanted; see Q-PR9 in DRIVER-APP-DIRECTION-B-PLAN.md for the full trade.
     */
    buildNumber: process.env.IOS_BUILD_NUMBER ?? '1',
    /**
     * EXPORT COMPLIANCE (`ITSAppUsesNonExemptEncryption`).
     *
     * `false` until 2026-09-08, annotated "HTTPS + OS crypto = exempt". The first half was true and
     * the second was not: this app links **SQLCipher** (the `expo-sqlite` plugin below sets
     * `useSQLCipher: true`, which compiles AES-256 into SQLite) and bundles **aes-js**. Both are
     * industry-standard cryptography carried IN the app, not the encryption "within the Apple
     * operating system" that Apple's export-compliance table names as the exempt case, and neither
     * fits any Category 5 Part 2 exemption — not medical, not IP protection, not authentication-only,
     * not banking, not fixed cryptography. The offline outbox holds unsynced driver work and is
     * encrypted at rest on purpose (D12); the declaration has to say so.
     *
     * The consequence is real and accepted: App Store Connect now asks the export questions on each
     * submission until a compliance code exists, and a French declaration is required to distribute
     * in France. What is owed to counsel — the French declaration and whether the 5D992.c mass-market
     * self-classification report to BIS applies — is recorded as Q-PR8 rather than guessed here.
     */
    config: { usesNonExemptEncryption: true },
    // A development build talking to the production APNs environment receives nothing, silently. The
    // variant decides, so neither case depends on somebody remembering to flip it.
    entitlements: { 'aps-environment': storeBuild ? 'production' : 'development' },
    infoPlist: {
      NSCameraUsageDescription: CAMERA_PERMISSION,
      // These two are NOT features. expo-secure-store declares Face ID and expo-haptics' dependency
      // chain declares motion, so the keys land in the plist whatever we do; an empty or missing
      // purpose string is an App Review rejection (2.3.10 / 5.1.1). Saying plainly that the app does
      // not use them is both true and the only string that does not mislead the driver.
      NSFaceIDUsageDescription:
        'Silvicom 360 does not use Face ID. This entry exists because the secure keychain library declares it.',
      NSMotionUsageDescription: 'Silvicom 360 does not read motion data.',
      // Cleartext is off in every build. Local networking stays open OUTSIDE a store build so that a
      // laptop dev client can reach a Metro bundler and a LAN API; a store build has no such need and
      // the entry is what a reviewer looks for.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: !storeBuild,
      },
    },
    /**
     * PRIVACY MANIFEST (App Store Connect, required since 2024-05 for apps and their SDKs).
     *
     * The collected-data list below is the driver half of the data matrix in DIRECTION-B-PLAN §6
     * P3.1 — the SAME matrix that P3 turns into the policy page and the Play Data Safety form, so a
     * disagreement between the three is a disagreement with one document rather than a guess.
     * Precise location is absent because it is not collected (D-PR6 removes expo-location).
     *
     * NSPrivacyAccessedAPITypes carried only the three categories Expo's own template declares
     * until 2026-09-08, on the plan that Xcode's privacy report at the first archive would name the
     * rest. It named none, because that report was never run — and the archive is not the only
     * verifier available. The BINARY is:
     *
     *     nm -u $(find "$DERIVED_DATA" -name '*.a') | grep -E '_f?statfs|_getattrlist'
     *
     * which on 2026-09-08 answered `libExpoSQLite.a: _fstatfs` — SQLite asking the filesystem how
     * much room it has before it writes. `fstatfs` is on Apple's required-reason list for
     * NSPrivacyAccessedAPICategoryDiskSpace, and neither expo-sqlite nor expo-file-system ships a
     * privacy manifest of its own (`ExpoFileSystem_privacy.bundle` contains an Info.plist and
     * nothing else; there is no ExpoSQLite bundle at all), so the declaration can only be made
     * HERE. Without it the upload fails ITMS-91053, which has been a hard requirement since
     * 2024-05-01 and is a known expo-sqlite trap (expo/expo#27678).
     *
     * The rule the previous comment stated still holds and is why the reason code below is 85F4.1
     * and not E174.1: a declared reason the app cannot justify is worse than a missing one. SQLite
     * CHECKS free space in order to write; the app never displays it to anyone, and the number
     * never leaves the device — which is exactly 85F4.1's condition.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [
        // Name and Driver ID: the account. Linked, never used for tracking.
        collected('NSPrivacyCollectedDataTypeName'),
        collected('NSPrivacyCollectedDataTypeUserID'),
        collected('NSPrivacyCollectedDataTypeEmailAddress'),
        // Stop proof and bills of lading (app/stop, PhotoGrid).
        collected('NSPrivacyCollectedDataTypePhotosorVideos'),
        // The Expo push token — a device identifier by Apple's definition even though it is minted
        // by APNs. Deleted on sign-out and on account closure (P4).
        collected('NSPrivacyCollectedDataTypeDeviceID'),
        // Messages with dispatch, stop notes, decline reasons.
        collected('NSPrivacyCollectedDataTypeOtherUserContent'),
        // Sentry (D-PR11). Scrubbed to a user id, so NOT linked to identity in Apple's sense.
        collected('NSPrivacyCollectedDataTypeCrashData', { linked: false }),
      ],
      NSPrivacyAccessedAPITypes: [
        // expo-file-system and expo-sqlite read and write file timestamps.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        // AsyncStorage and the theme preference are UserDefaults.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        // React Native's performance timers read the boot time.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        // SQLCipher/SQLite calls fstatfs to size a write before making it (measured in
        // libExpoSQLite.a, see above). 85F4.1 = check available space in order to write; the value
        // is never displayed and never sent off-device, which is what that reason requires.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['85F4.1'] },
      ],
    },
  },
  android: {
    package: 'com.silvicom.fuelguard.driver',
    // Android refuses to install a build whose versionCode is not higher than the installed one, so
    // CI passes its run number (ship-pipeline D1.2). Locally it stays 1 — a laptop build replaces a
    // laptop build. Never hand-edited: a human-managed counter is a counter that goes backwards.
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    // `edgeToEdgeEnabled: true` was here and is REMOVED, not moved: SDK 57's prebuild prints
    // "EDGE_TO_EDGE_PLUGIN: `edgeToEdgeEnabled` customization is no longer available — Android 16
    // makes edge-to-edge mandatory. Remove the entry." (measured on prebuild, 2026-09-07). The
    // behaviour it asked for is now the only behaviour; the key was a `@ts-expect-error` carrying a
    // warning on every build.
    // The offline outbox is unsynced driver work held in an SQLCipher database (D12). Android's
    // auto-backup would copy it to the driver's Google account, where its encryption key — which
    // lives in the Keystore and does NOT travel — cannot follow it. Off.
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: HERO,
    },
    /**
     * DECLARED permissions — the whole list, not additions to a template's. Camera for stop proof,
     * notifications for dispatch, and the two network permissions React Native and NetInfo need.
     * VIBRATE is expo-haptics.
     */
    permissions: [
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
    /**
     * BLOCKED permissions (D-PR7). A library's manifest merges its own permissions into ours whether
     * we want them or not: MapLibre asks for both location permissions, expo-image-picker's older
     * template asks for external storage, and a Play listing that requests location it never uses is
     * a Data Safety declaration we would have to make and could not justify. `blockedPermissions`
     * emits `tools:node="remove"`, so the merge drops them.
     *
     * ci.yml's native-android job asserts every one of these is absent from the MERGED manifest —
     * this list is a request to the manifest merger, and only the merged output is evidence.
     */
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.RECORD_AUDIO',
    ],
  },
  plugins: [
    './plugins/withGradleMemory.js',
    // Signs release APKs with our keystore instead of Expo's debug one (inert without CI env).
    './plugins/withReleaseSigning.js',
    // Android 13+ predictive back (P1.3). Verified on device in P8.
    './plugins/withPredictiveBack.js',
    'expo-router',
    // D-PR10: the dev launcher is not in a store build. Leaving it in ships an Expo dev menu, a
    // bundler URL field and a set of plist entries that have no business on a driver's phone.
    ...(storeBuild ? [] : ['expo-dev-client']),
    'expo-font',
    'expo-secure-store',
    // SQLCipher compiles encryption INTO SQLite — without it `PRAGMA key` is silently ignored and
    // the offline outbox (unsynced driver work) would sit in plaintext on the device (D12/§21).
    ['expo-sqlite', { useSQLCipher: true }],
    // Camera for per-stop proof-of-work photos (Phase 3C). Photos are re-encoded (EXIF stripped, D12)
    // before they ever touch disk or the network. Only the camera permission is declared — no photo
    // library, no microphone — least-privilege (§21).
    [
      'expo-image-picker',
      {
        cameraPermission: CAMERA_PERMISSION,
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    // MapLibre native map SDK (NAV NP0) — free/open vector tiles, no access token. The map hero in
    // B4.4 is a picture, not navigation: it needs no location permission, and both are blocked above.
    '@maplibre/maplibre-react-native',
    // The small icon Android draws in the status bar is a SILHOUETTE — only the alpha channel is
    // used and the system tints it, which is why `color` matters and the asset is white-on-transparent.
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: ACTION,
        defaultChannel: 'default',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        /**
         * 220, paired with the generator's `coverage: 0.70` for this asset. The mark now carries the
         * margin Android 12+'s circular splash mask requires, and this restores the size that margin
         * would otherwise have cost on iOS: 0.96 × 160 and 0.70 × 220 are both ~154dp of visible
         * mark. The two numbers move together or the mark changes size — see scripts/gen-app-icons.mjs.
         */
        imageWidth: 220,
        backgroundColor: HERO,
        dark: { backgroundColor: HERO_DARK },
      },
    ],
    /**
     * PINNED SDK levels (§6.0). React Native 0.86's version catalogue already resolves 36/36/24
     * today; pinning them means an RN bump cannot move them without this line moving, which is the
     * difference between "targets Android 16" and "happens to target Android 16". Play requires 36
     * for new apps and updates from 2026-08-31.
     *
     * `minSdkVersion: 24` is React Native's floor, not a choice. `buildToolsVersion` is pinned with
     * the SDK for the same reason.
     *
     * Minify and resource-shrink are ON for release: the store build is the one that has to be small,
     * and Hermes plus R8 is the configuration Expo's own release template tests.
     */
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 24,
          buildToolsVersion: '36.0.0',
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
        // Expo SDK 57's floor. Raising it drops iOS 15 devices; there is no reason to.
        ios: { deploymentTarget: '16.4' },
      },
    ],
    /**
     * D-PR11 — crash reporting goes native. The JS SDK already initialises from EXPO_PUBLIC_SENTRY_DSN;
     * this plugin adds the native crash handler and the Gradle/Xcode hooks that upload source maps
     * and debug symbols.
     *
     * The upload runs sentry-cli at build time and FAILS THE BUILD when it cannot authenticate — it
     * is a plain `exec` with no `ignoreExitValue` (node_modules/@sentry/react-native/sentry.gradle).
     * Only `SENTRY_DISABLE_AUTO_UPLOAD=true` skips it, which is why driver-android.yml — a lane that
     * has never had a Sentry token — sets exactly that. EAS production builds (P2) set the token
     * instead and let it run.
     */
    [
      '@sentry/react-native/expo',
      { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT },
    ],
  ],
  runtimeVersion: NATIVE_RUNTIME_VERSION,
  // Code signing is less optional than it looks: without it, anyone who reaches the update server can
  // push JavaScript to every phone in the fleet. The certificate is public and committed; the private
  // key never leaves the server (decision D-S7).
  ...(updatesUrl && updatesAppId
    ? {
        updates: {
          url: `${updatesUrl.replace(/\/+$/, '')}/manifest`,
          requestHeaders: { 'expo-app-id': updatesAppId },
          // ON_LOAD only CHECKS; the download is silent and the restart is a button the driver
          // presses (src/features/updates). An app that reloads itself mid check-in destroys work.
          checkAutomatically: 'ON_LOAD' as const,
          fallbackToCacheTimeout: 0,
          ...(hasCertificate
            ? {
                codeSigningCertificate: './certs/certificate.pem',
                codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' as const },
              }
            : {}),
        },
      }
    : {}),
  extra: {
    /**
     * EAS project id, from `eas init` on 2026-09-07 (@miroslavjokovic/fuelguard-driver).
     *
     * Public by construction — it ships inside the app manifest and identifies the project to EAS;
     * it grants nothing on its own. Written by hand because `eas init` cannot edit a DYNAMIC config
     * and says so; if it ever disappears, `eas build` stops resolving the project and
     * expo-notifications stops being able to mint a push token (plan §7 Q-PR1), which is the quiet
     * half and the reason tests/native-config.test.ts pins it.
     */
    eas: { projectId: '46eadc59-d21f-4aa7-afdc-c179eac7aa85' },
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
    mapStyleUrlDark: process.env.EXPO_PUBLIC_MAP_STYLE_URL_DARK,
    // Crash reporting (Phase 8.1) — a DSN is not a secret, but it is optional: absent = no-op.
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  },
};

/** Every row of the collected-data table has the same three answers — linked to the driver, never
 *  used for tracking, collected to make the app work. Writing them out seven times invites the day
 *  one of them says something different by accident. */
function collected(
  type: string,
  { linked = true }: { linked?: boolean } = {},
): {
  NSPrivacyCollectedDataType: string;
  NSPrivacyCollectedDataTypeLinked: boolean;
  NSPrivacyCollectedDataTypeTracking: boolean;
  NSPrivacyCollectedDataTypePurposes: string[];
} {
  return {
    NSPrivacyCollectedDataType: type,
    NSPrivacyCollectedDataTypeLinked: linked,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
  };
}

export default config;
