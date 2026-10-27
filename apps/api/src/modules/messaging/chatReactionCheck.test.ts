import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_REACTIONS } from "@silvicom/shared";

/**
 * The six reactions (D-CHAT26) live in two places that must move together: `CHAT_REACTIONS` in the
 * shared contract, which the API validates against and the web draws, and the CHECK on
 * `message_reactions` with the list inside `chat_react` and the order `chat_line_reactions` sorts by
 * (0523). A key in the contract and not in the database passes every unit test and fails its first
 * press with CH006; a key in the database and not the contract is a reaction nobody can draw. This
 * reads the LAST migration that redefines the CHECK — the one the database enforces — the way
 * notificationCategoryCheck.test.ts holds the bell's categories.
 */
describe("chat reactions vs the message_reactions CHECK", () => {
  const dir = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(dir + f, "utf8"))
    .filter((sql) => /message_reactions_reaction_check check/.test(sql))
    .at(-1);
  const keys = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it("the contract and the latest CHECK list the same six, in the same order", () => {
    expect(latest).toBeDefined();
    const body = /message_reactions_reaction_check check \(reaction in \(([\s\S]*?)\)\)/.exec(latest!)?.[1] ?? "";
    expect(keys(body)).toEqual([...CHAT_REACTIONS]);
  });

  it("chat_react accepts, and chat_line_reactions orders by, the same list", () => {
    const accepted = /p_reaction not in \(([^)]*)\)/.exec(latest!)?.[1] ?? "";
    const order = /array_position\(array\[([^\]]*)\]/.exec(latest!)?.[1] ?? "";
    expect(keys(accepted)).toEqual([...CHAT_REACTIONS]);
    expect(keys(order)).toEqual([...CHAT_REACTIONS]);
  });
});
