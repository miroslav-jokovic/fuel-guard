import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `eas.json` decides what a store build IS (DIRECTION-B-PLAN §6 P2.1). Nothing else reads it, no
 * type checks it, and the first feedback on a mistake would be a rejected upload or — worse — an
 * accepted one that carries the dev launcher or talks to the wrong API.
 *
 * Two things make it worth a test rather than a read-through:
 *
 * 1. **EAS validates it against a CLOSED schema.** An unknown key is not a warning, it is
 *    "eas.json is not valid" and no build at all — `$schema` itself is rejected. So the file cannot
 *    carry its own comments (they live in apps/driver/EAS.md) and it must stay strictly valid JSON
 *    with only known keys.
 * 2. **`APP_VARIANT=store` is the hinge.** tests/native-config.test.ts asserts what that variable
 *    DOES — drops expo-dev-client, flips APNs to production, closes local networking. This asserts
 *    that the production profile actually sets it. Neither half is worth much alone.
 */

const ROOT = join(import.meta.dirname, '..');

interface EasJson {
  cli: { version: string; appVersionSource: string };
  build: Record<
    string,
    {
      environment?: string;
      distribution?: string;
      developmentClient?: boolean;
      autoIncrement?: boolean;
      env?: Record<string, string>;
      android?: { buildType?: string };
      ios?: { image?: string };
    }
  >;
  submit: Record<
    string,
    {
      android?: { serviceAccountKeyPath?: string; track?: string; releaseStatus?: string };
      ios?: { ascAppId?: string; appleTeamId?: string };
    }
  >;
}

const raw = readFileSync(join(ROOT, 'eas.json'), 'utf8');
const eas = JSON.parse(raw) as EasJson;

/** Values P2.3 fills in from App Store Connect and the GitHub environment. Written as `<...>` so
 *  they are impossible to mistake for real ones. */
const PLACEHOLDER = /^<.*>$/;

describe('eas.json is a file EAS will accept', () => {
  it('is strictly valid JSON', () => {
    expect(() => {
      JSON.parse(raw);
    }).not.toThrow();
  });

  it('carries no comment keys, which EAS rejects outright', () => {
    // A "//" key here does not degrade to a warning: eas-cli refuses the whole file, and every
    // build stops. This is why the commentary lives in EAS.md.
    // Every key at every depth, collected with a reviver rather than by walking the parsed object,
    // so a comment key nested inside a build profile is caught too.
    const keys: string[] = [];
    JSON.parse(raw, (key: string, value: unknown): unknown => {
      if (key) keys.push(key);
      return value;
    });
    expect(keys.filter((k) => k.startsWith('//'))).toEqual([]);
    expect(keys).not.toContain('$schema');
  });

  it('pins a CLI version that understands these fields', () => {
    expect(eas.cli.version).toMatch(/^>=\s*\d+/);
  });
});

/**
 * EAS owns the build counter (D-PR2 as amended by Q-PR9, 2026-09-08).
 *
 * This block asserted `local` until 2026-09-08, reasoning that "app.config.ts derives both build
 * numbers from the CI run number, and a second counter for a monotonic value disagrees the first
 * time a build runs anywhere else". The reasoning was sound and its PREMISE was false: builds do run
 * somewhere else, and only somewhere else. `driver-store.yml` — the only place `IOS_BUILD_NUMBER` is
 * ever set — has never executed a single time (its one run ended `action_required` in 2 seconds,
 * measured 2026-09-08), while two production builds were cut from a laptop and both carried
 * `buildNumber: 1`, because the fallback is `1`. App Store Connect refuses a `CFBundleVersion` it
 * has already accepted, so the second upload of that pair would have been rejected.
 *
 * `remote` restores the property `local` was chosen FOR — a counter that cannot go backwards and
 * cannot be forgotten — and takes it out of the hands of whoever is running the build.
 */
describe('EAS owns the build counter (D-PR2, amended by Q-PR9)', () => {
  it('sets appVersionSource to remote, so a laptop build cannot reuse a build number', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('auto-increments on the production profile and nowhere else', () => {
    // A preview or development build that consumed a store build number would burn a value App
    // Store Connect can then never accept, for a binary that was never going to be uploaded.
    expect(eas.build.production?.autoIncrement).toBe(true);
    expect(eas.build.development?.autoIncrement).toBeUndefined();
    expect(eas.build.preview?.autoIncrement).toBeUndefined();
  });
});

describe('the production profile is a store build (D-PR3, D-PR10)', () => {
  const production = eas.build.production;

  it('exists alongside development and preview', () => {
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'preview', 'production']);
  });

  it('gives every profile an environment matching its own name', () => {
    // A profile pointed at the wrong environment is the quiet version of the same failure: a
    // preview build carrying production URLs, or a store build carrying a laptop's.
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.environment).toBe(name);
    }
  });

  it('sets APP_VARIANT=store — the variable native-config.test.ts asserts the effects of', () => {
    expect(production?.env?.APP_VARIANT).toBe('store');
  });

  it('declares APP_VARIANT and NOTHING else inline', () => {
    // Everything else a build needs lives in an EAS environment (owner ruling 2026-09-07): the
    // Supabase publishable key is a JWT, and a JWT in a tracked file is what gitleaks and
    // scripts/scan-secrets.mjs exist to stop — however genuinely public that particular key is.
    // APP_VARIANT stays because it is a decision about what kind of build this is, not a lookup.
    for (const profile of Object.values(eas.build)) {
      expect(Object.keys(profile.env ?? {})).toEqual(['APP_VARIANT']);
    }
  });

  it('is the ONLY profile that does', () => {
    // A preview or development build that identified as a store build would ship without the dev
    // launcher and with production APNs — silently useless to the person testing it.
    expect(eas.build.development?.env?.APP_VARIANT).toBe('development');
    expect(eas.build.preview?.env?.APP_VARIANT).toBe('preview');
  });

  it('builds an App Bundle, because Play will not take an APK', () => {
    expect(production?.android?.buildType).toBe('app-bundle');
  });

  it('leaves the preview profile on an APK, which is what a tester installs by hand', () => {
    expect(eas.build.preview?.android?.buildType).toBe('apk');
  });

  it('asks for the newest macOS image, which is what carries Xcode 26', () => {
    expect(production?.ios?.image).toBe('latest');
  });

  it('distributes to the store rather than internally', () => {
    expect(production?.distribution).toBe('store');
    expect(eas.build.preview?.distribution).toBe('internal');
  });

  it('names an EAS environment, which is where the build-time values come from', () => {
    // Without this the profile silently gets no variables at all and the bundle is built against
    // undefined URLs — an app that installs, opens, and can reach nothing.
    expect(production?.environment).toBe('production');
  });

  it('keeps the dev client on the development profile only', () => {
    expect(eas.build.development?.developmentClient).toBe(true);
    expect(production?.developmentClient).toBeUndefined();
  });
});

describe('no credential is committed', () => {
  it('holds no key material, only paths and identifiers', () => {
    // A Play service-account JSON or an ASC .p8 in the repository is a leak that gitleaks would
    // catch on the way in; this catches the shape of it before that.
    expect(raw).not.toMatch(/-----BEGIN/);
    expect(raw).not.toMatch(/"private_key"/);
    expect(raw).not.toMatch(/"client_email"/);
  });

  it('names the service-account key by path, resolved from an EAS secret at submit time', () => {
    expect(eas.submit.production?.android?.serviceAccountKeyPath).toMatch(/\.json$/);
  });
});

describe('a submission lands somewhere a human still has to promote it (P8)', () => {
  it('puts Android on the internal track as a draft', () => {
    expect(eas.submit.production?.android?.track).toBe('internal');
    expect(eas.submit.production?.android?.releaseStatus).toBe('draft');
  });

  it('never submits straight to production', () => {
    expect(eas.submit.production?.android?.track).not.toBe('production');
  });
});

describe('what P2.3 still has to fill in', () => {
  const placeholders = [
    ['ascAppId', eas.submit.production?.ios?.ascAppId ?? ''],
    ['appleTeamId', eas.submit.production?.ios?.appleTeamId ?? ''],
  ].filter(([, value]) => PLACEHOLDER.test(String(value)));

  it('reports the outstanding values rather than failing on them', () => {
    // Deliberately NOT a failure. Until the owner's one-time setup, placeholders are the correct
    // state of this file — a test that went red on them would be red for weeks and would be muted.
    // What it must not do is let one hide: a real value that looks like `<...>` is impossible.
    if (placeholders.length > 0) {
      console.info(
        `eas.json still has ${placeholders.length} placeholder(s) for P2.3: ` +
          placeholders.map(([key]) => key).join(', '),
      );
    }
    expect(placeholders.every(([, value]) => PLACEHOLDER.test(String(value)))).toBe(true);
  });

  it('has no half-filled value — a placeholder is either the whole string or absent', () => {
    // "<prod api url>/api" would pass a "contains <" check and fail at build time. Any angle bracket
    // anywhere must belong to a value that is ENTIRELY a placeholder.
    const values = [
      ...Object.values(eas.build.production?.env ?? {}),
      eas.submit.production?.ios?.ascAppId ?? '',
      eas.submit.production?.ios?.appleTeamId ?? '',
    ].map(String);

    for (const value of values) {
      if (value.includes('<') || value.includes('>')) expect(value).toMatch(PLACEHOLDER);
    }
  });

  it('never leaves APP_VARIANT itself as a placeholder', () => {
    // The one env value that is a decision rather than an environment lookup.
    expect(PLACEHOLDER.test(eas.build.production?.env?.APP_VARIANT ?? '')).toBe(false);
  });
});
