#!/usr/bin/env node
/**
 * Migration safety guard: Supabase identifies migrations by numeric version, not filename.
 * Duplicate version prefixes make one SQL file invisible to the remote ledger and cause db push
 * to replay or skip schema changes. Fail before a migration can reach main.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(root, "supabase/migrations");
const byVersion = new Map();
const malformed = [];

for (const filename of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
  const match = filename.match(/^(\d+)_/);
  if (!match) {
    malformed.push(filename);
    continue;
  }
  const version = match[1];
  const files = byVersion.get(version) ?? [];
  files.push(filename);
  byVersion.set(version, files);
}

const duplicates = [...byVersion.entries()].filter(([, files]) => files.length > 1);
if (malformed.length || duplicates.length) {
  console.error("✗ migration version safety check failed.");
  for (const filename of malformed) console.error(`  malformed filename: ${filename}`);
  for (const [version, files] of duplicates) console.error(`  duplicate ${version}: ${files.join(", ")}`);
  process.exit(1);
}

console.log(`✓ migration versions ok — ${byVersion.size} unique numbered migrations`);
