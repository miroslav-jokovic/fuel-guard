const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// --- pnpm monorepo wiring (plan §11.4 / D8 / blocker B3) ---
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

// --- consume @fuelguard/shared from its BUILT dist (plan D7 / blocker B2) ---
// Run `pnpm --filter @fuelguard/shared build:rn` first so packages/shared/dist exists.
const sharedEntry = path.resolve(workspaceRoot, 'packages/shared/dist/index.js');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@fuelguard/shared') {
    return { type: 'sourceFile', filePath: sharedEntry };
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
