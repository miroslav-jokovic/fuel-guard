#!/usr/bin/env node
/**
 * Fitness function — canonical design-token ownership.
 *
 * The shared package owns every cross-application token. Applications import
 * that source and may define namespaced, application-only variables; they may
 * not copy or override shared declarations.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sharedPath = `${root}packages/ui/src/tokens.css`;
const appPaths = [`${root}apps/web/src/style.css`, `${root}apps/admin/src/style.css`];

function customProperties(css, source) {
  const properties = new Map();
  for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();
    const previous = properties.get(name);
    if (previous !== undefined && previous !== value) {
      throw new Error(
        `${source} defines ${name} with conflicting values (${previous} vs ${value}).`,
      );
    }
    properties.set(name, value);
  }
  return properties;
}

try {
  const sharedTokens = customProperties(readFileSync(sharedPath, "utf8"), sharedPath);
  const errors = [];

  for (const appPath of appPaths) {
    const css = readFileSync(appPath, "utf8");
    if (!/^@import\s+["']@fuelguard\/ui\/tokens\.css["'];/m.test(css)) {
      errors.push(`${appPath} does not import @fuelguard/ui/tokens.css`);
    }

    const appTokens = customProperties(css, appPath);
    const overrides = [...appTokens.keys()].filter((name) => sharedTokens.has(name));
    if (overrides.length) {
      errors.push(`${appPath} redeclares shared tokens: ${overrides.join(", ")}`);
    }
  }

  if (errors.length) {
    console.error("✗ canonical design-token contract failed.");
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }

  console.log(
    `✓ canonical token ownership ok — ${sharedTokens.size} shared declarations; ${appPaths.length} consumers import without overrides`,
  );
} catch (error) {
  console.error(
    `✗ could not inspect design tokens: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
