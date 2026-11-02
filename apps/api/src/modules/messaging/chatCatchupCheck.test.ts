import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_CATCHUP_DAILY_CAP, CHAT_CATCHUP_MAX_LINES } from "@silvicom/shared";

/**
 * CH12's two numbers live in two places that must move together: the shared contract, which the web
 * says to the person ("6 of 20 left today"), and migration 0549, which enforces them. A cap raised in
 * one and not the other passes every unit test and then tells people a number the database does not
 * keep. This reads the LAST migration that defines each function — the one the database runs — the way
 * chatReactionCheck.test.ts holds the reactions.
 */
describe("catch-up limits vs 0549's functions", () => {
  const dir = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
  const latest = (fn: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(dir + f, "utf8"))
      .map((sql) => new RegExp(`create or replace function (?:public\\.)?${fn}\\([\\s\\S]*?\\$\\$;`).exec(sql)?.[0])
      .filter((body): body is string => !!body)
      .at(-1);

  it("chat_catchup_left counts down from the contract's daily cap, over 24 hours", () => {
    const body = latest("chat_catchup_left");
    expect(body).toBeDefined();
    expect(Number(/greatest\((\d+) - count/.exec(body!)?.[1])).toBe(CHAT_CATCHUP_DAILY_CAP);
    expect(body).toMatch(/interval '24 hours'/);
  });

  it("chat_catchup_lines reads at most the contract's line ceiling", () => {
    const body = latest("chat_catchup_lines");
    expect(body).toBeDefined();
    expect([...body!.matchAll(/limit (\d+)/g)].map((m) => Number(m[1]))).toEqual([CHAT_CATCHUP_MAX_LINES]);
  });
});
