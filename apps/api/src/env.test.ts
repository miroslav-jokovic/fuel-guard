import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";

const base = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  WEB_APP_URL: "https://app.example.com",
  ALLOWED_ORIGINS: "https://app.example.com",
};

describe("production environment validation", () => {
  it("requires server Supabase credentials and non-local URLs", () => {
    expect(() => loadEnv({ ...base, SUPABASE_URL: "" })).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...base, WEB_APP_URL: "http://localhost:5173" })).toThrow(/WEB_APP_URL/);
    expect(() => loadEnv({ ...base, ALLOWED_ORIGINS: "http://localhost:5173" })).toThrow(/ALLOWED_ORIGINS/);
  });

  it("keeps local development permissive", () => {
    expect(loadEnv({ NODE_ENV: "development" }).WEB_APP_URL).toBe("http://localhost:5173");
  });
});

/**
 * Step 5.9 — one source for every default.
 *
 * `env.X ?? <literal>` on a key whose zod schema already applies `.default()` is unreachable code,
 * and it stays harmless right up until someone changes the schema default and the two disagree.
 * Then the effective value depends on which file you happened to read. That was not hypothetical:
 * three call sites were ALREADY disagreeing when this test was written —
 *
 *   EFS_SOAP_MAX_DAYS_PER_REQUEST   literal 30        schema default 7
 *   EFS_SOAP_BACKFILL_MAX_PAGES     literal 1         schema default 12
 *   EFS_SOAP_MAX_ROWS_PER_POLL      literal Infinity  schema default 5_000
 *
 * — each reading as documentation of a value the process has never used.
 *
 * The rule this asserts: a `??` on a validated env key is allowed ONLY where the schema marks that
 * key `.optional()`, in which case `undefined` is reachable and the fallback is doing real work.
 */
const SRC = path.dirname(fileURLToPath(import.meta.url));

describe("env defaults have exactly one source", () => {
  const schema = readFileSync(path.join(SRC, "env.ts"), "utf8");

  /**
   * Three outcomes, because "is it optional" is the wrong question on its own.
   *
   *   "absent"    the key is not in the schema at all, so it is not a validated env key. Out of
   *               scope: `buildInfo.ts` aliases `const env = process.env` and reads Railway's
   *               RAILWAY_GIT_* variables through it. Those never pass through zod, have no default
   *               to duplicate, and genuinely can be undefined. Matching on syntax rather than on
   *               schema membership flagged all five of them — this classification is what
   *               distinguishes a real duplicate default from a variable zod has never heard of.
   *   "optional"  declared `.optional()`, so `undefined` is reachable and the fallback works.
   *   "provided"  declared with a `.default()`, or required. Either way the parsed value is never
   *               undefined and the fallback is dead code.
   */
  function classify(key: string): "absent" | "optional" | "provided" {
    const line = schema.split("\n").find((l) => l.trimStart().startsWith(`${key}:`));
    if (line === undefined) return "absent";
    return line.includes(".optional()") ? "optional" : "provided";
  }

  it("reads the schema it is asserting against", () => {
    expect(classify("HERE_API_KEY")).toBe("optional");
    expect(classify("EFS_CARD_SYNC_HOURS")).toBe("provided");
    expect(classify("RAILWAY_GIT_COMMIT_SHA")).toBe("absent");
  });

  it("no call site falls back on a key that already carries a schema default", () => {
    // Deliberately scans the tracked sources rather than importing them: the defect is textual —
    // two literals in two files — and only a text scan can see a call site that is never executed.
    const files = execFileSync("git", ["ls-files", "src/**/*.ts", "src/*.ts"], {
      cwd: path.dirname(SRC),
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !f.endsWith(".test.ts"));

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(path.dirname(SRC), file), "utf8");
      src.split("\n").forEach((line, i) => {
        // Two filters, and BOTH are load-bearing — each one lets through what the other catches:
        //   the `process.` lookbehind    → `instrument.ts` reads `process.env.NODE_ENV`, a key that
        //                                  IS in the schema, but it runs before the env is parsed
        //                                  (Sentry must initialise on the first import), so raw and
        //                                  possibly undefined.
        //   `classify(key) === absent`   → `buildInfo.ts` does `const env = process.env` and reads
        //                                  RAILWAY_GIT_*, which the lookbehind cannot see through.
        for (const match of line.matchAll(/(?<!process\.)\benv\.([A-Z][A-Z_0-9]*)\s*\?\?/g)) {
          const key = match[1]!;
          if (classify(key) === "provided") offenders.push(`${file}:${i + 1} ${key}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
