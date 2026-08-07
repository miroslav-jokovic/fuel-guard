#!/usr/bin/env node
/**
 * Fitness function — the TypeScript feature catalog and migration 0134 must share one vocabulary.
 * The migration is historical SQL, so it cannot import TypeScript; this check keeps the duplicated
 * database CHECK constraints synchronized with FEATURE_KEYS without adding Node-only types to shared.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalog = readFileSync(`${root}packages/shared/src/featureCatalog.ts`, "utf8");
const migration = readFileSync(`${root}supabase/migrations/0134_driver_app_features.sql`, "utf8");

const catalogBody = catalog.match(/export const FEATURE_KEYS = \[(.*?)\] as const;/s)?.[1];
const catalogKeys = catalogBody ? [...catalogBody.matchAll(/"([^"]+)"/g)].map(([, key]) => key) : [];
const constraints = [...migration.matchAll(/(?:features|feature_overrides)_key_check check \(feature_key in \(([^)]+)\)\)/g)].map(([, body]) =>
  [...body.matchAll(/'([^']+)'/g)].map(([, key]) => key),
);

if (constraints.length !== 2 || constraints.some((keys) => keys.join("\n") !== catalogKeys.join("\n"))) {
  console.error("✗ feature catalog drift: FEATURE_KEYS and migration 0134 constraints differ.");
  process.exit(1);
}
console.log(`✓ feature catalog parity ok — ${catalogKeys.length} keys match both migration constraints`);
