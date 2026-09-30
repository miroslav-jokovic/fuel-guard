import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_CATEGORIES } from "@silvicom/shared";

/**
 * The contract and the database CHECK "move together or not at all" (0232, 0397) — and until
 * 2026-09-30 nothing held them to it: a category added to `NOTIFICATION_CATEGORIES` and not to the
 * CHECK passes every unit test and fails its first `notify()` in production. This reads the LAST
 * migration that redefines the CHECK, which is the one production enforces.
 *
 * Here, beside `notify()`, rather than beside the contract: `packages/shared` is also built for React
 * Native and carries no Node types, so it cannot read a file.
 */
describe("notification categories vs the notification_events CHECK", () => {
  it("the contract and the latest CHECK list the same categories", () => {
    const dir = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(dir + f, "utf8"))
      .filter((sql) => /add constraint notification_events_category_check/.test(sql))
      .at(-1);
    expect(latest).toBeDefined();
    const body = /notification_events_category_check check \(category in \(([\s\S]*?)\)\)/.exec(latest!)?.[1] ?? "";
    const inCheck = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });
});
