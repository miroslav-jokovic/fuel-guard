#!/usr/bin/env node
/**
 * Print the fingerprint of this app's NATIVE side — the hash CI uses to decide whether a change can
 * ship over the air or needs a new APK (ship-pipeline plan D2.4).
 *
 * It is deliberately NOT used as the `runtimeVersion`. In a pnpm workspace the same commit can
 * fingerprint differently between a laptop and a `--frozen-lockfile` CI install, and as a runtime
 * version that difference means updates silently never arrive. As a CI-to-CI comparison — this run
 * against the run that built the installed APK, both on the same runner image — it is exactly the
 * signal we want, and a mismatch is loud.
 *
 * Run from apps/driver:  node scripts/native-fingerprint.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @expo/fingerprint is a transitive dependency of expo; pnpm's strict layout may not expose it at
 *  the top level, so fall back to resolving it through expo's own resolution paths. */
function loadFingerprint() {
  try {
    return require('@expo/fingerprint');
  } catch {
    return require(
      require.resolve('@expo/fingerprint', { paths: [require.resolve('expo/package.json')] }),
    );
  }
}

const { createFingerprintAsync } = loadFingerprint();
const { hash } = await createFingerprintAsync(process.cwd());
process.stdout.write(hash);
