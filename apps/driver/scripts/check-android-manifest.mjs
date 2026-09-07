#!/usr/bin/env node
/**
 * Assert the MERGED Android manifest is the one this app meant to ship (DIRECTION-B-PLAN §6 P1.6).
 *
 * WHY THE MERGED ONE. `app.config.ts` does not declare the manifest; it makes REQUESTS of the
 * manifest merger. `blockedPermissions` emits `tools:node="remove"`, which is a request that a
 * library's `<uses-permission>` be dropped — and the answer is only visible after AGP has merged
 * every dependency's manifest into ours. Measured on 2026-09-07, our five declared permissions
 * become THIRTY-THREE in the merged output (notification badges, biometrics, wifi state, FCM), so
 * "what app.config.ts says" and "what Play lists" are different documents and only the second one
 * is evidence.
 *
 * The three things it checks are the three that fail silently:
 *   1. Every blocked permission is absent. A MapLibre bump that starts declaring location a second
 *      way is a Data Safety declaration we cannot justify, and nothing else would notice.
 *   2. `android:enableOnBackInvokedCallback="true"`. A config plugin that stops applying looks
 *      exactly like one that works (P1.3).
 *   3. `targetSdkVersion` is 36. Play refuses new apps and updates below it from 2026-08-31, and an
 *      RN or Expo bump moves this without asking.
 *
 *   node scripts/check-android-manifest.mjs <merged AndroidManifest.xml>
 */
import { existsSync, readFileSync } from 'node:fs';

/** Kept in step with app.config.ts's `blockedPermissions` by the test that reads both. */
export const MUST_BE_ABSENT = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.RECORD_AUDIO',
];

/** Kept in step with app.config.ts's `permissions` by the same test. */
export const MUST_BE_PRESENT = [
  'android.permission.CAMERA',
  'android.permission.INTERNET',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_NETWORK_STATE',
];

export const REQUIRED_TARGET_SDK = 36;

/** Every `<uses-permission android:name="…">` in the document, de-duplicated and sorted. A regex
 *  rather than an XML parse because that is all this reads and a dependency-free script runs in any
 *  job; the shapes it could get wrong (an attribute order swap, a `<permission>` element) are
 *  covered in tests/android-manifest.test.ts. */
export function permissionsIn(xml) {
  const names = new Set();
  for (const element of xml.matchAll(/<uses-permission[^>]*>/g)) {
    const name = element[0].match(/android:name\s*=\s*"([^"]+)"/);
    if (name) names.add(name[1]);
  }
  return [...names].sort();
}

/** `null` when the document declares no `<uses-sdk>` at all, which is itself a finding. */
export function targetSdkIn(xml) {
  const element = xml.match(/<uses-sdk[\s\S]*?>/);
  if (!element) return null;
  const value = element[0].match(/android:targetSdkVersion\s*=\s*"(\d+)"/);
  return value ? Number(value[1]) : null;
}

export function hasPredictiveBack(xml) {
  const application = xml.match(/<application[\s\S]*?>/);
  if (!application) return false;
  return /android:enableOnBackInvokedCallback\s*=\s*"true"/.test(application[0]);
}

/** @returns {string[]} one line per problem; empty means the manifest is what was intended. */
export function auditManifest(xml) {
  const problems = [];
  const permissions = permissionsIn(xml);

  for (const permission of MUST_BE_ABSENT) {
    if (permissions.includes(permission)) {
      problems.push(
        `${permission} survived the merge — a dependency declares it and blockedPermissions did not remove it`,
      );
    }
  }
  for (const permission of MUST_BE_PRESENT) {
    if (!permissions.includes(permission)) {
      problems.push(`${permission} is declared in app.config.ts but is missing from the merge`);
    }
  }

  if (!hasPredictiveBack(xml)) {
    problems.push(
      'android:enableOnBackInvokedCallback="true" is not on <application> — withPredictiveBack did not apply',
    );
  }

  const targetSdk = targetSdkIn(xml);
  if (targetSdk === null) {
    problems.push('the merged manifest declares no targetSdkVersion');
  } else if (targetSdk !== REQUIRED_TARGET_SDK) {
    problems.push(
      `targetSdkVersion is ${targetSdk}, not ${REQUIRED_TARGET_SDK} — Play refuses new apps and updates below ${REQUIRED_TARGET_SDK}`,
    );
  }

  return problems;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-android-manifest.mjs <merged AndroidManifest.xml>');
    process.exit(2);
  }
  if (!existsSync(path)) {
    console.error(`::error::${path} does not exist — did :app:processReleaseManifest run?`);
    process.exit(2);
  }

  const xml = readFileSync(path, 'utf8');
  const permissions = permissionsIn(xml);
  const problems = auditManifest(xml);

  console.log(`${path}`);
  console.log(`  targetSdkVersion ${targetSdkIn(xml)}`);
  console.log(`  predictive back  ${hasPredictiveBack(xml)}`);
  console.log(`  ${permissions.length} permissions after the merge:`);
  for (const permission of permissions) console.log(`    ${permission}`);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log('\nThe merged manifest is what app.config.ts asked for.');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
