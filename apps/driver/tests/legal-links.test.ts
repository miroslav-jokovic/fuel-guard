import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app's About rows and the web app's legal routes have to name the same three paths
 * (DIRECTION-B-PLAN §6 P3.2).
 *
 * ── WHAT BREAKS WITHOUT THIS, AND WHY NOTHING ELSE WOULD CATCH IT ──────────────────────────────
 * `src/lib/legalLinks.ts` builds `<api base>/privacy` and hands it to the phone's browser. The route
 * that answers it lives in another app, in another framework, with its own router — so renaming the
 * web route to `/legal/privacy` compiles, type-checks, passes every gate in both packages, and turns
 * three rows in the driver's More tab into 404s. Nobody would notice until a store reviewer followed
 * the link, because a driver who taps Privacy and gets a Not Found page tells their dispatcher, and
 * their dispatcher has no way to report it.
 *
 * ⚠ This reads both files as TEXT rather than importing them. The driver's module imports
 * `react-native`'s `Linking` and the web's is a vue-router table; neither loads in this runner
 * (vitest.config.ts: "pure logic tests only"). Reading the source is what makes a cross-app
 * assertion possible at all, and it is the same technique `native-config.test.ts` and
 * `android-manifest.test.ts` already use for facts that live outside TypeScript's reach.
 *
 * Proven to fail by changing the driver's `privacy: '/privacy'` to `'/legal/privacy'`: the run
 * reported `['/legal/privacy', …]` against the web's `['/privacy', …]`. ⚠ Both path patterns allow
 * `/` inside the match for that reason — an earlier `[a-z-]+` could not match a two-segment path, so
 * a rename DISAPPEARED from the set instead of showing up as a mismatch. The test still failed, on
 * the length assertion, but the message named the wrong problem.
 */

const REPO = join(import.meta.dirname, '..', '..', '..');
const DRIVER_LINKS = join(REPO, 'apps/driver/src/lib/legalLinks.ts');
const WEB_ROUTES = join(REPO, 'apps/web/src/router/routes/legal.ts');

/** `privacy: '/privacy',` → `/privacy`. Only the LEGAL_PATHS map has this shape in that file. */
function driverPaths(): string[] {
  const source = readFileSync(DRIVER_LINKS, 'utf8');
  const map = /const LEGAL_PATHS = \{([\s\S]*?)\} as const;/.exec(source)?.[1];
  if (!map) throw new Error('legalLinks.ts no longer declares a LEGAL_PATHS object literal');
  return [...map.matchAll(/'(\/[a-z/-]+)'/g)].map((m) => m[1]!).sort();
}

/** `path: "/privacy",` → `/privacy`, from the web route records. */
function webPaths(): string[] {
  const source = readFileSync(WEB_ROUTES, 'utf8');
  return [...source.matchAll(/^\s*path:\s*"(\/[a-z/-]+)"/gm)].map((m) => m[1]!).sort();
}

describe('the driver app links to legal pages that exist', () => {
  it('names the same three paths the web app routes', () => {
    const fromDriver = driverPaths();
    expect(fromDriver).toEqual(['/privacy', '/support', '/terms']);
    expect(webPaths()).toEqual(fromDriver);
  });

  /**
   * Both extractors must actually find something. A regex that silently matches nothing would make
   * the assertion above compare two empty arrays and pass — the failure mode these fitness functions
   * are most prone to, and the reason the counts are asserted rather than assumed.
   */
  it('reads real declarations from both files, not empty matches', () => {
    expect(driverPaths()).toHaveLength(3);
    expect(webPaths()).toHaveLength(3);
  });

  /**
   * The URL is built by concatenation onto `env.apiUrl`, which strips its own trailing slash. A path
   * that forgot its leading slash would produce `https://hostprivacy` — a valid string, an invalid
   * URL, and one no type would reject.
   */
  it('every path is absolute, so concatenation onto the API base cannot fuse two segments', () => {
    for (const p of driverPaths()) expect(p.startsWith('/')).toBe(true);
  });
});
