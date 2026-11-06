import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadEnv } from "./env.js";

/**
 * The env split (2026-11-06, ads Track G env-split) changed no behaviour: every key, default and parse is what the
 * 500-line `env.ts` produced before it was divided into `envAuth.ts`, `envSamsara.ts`, `envFuel.ts`,
 * `envEfsIngest.ts`, `envMail.ts`, `envPsp.ts`, `envAds.ts` and `envCollectors.ts`.
 *
 * `envSplit.golden.json` is the OLD schema's answer, recorded by running the pre-split `loadEnv` (main `ad7bca4`)
 * over the same inputs this file feeds the new one:
 *   - `full`: every one of the 169 keys set, each to a value whose parse differs from its default where one exists
 *     (168 of 169), on a production host — so a moved default, a dropped transform or a lost key shows;
 *   - `defaults`: nothing set, so every default shows;
 *   - the three post-parse rules lifted out of `loadEnv` (anon-key fallback, mail auto-detect both ways);
 *   - two all-invalid inputs, whose sorted error lines pin every refusal (min, enum, url, guid, refine).
 *
 * Only the golden's keys are compared, so a key ADDED later does not break this; a key changed or removed does,
 * and then the golden is edited in the same PR as the change, on purpose.
 */

interface Golden {
  keys: string[];
  cases: Record<string, { input: Record<string, string>; output: Record<string, unknown> }>;
  invalid: Record<string, string[]>;
}
const golden = JSON.parse(readFileSync(new URL("./testing/envSplit.golden.json", import.meta.url), "utf8")) as Golden;

const pick = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const parsed = (input: Record<string, string>) => JSON.parse(JSON.stringify(loadEnv(input))) as Record<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("env split — the new shape parses exactly as the pre-split schema did", () => {
  it("the full fixture: all 169 pre-split keys present, each parsed to the recorded value", () => {
    const { input, output } = golden.cases.full!;
    const now = parsed(input);
    expect(golden.keys.filter((k) => !(k in now))).toEqual([]);
    expect(pick(now, golden.keys)).toEqual(output);
  });

  for (const name of ["defaults", "anonFallback", "mailResend", "mailBrevo"]) {
    it(`the ${name} fixture parses to the recorded value`, () => {
      const { input, output } = golden.cases[name]!;
      expect(pick(parsed(input), golden.keys)).toEqual(output);
    });
  }

  for (const bad of Object.keys(golden.invalid)) {
    it(`every pre-split key set to ${JSON.stringify(bad)} is refused with the recorded errors`, () => {
      const input = Object.fromEntries(golden.keys.map((k) => [k, bad]));
      let lines: string[] = [];
      try { loadEnv(input); } catch (e) { lines = String((e as Error).message).split("\n").slice(1).sort(); }
      const own = (l: string) => golden.keys.includes(l.replace(/^\s+- /, "").split(":")[0]!);
      expect(lines.filter(own)).toEqual(golden.invalid[bad]);
    });
  }
});
