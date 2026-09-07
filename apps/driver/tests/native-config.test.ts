import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import withPredictiveBack from '../plugins/withPredictiveBack.js';

/**
 * app.config.ts is the whole of the app's native surface: the permissions Play lists, the strings
 * App Review reads, the SDK level Play enforces, and whether the dev launcher ships (D-PR1..D-PR11,
 * DIRECTION-B-PLAN §6 P1.1). None of it is visible in a screenshot and none of it is exercised by
 * any other test — the first evidence would otherwise be a store rejection, weeks later.
 *
 * The variant matters as much as the values, so every case here loads the config twice: once as a
 * store build and once as everything else.
 */

const ROOT = join(import.meta.dirname, '..');

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8')) as T;
}

const packageJson = readJson<{ version: string; dependencies: Record<string, string> }>(
  'package.json',
);
const roles = readJson<Record<string, Record<string, string>>>('src/theme/theme.roles.json');

/** theme.roles.json holds "R G B"; the config emits #RRGGBB. Recomputed here rather than imported,
 *  so a broken conversion in the config cannot agree with itself. */
function hexFromRole(appearance: string, role: string): string {
  const channels = roles[appearance]?.[role];
  if (!channels) throw new Error(`theme.roles.json has no ${appearance}.${role}`);
  return `#${channels
    .split(' ')
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

async function loadConfig(env: Record<string, string | undefined>): Promise<ExpoConfig> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import('../app.config')).default;
}

const store = () => loadConfig({ APP_VARIANT: 'store' });
const dev = () => loadConfig({ APP_VARIANT: undefined });

/** The plugin list mixes bare names and `[name, options]` pairs. */
function pluginNames(config: ExpoConfig): string[] {
  return (config.plugins ?? []).map((entry) =>
    typeof entry === 'string' ? entry : String((entry as unknown[])[0]),
  );
}

function pluginOptions(config: ExpoConfig, name: string): Record<string, unknown> {
  const entry = (config.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === name,
  ) as unknown[] | undefined;
  if (!entry) throw new Error(`no ${name} plugin with options`);
  return entry[1] as Record<string, unknown>;
}

describe('app.config.ts — identity (D-PR1, D-PR2)', () => {
  let config: ExpoConfig;
  beforeEach(async () => {
    config = await store();
  });

  it('keeps the bundle id and package a sideloaded install can upgrade from', () => {
    expect(config.ios?.bundleIdentifier).toBe('com.silvicom.fuelguard.driver');
    expect(config.android?.package).toBe('com.silvicom.fuelguard.driver');
    expect(config.slug).toBe('fuelguard-driver');
    expect(config.name).toBe('Silvicom 360');
  });

  it('takes the marketing version from package.json rather than restating it', () => {
    // driver-android.yml names the published APK from the package.json copy. Two values that must
    // agree, with nothing checking that they did, until this became one value.
    expect(config.version).toBe(packageJson.version);
    expect(config.version).toBe('1.0.0');
  });

  it('takes the runtime version from runtime-version.json', () => {
    expect(config.runtimeVersion).toBe(
      readJson<{ runtimeVersion: string }>('runtime-version.json').runtimeVersion,
    );
  });
});

describe('app.config.ts — the EAS project id (P2.3, Q-PR1)', () => {
  it('carries the id of @miroslavjokovic/fuelguard-driver', async () => {
    // `eas init` cannot write it: this is a dynamic config, and eas-cli says so and stops. So the
    // value is hand-written, which is exactly the kind of thing that gets lost in a merge. Without
    // it `eas build` cannot resolve the project AND expo-notifications cannot mint a push token —
    // and the second failure is silent, which is why it is pinned rather than trusted.
    const extra = (await store()).extra as { eas?: { projectId?: string } } | undefined;
    expect(extra?.eas?.projectId).toBe('46eadc59-d21f-4aa7-afdc-c179eac7aa85');
  });

  it('is a UUID, not a slug or an account name', async () => {
    const extra = (await store()).extra as { eas?: { projectId?: string } } | undefined;
    expect(extra?.eas?.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('survives in both variants — a store build needs it as much as a dev build', async () => {
    for (const config of [await store(), await dev()]) {
      const extra = config.extra as { eas?: { projectId?: string } } | undefined;
      expect(extra?.eas?.projectId).toBeTruthy();
    }
  });
});

describe('app.config.ts — build numbers come from CI, never from a hand edit (D-PR2)', () => {
  afterEach(() => {
    delete process.env.IOS_BUILD_NUMBER;
    delete process.env.ANDROID_VERSION_CODE;
  });

  it('reads both from the environment', async () => {
    const config = await loadConfig({
      APP_VARIANT: 'store',
      IOS_BUILD_NUMBER: '412',
      ANDROID_VERSION_CODE: '412',
    });
    expect(config.ios?.buildNumber).toBe('412');
    expect(config.android?.versionCode).toBe(412);
  });

  it('falls back to 1 on a laptop, where a build replaces a build', async () => {
    const config = await loadConfig({
      APP_VARIANT: undefined,
      IOS_BUILD_NUMBER: undefined,
      ANDROID_VERSION_CODE: undefined,
    });
    expect(config.ios?.buildNumber).toBe('1');
    expect(config.android?.versionCode).toBe(1);
  });
});

describe('app.config.ts — the store variant (D-PR10)', () => {
  it('drops the dev launcher from a store build and keeps it everywhere else', async () => {
    expect(pluginNames(await store())).not.toContain('expo-dev-client');
    expect(pluginNames(await dev())).toContain('expo-dev-client');
  });

  it('points push at the production APNs environment only in a store build', async () => {
    expect((await store()).ios?.entitlements?.['aps-environment']).toBe('production');
    expect((await dev()).ios?.entitlements?.['aps-environment']).toBe('development');
  });

  it('closes local networking in a store build and leaves it open for a Metro bundler', async () => {
    const ats = (config: ExpoConfig) =>
      config.ios?.infoPlist?.NSAppTransportSecurity as Record<string, boolean>;
    expect(ats(await store()).NSAllowsLocalNetworking).toBe(false);
    expect(ats(await dev()).NSAllowsLocalNetworking).toBe(true);
  });

  it('never allows arbitrary cleartext loads, in either variant', async () => {
    for (const config of [await store(), await dev()]) {
      const ats = config.ios?.infoPlist?.NSAppTransportSecurity as Record<string, boolean>;
      expect(ats.NSAllowsArbitraryLoads).toBe(false);
    }
  });

  it('ships the same plugins otherwise — the variant decides one thing', async () => {
    expect(pluginNames(await dev()).filter((n) => n !== 'expo-dev-client')).toEqual(
      pluginNames(await store()),
    );
  });
});

describe('app.config.ts — Android permissions (D-PR7)', () => {
  it('declares exactly the five permissions the app uses', async () => {
    expect((await store()).android?.permissions).toEqual([
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.ACCESS_NETWORK_STATE',
    ]);
  });

  it('blocks both location permissions, which MapLibre merges in unasked', async () => {
    const blocked = (await store()).android?.blockedPermissions ?? [];
    expect(blocked).toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(blocked).toContain('android.permission.ACCESS_COARSE_LOCATION');
  });

  it('blocks external storage, audio and overlay too', async () => {
    const blocked = (await store()).android?.blockedPermissions ?? [];
    for (const permission of [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ]) {
      expect(blocked).toContain(permission);
    }
  });

  it('never declares and blocks the same permission', async () => {
    const config = await store();
    const declared = new Set(config.android?.permissions ?? []);
    for (const blocked of config.android?.blockedPermissions ?? []) {
      expect(declared.has(blocked)).toBe(false);
    }
  });

  it('turns off auto-backup, which would copy the encrypted outbox without its key', async () => {
    expect((await store()).android?.allowBackup).toBe(false);
  });
});

describe('app.config.ts — Play’s SDK requirements (§6.0)', () => {
  it('pins target and compile SDK to 36, the level Play requires from 2026-08-31', async () => {
    const properties = pluginOptions(await store(), 'expo-build-properties');
    const android = properties.android as Record<string, unknown>;
    expect(android.targetSdkVersion).toBe(36);
    expect(android.compileSdkVersion).toBe(36);
    expect(android.minSdkVersion).toBe(24);
  });

  it('pins the iOS deployment target', async () => {
    const properties = pluginOptions(await store(), 'expo-build-properties');
    expect((properties.ios as Record<string, unknown>).deploymentTarget).toBe('16.4');
  });
});

describe('app.config.ts — the privacy manifest (§6.0, P3.1 data matrix)', () => {
  it('declares no tracking at all', async () => {
    const manifests = (await store()).ios?.privacyManifests;
    expect(manifests?.NSPrivacyTracking).toBe(false);
    for (const type of manifests?.NSPrivacyCollectedDataTypes ?? []) {
      expect(type.NSPrivacyCollectedDataTypeTracking).toBe(false);
    }
  });

  it('collects nothing that would be a location declaration (D-PR6)', async () => {
    const types = ((await store()).ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? []).map(
      (t) => t.NSPrivacyCollectedDataType,
    );
    expect(types.some((t) => t.toLowerCase().includes('location'))).toBe(false);
  });

  it('lists the seven data types the P3.1 matrix says the app collects', async () => {
    const types = ((await store()).ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? []).map(
      (t) => t.NSPrivacyCollectedDataType,
    );
    expect(types).toEqual([
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeDeviceID',
      'NSPrivacyCollectedDataTypeOtherUserContent',
      'NSPrivacyCollectedDataTypeCrashData',
    ]);
  });

  it('marks crash data unlinked and everything else linked', async () => {
    const types = (await store()).ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? [];
    for (const type of types) {
      expect(type.NSPrivacyCollectedDataTypeLinked).toBe(
        type.NSPrivacyCollectedDataType !== 'NSPrivacyCollectedDataTypeCrashData',
      );
    }
  });

  it('declares a reason for each required-reason API category', async () => {
    const apis = (await store()).ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? [];
    expect(apis.map((a) => a.NSPrivacyAccessedAPIType)).toEqual([
      'NSPrivacyAccessedAPICategoryFileTimestamp',
      'NSPrivacyAccessedAPICategoryUserDefaults',
      'NSPrivacyAccessedAPICategorySystemBootTime',
    ]);
    for (const api of apis) {
      expect(api.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
    }
  });
});

describe('app.config.ts — the strings App Review reads', () => {
  it('gives the camera the same purpose string in the plist and in the picker plugin', async () => {
    const config = await store();
    const picker = pluginOptions(config, 'expo-image-picker');
    expect(picker.cameraPermission).toBe(config.ios?.infoPlist?.NSCameraUsageDescription);
    expect(String(picker.cameraPermission)).toMatch(/proof of work/);
  });

  it('asks for neither the photo library nor the microphone', async () => {
    const picker = pluginOptions(await store(), 'expo-image-picker');
    expect(picker.photosPermission).toBe(false);
    expect(picker.microphonePermission).toBe(false);
  });

  it('names the app the same way in every string the driver or a reviewer reads', async () => {
    // A rename is exactly the change that lands in the config and misses the four purpose strings,
    // and the result — a permission sheet naming an app that is not the one on the home screen — is
    // a 5.1.1 rejection and a driver wondering what is asking. Checked against `name` rather than
    // against a literal, so it keeps holding whatever the app is called next.
    const config = await store();
    const plist = config.ios?.infoPlist ?? {};
    const strings = [
      plist.NSCameraUsageDescription,
      plist.NSFaceIDUsageDescription,
      plist.NSMotionUsageDescription,
      pluginOptions(config, 'expo-image-picker').cameraPermission,
    ].map(String);

    // `startsWith(name)` is NOT enough and was the first version of this test: "Silvicom 360 Driver
    // does not read motion data" starts with "Silvicom 360 " and is exactly the half-rename this
    // exists to catch (it survived the mutant). So take the whole opening run of capitalised and
    // numeric words — the product name as written — and require it to BE the app's name.
    const leadingProperNoun = (sentence: string) => {
      const words = sentence.split(' ');
      let end = 0;
      while (end < words.length && /^[A-Z0-9]/.test(words[end] ?? '')) end += 1;
      return words.slice(0, end).join(' ');
    };

    expect(strings).toHaveLength(4);
    for (const value of strings) {
      expect(leadingProperNoun(value)).toBe(config.name);
    }
  });

  it('answers Face ID and motion honestly rather than leaving them empty', async () => {
    const plist = (await store()).ios?.infoPlist ?? {};
    expect(String(plist.NSFaceIDUsageDescription)).toMatch(/does not use Face ID/);
    expect(String(plist.NSMotionUsageDescription)).toMatch(/does not read motion data/);
  });
});

describe('app.config.ts — chrome colours come from the theme (D-DB2)', () => {
  it('stands the adaptive icon on the light `hero` navy', async () => {
    expect((await store()).android?.adaptiveIcon?.backgroundColor).toBe(hexFromRole('light', 'hero'));
  });

  it('tints the notification icon with `action`', async () => {
    expect(pluginOptions(await store(), 'expo-notifications').color).toBe(
      hexFromRole('light', 'action'),
    );
  });

  it('splashes on `hero`, and on the dark theme’s `hero` in dark mode', async () => {
    const splash = pluginOptions(await store(), 'expo-splash-screen');
    expect(splash.backgroundColor).toBe(hexFromRole('light', 'hero'));
    expect((splash.dark as Record<string, string>).backgroundColor).toBe(hexFromRole('dark', 'hero'));
  });

  it('points every icon at a committed asset', async () => {
    const config = await store();
    expect(config.icon).toBe('./assets/icon.png');
    expect(config.android?.adaptiveIcon?.foregroundImage).toBe('./assets/adaptive-icon.png');
    expect(pluginOptions(config, 'expo-notifications').icon).toBe('./assets/notification-icon.png');
    expect(pluginOptions(config, 'expo-splash-screen').image).toBe('./assets/splash-icon.png');
  });
});

describe('app.config.ts — expo-location is gone (D-PR6)', () => {
  it('is not in the plugin list', async () => {
    expect(pluginNames(await store())).not.toContain('expo-location');
    expect(pluginNames(await dev())).not.toContain('expo-location');
  });

  it('is not a dependency', () => {
    expect(Object.keys(packageJson.dependencies)).not.toContain('expo-location');
  });

  it('declares no location purpose string, which would be a label with nothing behind it', async () => {
    const plist = (await store()).ios?.infoPlist ?? {};
    expect(Object.keys(plist).some((key) => key.includes('Location'))).toBe(false);
  });
});

describe('withPredictiveBack (P1.3)', () => {
  const apply = (manifest: { application?: { $?: Record<string, string> }[] }) =>
    withPredictiveBack.setEnableOnBackInvokedCallback(manifest).application[0]?.$ ?? {};

  it('sets enableOnBackInvokedCallback on <application>', () => {
    expect(apply({ application: [{ $: { 'android:label': 'x' } }] })).toHaveProperty(
      'android:enableOnBackInvokedCallback',
      'true',
    );
  });

  it('leaves the attributes that were already there', () => {
    const attributes = apply({
      application: [{ $: { 'android:label': 'x', 'android:icon': 'y' } }],
    });
    expect(attributes['android:label']).toBe('x');
    expect(attributes['android:icon']).toBe('y');
  });

  it('is idempotent, because prebuild runs plugins more than once', () => {
    const once = withPredictiveBack.setEnableOnBackInvokedCallback({ application: [{ $: {} }] });
    expect(apply(once)).toEqual({ 'android:enableOnBackInvokedCallback': 'true' });
  });

  it('throws on a manifest with no <application> rather than silently doing nothing', () => {
    // A plugin that quietly no-ops is the failure mode this whole step exists to avoid: the
    // attribute would simply be absent and every test that did not look at the manifest would pass.
    expect(() => withPredictiveBack.setEnableOnBackInvokedCallback({})).toThrow(/<application>/);
  });

  it('is registered in the plugin list', async () => {
    expect(pluginNames(await store())).toContain('./plugins/withPredictiveBack.js');
  });
});
