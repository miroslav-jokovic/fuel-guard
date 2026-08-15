import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testEnv } from "./testEnv.js";
import { loadEnv } from "../env.js";

/**
 * Fitness function for Step 5.9 — no test may invent an `Env` shape the process cannot produce.
 *
 * `{ EFS_SOAP_MAX_RPS: 100 } as unknown as Env` type-checks and then hands the code under test an
 * object missing every key it did not mention. `loadEnv` never returns that: the zod schema
 * `.default()`s those keys, so in any running process they are present. Tests built on the cast were
 * therefore exercising `undefined` values no deployment can produce — which is precisely why
 * deleting ~19 unreachable `env.X ?? <literal>` fallbacks turned 62 tests red at once. The fallbacks
 * were not protecting the product; they were propping up the fixtures.
 *
 * `testEnv()` closes the gap: it parses the schema exactly as the process does, then applies typed
 * overrides. `Partial<Env>` also makes a key that is not in the schema a compile error — which
 * immediately found `EFS_SOAP_BACKFILL_RPS` in `efsCardUnresolved.test.ts`, a setting that never
 * existed and had been configuring nothing.
 */
const TESTING_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.dirname(path.dirname(TESTING_DIR));

describe("test fixtures use a real Env", () => {
  const files = execFileSync("git", ["ls-files", "src/**/*.test.ts", "src/*.test.ts"], {
    cwd: API_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  it("finds the apps/api test files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no test casts an object literal to Env", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(path.join(API_ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Comments are skipped, because several of them explain this very pattern in order to say
          // why it is banned — including the one above. A comment cannot cast anything, so nothing
          // is lost, and the alternative (exempting whole files by name) would blind the scan to
          // real casts in those same files.
          const trimmed = line.trimStart();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
          if (/\bas (unknown as )?Env\b/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it("testEnv() carries the schema defaults a cast would have dropped", () => {
    const built = testEnv();
    const parsed = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(built).toEqual(parsed);
    // A spot check with teeth: these three had a call-site literal that DISAGREED with the schema
    // before Step 5.9 (30 vs 7, 1 vs 12, Infinity vs 5_000). The schema is the surviving source.
    expect(built.EFS_SOAP_MAX_DAYS_PER_REQUEST).toBe(7);
    expect(built.EFS_SOAP_BACKFILL_MAX_PAGES).toBe(12);
    expect(built.EFS_SOAP_MAX_ROWS_PER_POLL).toBe(5_000);
  });

  it("applies overrides on top of the defaults", () => {
    expect(testEnv({ EFS_CARD_SYNC_HOURS: 6 }).EFS_CARD_SYNC_HOURS).toBe(6);
    expect(testEnv({ EFS_CARD_SYNC_HOURS: 6 }).EFS_SOAP_BACKFILL_MAX_PAGES).toBe(12);
  });
});
