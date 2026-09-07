import { describe, expect, it } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import {
  auditManifest,
  hasPredictiveBack,
  MUST_BE_ABSENT,
  MUST_BE_PRESENT,
  permissionsIn,
  REQUIRED_TARGET_SDK,
  targetSdkIn,
} from '../scripts/check-android-manifest.mjs';

/**
 * The merged-manifest audit is what CI runs after `:app:processReleaseManifest` (§6 P1.6). Its
 * inputs in CI are real; here they are hand-written, because the cases worth pinning are the ones a
 * real build does not currently produce — a location permission that survived the merge, a config
 * plugin that stopped applying, an SDK level that moved under an Expo bump.
 */

/** A merged manifest reduced to the parts the audit reads, in AGP's own layout (attributes on
 *  their own lines), taken from the real output of `:app:processReleaseManifest` on 2026-09-07. */
function manifest({
  permissions = MUST_BE_PRESENT,
  targetSdk = REQUIRED_TARGET_SDK,
  predictiveBack = true,
}: {
  permissions?: string[];
  targetSdk?: number | null;
  predictiveBack?: boolean;
} = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.silvicom.fuelguard.driver" >
${targetSdk === null ? '' : `    <uses-sdk\n        android:minSdkVersion="24"\n        android:targetSdkVersion="${targetSdk}" />`}
${permissions.map((p) => `    <uses-permission android:name="${p}" />`).join('\n')}
    <application
        android:name="com.silvicom.fuelguard.driver.MainApplication"
        android:allowBackup="false"${predictiveBack ? '\n        android:enableOnBackInvokedCallback="true"' : ''}
        android:label="@string/app_name" >
    </application>
</manifest>`;
}

describe('permissionsIn', () => {
  it('collects every declared permission', () => {
    expect(permissionsIn(manifest())).toEqual([...MUST_BE_PRESENT].sort());
  });

  it('de-duplicates a permission two libraries both declare', () => {
    const xml = manifest({ permissions: ['android.permission.CAMERA', 'android.permission.CAMERA'] });
    expect(permissionsIn(xml)).toEqual(['android.permission.CAMERA']);
  });

  it('reads a name that is not the first attribute', () => {
    const xml = '<uses-permission android:maxSdkVersion="32" android:name="android.permission.X" />';
    expect(permissionsIn(xml)).toEqual(['android.permission.X']);
  });

  it('does not mistake a <permission> definition for a <uses-permission>', () => {
    // Every Expo app defines com.<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION as a
    // <permission>; counting definitions as requests would make the list wrong by one every build.
    const xml = '<permission android:name="com.x.DEFINED" /><uses-permission android:name="a.b.C" />';
    expect(permissionsIn(xml)).toEqual(['a.b.C']);
  });

  it('finds nothing in a manifest that declares nothing', () => {
    expect(permissionsIn(manifest({ permissions: [] }))).toEqual([]);
  });
});

describe('targetSdkIn', () => {
  it('reads the level out of a multi-line <uses-sdk>', () => {
    expect(targetSdkIn(manifest())).toBe(36);
  });

  it('returns null when there is no <uses-sdk> at all', () => {
    expect(targetSdkIn(manifest({ targetSdk: null }))).toBe(null);
  });

  it('returns null when <uses-sdk> declares only a minimum', () => {
    expect(targetSdkIn('<uses-sdk android:minSdkVersion="24" />')).toBe(null);
  });

  it('does not read minSdkVersion by mistake', () => {
    expect(targetSdkIn('<uses-sdk\n android:minSdkVersion="24"\n android:targetSdkVersion="36" />')).toBe(36);
  });
});

describe('hasPredictiveBack', () => {
  it('sees the attribute on a multi-line <application>', () => {
    expect(hasPredictiveBack(manifest())).toBe(true);
  });

  it('is false when the plugin did not apply', () => {
    expect(hasPredictiveBack(manifest({ predictiveBack: false }))).toBe(false);
  });

  it('is false when the attribute says false', () => {
    expect(hasPredictiveBack('<application android:enableOnBackInvokedCallback="false" >')).toBe(
      false,
    );
  });

  it('does not accept the attribute somewhere other than <application>', () => {
    // On an <activity> it applies to that activity alone, which is not what P1.3 asked for.
    expect(
      hasPredictiveBack(
        '<application android:label="x" ></application>\n<activity android:enableOnBackInvokedCallback="true" />',
      ),
    ).toBe(false);
  });
});

describe('auditManifest', () => {
  it('passes a manifest that is what app.config.ts asked for', () => {
    expect(auditManifest(manifest())).toEqual([]);
  });

  it('passes when extra permissions merged in from libraries', () => {
    // Thirty-three permissions survive the real merge; only the six blocked ones are findings.
    expect(
      auditManifest(
        manifest({
          permissions: [
            ...MUST_BE_PRESENT,
            'android.permission.USE_BIOMETRIC',
            'android.permission.WAKE_LOCK',
            'com.sec.android.provider.badge.permission.WRITE',
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reports each blocked permission that survived the merge', () => {
    const problems = auditManifest(
      manifest({
        permissions: [
          ...MUST_BE_PRESENT,
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.RECORD_AUDIO',
        ],
      }),
    );
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('ACCESS_FINE_LOCATION');
    expect(problems.join('\n')).toContain('RECORD_AUDIO');
  });

  it('reports a declared permission that vanished', () => {
    const problems = auditManifest(
      manifest({ permissions: MUST_BE_PRESENT.filter((p) => !p.endsWith('CAMERA')) }),
    );
    expect(problems.join('\n')).toMatch(/CAMERA.*missing from the merge/);
  });

  it('reports a config plugin that stopped applying', () => {
    expect(auditManifest(manifest({ predictiveBack: false })).join('\n')).toMatch(
      /enableOnBackInvokedCallback/,
    );
  });

  it('reports an SDK level that moved under an upgrade', () => {
    expect(auditManifest(manifest({ targetSdk: 35 })).join('\n')).toMatch(
      /targetSdkVersion is 35, not 36/,
    );
  });

  it('reports a manifest with no targetSdkVersion rather than treating it as fine', () => {
    expect(auditManifest(manifest({ targetSdk: null })).join('\n')).toMatch(
      /declares no targetSdkVersion/,
    );
  });

  it('reports every problem at once, so one CI run names them all', () => {
    expect(
      auditManifest(
        manifest({
          permissions: ['android.permission.ACCESS_FINE_LOCATION'],
          targetSdk: 34,
          predictiveBack: false,
        }),
      ),
    ).toHaveLength(1 + MUST_BE_PRESENT.length + 1 + 1);
  });
});

describe('the audit’s permission lists match app.config.ts', () => {
  // Two lists of the same thing is the copy-with-a-delay-fuse the root CLAUDE.md warns about. It is
  // unavoidable here — the script must run with no TypeScript and no Expo — so this is the check
  // that keeps them equal instead.
  it('blocks exactly what app.config.ts blocks', async () => {
    process.env.APP_VARIANT = 'store';
    const config: ExpoConfig = (await import('../app.config')).default;
    expect([...MUST_BE_ABSENT].sort()).toEqual([...(config.android?.blockedPermissions ?? [])].sort());
  });

  it('requires exactly what app.config.ts declares', async () => {
    process.env.APP_VARIANT = 'store';
    const config: ExpoConfig = (await import('../app.config')).default;
    expect([...MUST_BE_PRESENT].sort()).toEqual([...(config.android?.permissions ?? [])].sort());
  });
});
