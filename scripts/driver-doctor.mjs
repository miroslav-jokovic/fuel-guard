#!/usr/bin/env node
/**
 * driver-doctor — the preflight for "why is the driver app stuck on build?"
 *
 * Every check here corresponds to something that has actually cost this project a build. The failure
 * mode they share is that none of them produce an error: Expo bundles the wrong project, or Metro
 * crawls a gigabyte of CocoaPods headers, or the bundle is built against contracts from an hour ago —
 * and all you see is a progress bar that never moves.
 *
 * Run:  pnpm driver:doctor
 * Exit: 0 clean (warnings allowed), 1 at least one blocking problem.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const driver = path.join(root, 'apps/driver');
const shared = path.join(root, 'packages/shared');

const problems = [];
const warnings = [];
const fail = (title, detail, fix) => problems.push({ title, detail, fix });
const warn = (title, detail, fix) => warnings.push({ title, detail, fix });

// `--building` = invoked from the `ios`/`android` scripts, which are about to run prebuild + pod
// install. In that context an out-of-date dev client (check 11) is EXPECTED and about to be fixed, so
// it is a warning there, not a blocker. For `start`/`start:usb` (Metro only, no rebuild) it stays a fail.
const BUILDING = process.argv.includes('--building');

const exists = (p) => fs.existsSync(p);
const mtime = (p) => fs.statSync(p).mtimeMs;

// Runtime config is baked into the Expo bundle when Metro starts. A stale private-LAN API address
// is especially confusing on iOS: the app loads normally, but every login ends in an opaque native
// "Could not connect to the server" fetch error.
const driverEnvPath = path.join(driver, '.env');
if (exists(driverEnvPath)) {
  const envText = fs.readFileSync(driverEnvPath, 'utf8');
  const apiUrlValue = envText.match(/^EXPO_PUBLIC_API_URL\s*=\s*(.+?)\s*$/m)?.[1];
  if (apiUrlValue) {
    try {
      const apiUrl = new URL(apiUrlValue.replace(/^['"]|['"]$/g, ''));
      const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(apiUrl.hostname);
      const localIpv4 = Object.values(os.networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry.address);
      if (privateIp && !localIpv4.includes(apiUrl.hostname)) {
        fail(
          'The driver API URL is a stale LAN address',
          `${apiUrl.hostname} is configured in apps/driver/.env, but this Mac currently has ${localIpv4.join(', ') || 'no LAN IPv4 address'}. A physical iPhone cannot connect to the configured host.`,
          `Set EXPO_PUBLIC_API_URL=http://${localIpv4[0] ?? '<this-mac-lan-ip>'}:${apiUrl.port || '8080'}, then restart Metro so Expo rebundles the config.`,
        );
      }
    } catch {
      fail(
        'EXPO_PUBLIC_API_URL is invalid',
        `apps/driver/.env contains ${apiUrlValue}.`,
        'Set it to a complete URL such as http://192.168.1.20:8080.',
      );
    }
  }
}

// 1 ─ A second Expo project at the workspace root.
// `expo prebuild` / `expo run:ios` run from the repo root instead of apps/driver writes app.json,
// ios/, android/ and .expo/ HERE. The result is a second, half-configured app (com.anonymous.*) that
// pod-installs against the hoisted root node_modules and builds forever. Everything below is
// gitignored, so it survives every branch switch and nothing ever flags it.
const strays = ['app.json', 'ios', 'android', '.expo', 'tsconfig.json'].filter((f) => exists(path.join(root, f)));
if (strays.length) {
  fail(
    'A stray Expo project exists at the workspace root',
    `Found at the repo root: ${strays.join(', ')}. The real native projects are apps/driver/ios and apps/driver/android.`,
    'Move them aside, then always run Expo from apps/driver (pnpm driver:start / driver:ios / driver:android).',
  );
}

// 2 ─ The shared package's React Native build.
// metro.config.js resolves @fuelguard/shared to packages/shared/dist/index.js, so a missing dist is a
// resolution failure and a stale one is worse: it bundles cleanly against yesterday's contracts.
const sharedEntry = path.join(shared, 'dist/index.js');
if (!exists(sharedEntry)) {
  fail(
    '@fuelguard/shared has not been built for React Native',
    `Missing ${path.relative(root, sharedEntry)}.`,
    'pnpm --filter @fuelguard/shared build:rn',
  );
} else {
  const newest = (dir) => {
    let newestMs = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) newestMs = Math.max(newestMs, newest(full));
      else if (entry.name.endsWith('.ts')) newestMs = Math.max(newestMs, mtime(full));
    }
    return newestMs;
  };
  const src = newest(path.join(shared, 'src'));
  if (src > mtime(sharedEntry)) {
    const minutes = Math.round((src - mtime(sharedEntry)) / 60000);
    fail(
      'packages/shared/dist is stale',
      `Source is ${minutes} minute(s) newer than the build. The driver bundle would use the old contracts.`,
      'pnpm --filter @fuelguard/shared build:rn',
    );
  }
}

// 3 ─ Cloud-sync conflict copies.
// A repo inside an iCloud Drive / Dropbox / OneDrive / Google Drive folder gets " 2", " 3" copies
// whenever the sync daemon races a build. In source they are haste collisions; in .git they corrupt
// the index; in ios/ they make CocoaPods read a Podfile you did not write.
const CONFLICT = / \d+(\.[A-Za-z0-9]+)*$/;
const SKIP = new Set(['node_modules', '.pnpm-store', 'dist', 'build', 'Pods', 'TemplatesTailwind', '_to_delete', 'coverage', '.next']);
const conflicts = [];
const scan = (dir, depth = 0) => {
  if (depth > 6 || conflicts.length > 40) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (CONFLICT.test(entry.name)) conflicts.push(path.relative(root, full));
    if (entry.isDirectory()) scan(full, depth + 1);
  }
};
scan(root);
if (conflicts.length) {
  fail(
    'Cloud-sync conflict copies are present',
    `${conflicts.length} file(s), e.g. ${conflicts.slice(0, 5).join(', ')}`,
    'Move them out of the tree. If they keep coming back, the repo is inside a synced folder — see check 5.',
  );
}

// 4 ─ Stale git locks.
// Symptom of the same thing: a sync daemon (or a filesystem that cannot unlink) leaves index.lock
// behind, and then every commit fails with "Unable to create index.lock: File exists".
const locks = ['index.lock', 'HEAD.lock', 'config.lock'].filter((f) => exists(path.join(root, '.git', f)));
if (locks.length) {
  fail('Stale git lock file(s)', `.git/${locks.join(', .git/')}`, 'Remove them once no git process is running.');
}

// 5 ─ Is the repo inside a synced folder at all? This is the cause, not a symptom.
// A build writes tens of thousands of files a minute; a sync daemon that is trying to upload each one
// will stall the build and lose races. Nothing in the repo can fix this — the checkout has to move.
const realRoot = fs.realpathSync(root);
// "Desktop & Documents" only counts when iCloud is actually mirroring them — plenty of people keep a
// repo in ~/Documents with syncing off, and a false alarm here would teach you to ignore the tool.
const icloudMirrors =
  process.env.HOME && exists(path.join(process.env.HOME, 'Library/Mobile Documents/com~apple~CloudDocs/Documents'));
const SYNCED = [
  ['iCloud Drive', /Library\/Mobile Documents|com~apple~CloudDocs/, true],
  ['iCloud Desktop & Documents', /^\/Users\/[^/]+\/(Documents|Desktop)\//, Boolean(icloudMirrors) || conflicts.length > 0],
  ['Dropbox', /\/Dropbox\//, true],
  ['OneDrive', /\/OneDrive/, true],
  ['Google Drive', /\/Google Drive|CloudStorage\/GoogleDrive/, true],
];
for (const [name, re, corroborated] of SYNCED) {
  if (corroborated && re.test(`${realRoot}/`)) {
    warn(
      `The checkout is inside a ${name} folder`,
      realRoot,
      'Move the repo somewhere unsynced (e.g. ~/Projects/FuelGuard) and reinstall. This is the root cause of checks 3 and 4.',
    );
    break;
  }
}

// 6 ─ pnpm's linker. React Native's Metro cannot follow pnpm's default symlinked store.
const npmrc = path.join(root, '.npmrc');
if (!exists(npmrc) || !fs.readFileSync(npmrc, 'utf8').includes('node-linker=hoisted')) {
  fail('.npmrc is missing node-linker=hoisted', 'Metro cannot resolve through pnpm’s symlinked store (plan D8).', 'Add node-linker=hoisted to .npmrc and reinstall.');
}

// 7 ─ Native output size, purely informational: it is what Metro used to crawl.
const dirSize = (p) => {
  let bytes = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* raced with a build */
        }
      }
    }
  };
  walk(p);
  return bytes;
};

// 8 ─ watchman.
// React Native treats watchman as required on macOS and it is the difference between a warm start and
// a cold full-tree walk: without it metro-file-map falls back to its own Node crawler, which has no
// persistent cache and re-walks everything on every boot. On a tree this size that is the whole hang.
if (process.platform === 'darwin') {
  const which = spawnSync('which', ['watchman'], { encoding: 'utf8' });
  if (which.status !== 0) {
    fail(
      'watchman is not installed',
      'Metro falls back to its own Node file crawler, which re-walks the whole tree on every start with no cache.',
      'brew install watchman',
    );
  } else if (!exists(path.join(root, '.watchmanconfig'))) {
    warn(
      'No .watchmanconfig at the workspace root',
      'watchman will watch directories Metro never reads (native build output, docs, other apps).',
      'Restore .watchmanconfig from git — it lists the ignore_dirs.',
    );
  }
}

// 9 ─ Dataless (evicted) files ON THE BUNDLE PATH.
// The failure here is a true hang, not a slowdown: with "Optimize Mac Storage" on, iCloud evicts a
// file's contents and leaves a stub, and reading one BLOCKS until it downloads. Metro reads every
// module it bundles, so an evicted file inside node_modules stalls the bundler mid-progress —
// at a DIFFERENT percentage each run, which is how you tell it apart from a bad module (same
// percentage every time). Scoped to the paths Metro actually reads; an evicted file in _to_delete
// harms nothing.
if (process.platform === 'darwin') {
  const scopes = ['node_modules', 'apps/driver', 'packages/shared']
    .map((d) => path.join(realRoot, d))
    .filter(exists);
  const dataless = [];
  for (const scope of scopes) {
    const found = spawnSync(
      'sh',
      ['-c', `find ${JSON.stringify(scope)} -flags +dataless -not -path '*/.git/*' 2>/dev/null | head -10`],
      { encoding: 'utf8', timeout: 25000 },
    );
    dataless.push(...(found.stdout ?? '').trim().split('\n').filter(Boolean));
  }
  if (dataless.length) {
    fail(
      'Files on the bundle path have been evicted to the cloud',
      `${dataless.length}+ file(s), e.g. ${dataless.slice(0, 3).map((f) => path.relative(realRoot, f)).join(', ')}. Metro will block on the first one it reads and the bundle will stall part-way.`,
      'Force them back: find node_modules apps/driver packages -type f -print0 | xargs -0 -n50 -P8 cat > /dev/null — then fix it properly by moving the checkout off the synced path.',
    );
  }
}

// 10 ─ A previous Metro still holding port 8081.
// THIS IS THE ONE. It cost a full day on 2026-07-28. When 8081 is taken, `expo start` prints
// "Port 8081 is running this app in another window" and then asks "Use port 8082 instead?" -- and
// that question comes AFTER "Starting Metro Bundler". In non-interactive mode it exits and tells
// you. In a normal terminal it is a prompt that waits forever, so what you see is a build that
// stopped on "Starting Metro Bundler" with no error, and it survives reinstalls, cache clears and
// every config change because the process holding the port is simply still running.
{
  const lsof = spawnSync('lsof', ['-ti', 'tcp:8081'], { encoding: 'utf8', timeout: 5000 });
  const pids = (lsof.stdout ?? '').trim().split('\n').filter(Boolean);
  if (pids.length) {
    fail(
      'Port 8081 is already taken',
      `pid(s) ${pids.join(', ')}. expo start will stop on "Starting Metro Bundler" waiting for an answer to "Use port 8082 instead?" that you may never see.`,
      `kill -9 ${pids.join(' ')}`,
    );
  }
}

// 11 ─ Native modules the JS imports but the installed dev client does not contain.
// THE ONE THAT COST THE SECOND DAY. A dev client is a binary: adding `expo-sqlite` to package.json
// does NOT put SQLite into the app already on the phone. Metro happily serves a bundle that imports
// it, the bundle loads, and then the app dies on `Cannot find native module 'ExpoSQLite'` — which
// reads as "Metro broke it" rather than "the binary is out of date".
//
// ios/Podfile.lock is the manifest of what the last native build actually linked, so comparing it
// against the app's own dependencies answers "is the thing on my phone current?" without touching
// the device.
{
  const lockPath = path.join(driver, 'ios/Podfile.lock');
  const pkgPath = path.join(driver, 'package.json');
  if (exists(lockPath) && exists(pkgPath)) {
    const lock = fs.readFileSync(lockPath, 'utf8');
    const deps = Object.keys(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies ?? {});

    // A package ships native iOS code iff it contains a .podspec. Skip the sync-conflict copies
    // ("RNReanimated 2.podspec") — they are not real podspecs and CocoaPods should never see them.
    const findPodspec = (dir, depth = 0) => {
      if (depth > 3) return null;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.podspec') && !/ \d+\.podspec$/.test(e.name)) {
          return e.name.replace(/\.podspec$/, '');
        }
      }
      for (const e of entries) {
        if (e.isDirectory() && !['node_modules', 'android', '.git', 'build'].includes(e.name)) {
          const hit = findPodspec(path.join(dir, e.name), depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    };

    const missing = [];
    for (const dep of deps) {
      const dir = path.join(root, 'node_modules', dep);
      if (!exists(dir)) continue;
      const pod = findPodspec(dir);
      if (!pod) continue;
      const escaped = pod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`^  - ${escaped}[ /(]`, 'm').test(lock)) missing.push(`${dep} (${pod})`);
    }

    if (missing.length) {
      const built = fs.statSync(lockPath).mtime.toISOString().slice(0, 16).replace('T', ' ');
      // In build mode the very next step (expo run:ios/android → prebuild + pod install) links these,
      // so failing here would block the fix. Warn instead. Metro-only starts keep the hard fail.
      (BUILDING ? warn : fail)(
        'The dev client on your device is out of date',
        BUILDING
          ? `Built ${built}. Not yet linked: ${missing.join(', ')}. This build runs prebuild + pod install and will link them — expected the first build after adding a native module.`
          : `Built ${built}. These are imported by the app but were NOT linked into it: ${missing.join(', ')}. The bundle will load and then die on "Cannot find native module".`,
        'pnpm --filter @fuelguard/driver ios   (or android) — this reruns prebuild + pod install and installs a fresh binary.',
      );
    }
  }
}

// 12 ─ Sync-conflict copies of .podspec files inside node_modules.
// CocoaPods and Expo autolinking scan for podspecs by pattern; a stray "RNReanimated 2.podspec" can
// be picked up as a second pod with the same target and fail the install in a way that reads like a
// dependency conflict.
{
  const stray = [];
  const scanPods = (dir, depth = 0) => {
    if (depth > 3 || stray.length > 20) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && / \d+\.podspec$/.test(e.name)) stray.push(path.relative(root, path.join(dir, e.name)));
      else if (e.isDirectory() && e.name !== 'node_modules') scanPods(path.join(dir, e.name), depth + 1);
    }
  };
  const nm = path.join(root, 'node_modules');
  if (exists(nm)) {
    for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
      if (e.isDirectory()) scanPods(path.join(nm, e.name), 1);
    }
  }
  if (stray.length) {
    fail(
      'Duplicate .podspec files in node_modules',
      `${stray.length}, e.g. ${stray.slice(0, 3).join(', ')}. CocoaPods may link the same pod twice.`,
      'Delete them, then re-run pod install.',
    );
  }
}

// 13 ─ Extended attributes on the iOS build inputs.
// Since iOS 10 / macOS Sierra, codesign refuses any file in a bundle carrying a resource fork or
// Finder info (Apple QA1940). The failure reads:
//
//     ExpoModulesJSI.framework: resource fork, Finder information, or similar detritus not allowed
//     Command PhaseScriptExecution failed with a nonzero exit code
//
// which names a framework and looks like a native build bug, so it sends you into the wrong library.
// A cloud file provider stamps these attributes on everything it touches, which is how a sync setting
// ends up failing a code signature. `xattr -cr` strips them; it does NOT strip com.apple.provenance,
// and if that one is present the only real answer is to build somewhere the OS does not apply it.
if (process.platform === 'darwin') {
  const targets = [path.join(root, 'node_modules/expo-modules-jsi'), path.join(driver, 'ios')].filter(exists);
  const dirty = [];
  for (const t of targets) {
    const out = spawnSync(
      'sh',
      ['-c', `xattr -lr ${JSON.stringify(t)} 2>/dev/null | grep -oE 'com\\.apple\\.(FinderInfo|ResourceFork|provenance|quarantine)' | sort -u`],
      { encoding: 'utf8', timeout: 60000 },
    );
    for (const attr of (out.stdout ?? '').trim().split('\n').filter(Boolean)) {
      dirty.push(`${attr} on ${path.relative(root, t)}`);
    }
  }
  if (dirty.length) {
    // FinderInfo / ResourceFork / quarantine ARE strippable with `xattr -cr` and DEFINITELY break
    // codesign — keep those as blocking fails. com.apple.provenance is kernel-managed and cannot
    // be stripped by any user-space command (Apple developer forums; Flutter tracks same issue).
    // Some macOS/Xcode combos codesign fine with provenance present, others fail — downgrading
    // provenance-only to a WARNING lets xcodebuild determine whether it's a real blocker for THIS
    // setup. If codesign fails, the escalation is documented: build on a case-sensitive APFS disk
    // image, where the kernel does not stamp provenance.
    const provenanceOnly = dirty.every((d) => d.startsWith('com.apple.provenance'));
    const stripCmd = `xattr -cr ${targets.map((t) => path.relative(root, t)).join(' ')} && rm -rf node_modules/expo-modules-jsi/apple/.DerivedData`;
    if (provenanceOnly) {
      warn(
        'com.apple.provenance is stamped on iOS build inputs',
        `${dirty.length} target(s): ${dirty.slice(0, 2).join('; ')}. This xattr is kernel-managed; sudo xattr -d silently no-ops on it. The build may still succeed — try it. If codesign fails with "resource fork ... detritus not allowed", build on a case-sensitive APFS disk image (provenance is stamped per-volume, so a fresh volume comes back clean).`,
        'Try the build first. If codesign fails, create a case-sensitive APFS disk image (Disk Utility → New Image → Sparse Bundle, APFS Case-Sensitive) mounted at /Volumes/DevBuild, git clone the repo there, and build from there.',
      );
    } else {
      fail(
        'Extended attributes on the iOS build inputs — codesign will refuse them',
        dirty.join('; '),
        stripCmd,
      );
    }
  }
}

// 14 ─ A half-written xcframework cache from a failed build.
// The ExpoModulesJSI build script caches into node_modules, outside anything `expo prebuild --clean`
// or a Xcode clean touches, so a failed run leaves a partial framework that the next run reuses and
// fails on identically. Deleting it is free; it rebuilds.
{
  const derived = path.join(root, 'node_modules/expo-modules-jsi/apple/.DerivedData');
  const marker = path.join(driver, 'ios/build');
  if (exists(derived) && exists(marker) && mtime(derived) > mtime(path.join(driver, 'ios/Podfile.lock'))) {
    warn(
      'expo-modules-jsi has a DerivedData cache newer than the last pod install',
      'If the last build failed inside "[CP-User] Build ExpoModulesJSI xcframework", this cache is the half-written output it will reuse.',
      'rm -rf node_modules/expo-modules-jsi/apple/.DerivedData',
    );
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const iosDir = path.join(driver, 'ios');
console.log('FuelGuard driver preflight\n');
if (exists(iosDir)) console.log(`  native build output  apps/driver/ios  ${gb(dirSize(iosDir))} (excluded from Metro's crawl)`);
console.log('');

for (const w of warnings) {
  console.log(`  ! ${w.title}\n    ${w.detail}\n    → ${w.fix}\n`);
}
for (const p of problems) {
  console.log(`  ✗ ${p.title}\n    ${p.detail}\n    → ${p.fix}\n`);
}
if (!problems.length) console.log(`  ✓ No blocking problems.${warnings.length ? ' (warnings above)' : ''}\n`);

process.exit(problems.length ? 1 : 0);
