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

const exists = (p) => fs.existsSync(p);
const mtime = (p) => fs.statSync(p).mtimeMs;

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

// 9 ─ Dataless (evicted) files.
// The one failure here that is a true hang rather than a slowdown: with "Optimize Mac Storage" on,
// iCloud evicts file contents and leaves a stub. Reading one blocks until iCloud downloads it — and
// Metro's crawler reads tens of thousands of files. This is not slow, it is stopped.
if (process.platform === 'darwin') {
  const found = spawnSync(
    'sh',
    ['-c', `find ${JSON.stringify(realRoot)} -flags +dataless -not -path '*/.git/*' 2>/dev/null | head -20`],
    { encoding: 'utf8', timeout: 20000 },
  );
  const dataless = (found.stdout ?? '').trim().split('\n').filter(Boolean);
  if (dataless.length) {
    fail(
      'Some files have been evicted to the cloud (dataless)',
      `${dataless.length}+ file(s), e.g. ${dataless.slice(0, 3).map((f) => path.relative(root, f)).join(', ')}. Reading one blocks until it downloads.`,
      'Turn off "Optimize Mac Storage", or move the checkout off the synced path (see the warning above).',
    );
  } else if (found.error) {
    warn('Could not check for evicted files', String(found.error.message), 'Re-run; the scan timed out.');
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
      fail(
        'The dev client on your device is out of date',
        `Built ${built}. These are imported by the app but were NOT linked into it: ${missing.join(', ')}. The bundle will load and then die on "Cannot find native module".`,
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
