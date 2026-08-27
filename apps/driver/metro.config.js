const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// --- pnpm monorepo wiring (plan §11.4 / D8 / blocker B3) ---
// Watch ONLY what this bundle can actually reach. `watchFolders = [workspaceRoot]` used to put the
// entire monorepo into Metro's crawl — apps/web, apps/admin, TemplatesTailwind, .pnpm-store,
// data-samples, docs, every native build directory and a 1.2 GB ios/Pods tree — which is minutes of
// file crawling before the first byte is bundled, and the reason `expo start` appeared to hang.
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/shared'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

// --- keep native build output and sync-conflict copies out of the crawl ---
// Metro's default blockList does not exclude CocoaPods or Xcode/Gradle output, and those live INSIDE
// projectRoot, which Metro always watches. ios/ alone is >1 GB of headers and object files that no
// import can ever reach.
const esc = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const extraBlocks = [
  new RegExp(`${esc(path.join(projectRoot, 'ios'))}[/\\\\](Pods|build|DerivedData)[/\\\\].*`),
  new RegExp(`${esc(path.join(projectRoot, 'android'))}[/\\\\](build|\\.gradle|\\.cxx|app[/\\\\]build)[/\\\\].*`),
  // Cloud-sync conflict copies ("SessionProvider 2.tsx", "index 3.js"). Two files exporting the same
  // module is a haste collision at best and a silently stale bundle at worst.
  /.* \d+\.(js|jsx|ts|tsx|json|cjs|mjs)$/,
];
const priorBlock = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(priorBlock) ? priorBlock : priorBlock ? [priorBlock] : []),
  ...extraBlocks,
];

// --- consume @silvicom/shared from its BUILT dist (plan D7 / blocker B2) ---
// `pnpm start` / `pnpm ios` / `pnpm android` rebuild this first, so it cannot go stale behind your
// back. The checks below exist for the case where Metro is started some other way.
const sharedRoot = path.resolve(workspaceRoot, 'packages/shared');
const sharedEntry = path.join(sharedRoot, 'dist/index.js');

if (!fs.existsSync(sharedEntry)) {
  throw new Error(
    '@silvicom/shared has not been built for React Native.\n' +
      `Expected: ${sharedEntry}\n` +
      'Run:      pnpm --filter @silvicom/shared build:rn',
  );
}

// A dist older than its source produces a bundle built against yesterday's contracts — it compiles
// and then misbehaves, which is far more expensive to debug than a warning here.
const newestSource = (dir) => {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSource(full));
    else if (entry.name.endsWith('.ts')) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
};
if (newestSource(path.join(sharedRoot, 'src')) > fs.statSync(sharedEntry).mtimeMs) {
  console.warn(
    '\n\u001b[33m[fuelguard]\u001b[0m packages/shared/dist is OLDER than packages/shared/src.\n' +
      '           The bundle will use the stale contracts. Run:\n' +
      '           pnpm --filter @silvicom/shared build:rn\n',
  );
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@silvicom/shared') {
    return { type: 'sourceFile', filePath: sharedEntry };
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
