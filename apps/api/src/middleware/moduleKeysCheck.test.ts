import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@silvicom/shared";

/**
 * The sellable modules live in two places that must move together: `MODULE_KEYS` in the shared contract
 * — which `requireModule`, the web's gating and the platform console's switches all read — and the
 * CHECK on `org_modules.module_key`. A key in the contract and not the CHECK is a switch the console
 * shows and the database refuses to turn on; a key in the CHECK and not the contract is one nobody can
 * turn on at all. Found adding `chat_ai` (0549, OFFICE-CHAT-PLAN D-CHAT37), when nothing held the two
 * equal. Reads the LAST migration that redefines the CHECK — the one the database enforces.
 */
describe("MODULE_KEYS vs the org_modules CHECK", () => {
  it("the contract and the latest CHECK list the same keys", () => {
    const dir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(dir + f, "utf8"))
      .map((sql) => /org_modules_key_check\s+check\s*\(([\s\S]*?)\)\s*\)\s*;/i.exec(sql)?.[1])
      .filter((body): body is string => !!body)
      .at(-1);
    expect(latest).toBeDefined();
    const keys = [...latest!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([...MODULE_KEYS].sort());
  });
});
