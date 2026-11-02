import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D-AD3 / workflow §4R "Budget guard: 100 % of spend calls pass through it". The spend half of a
 * platform adapter (`PlatformSpend`, `platforms/adapter.ts`) may be named, and its methods called,
 * only inside `modules/ads/guard/` (the guard) and `modules/ads/platforms/` (the adapters that
 * implement it). Anywhere else in the API, either one fails this test — so a launch written straight
 * against an adapter is red in CI before it can spend.
 *
 * It reads source text, not a module graph, on purpose: a type-only import erases at runtime, and the
 * one thing a reviewer can always see is the file. Test files are exempt (they build fakes).
 */
const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const ALLOWED = [join("modules", "ads", "guard") + sep, join("modules", "ads", "platforms") + sep];
const SPEND_TYPE = /\bPlatformSpend\b/;
const SPEND_CALL = /\.(launch|raiseDailyBudget|changeArea)\s*\(/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function spendBoundaryOffenders(root = SRC): string[] {
  const offenders: string[] = [];
  for (const file of sources(root)) {
    const rel = relative(root, file);
    if (ALLOWED.some((a) => rel.startsWith(a))) continue;
    const text = readFileSync(file, "utf8");
    if (SPEND_TYPE.test(text)) offenders.push(`${rel}: names PlatformSpend`);
    if (SPEND_CALL.test(text)) offenders.push(`${rel}: calls a platform spend method`);
  }
  return offenders;
}

describe("the budget guard is the only path to a platform's spend methods", () => {
  it("no file outside modules/ads/guard and modules/ads/platforms names PlatformSpend or calls its methods", () => {
    expect(spendBoundaryOffenders()).toEqual([]);
  });

  it("the scan reads the guard itself, so it is looking at real files", () => {
    const guard = readFileSync(join(SRC, "modules", "ads", "guard", "budgetGuard.ts"), "utf8");
    expect(SPEND_TYPE.test(guard) && SPEND_CALL.test(guard)).toBe(true);
    expect(sources(SRC).length).toBeGreaterThan(300);
  });
});
