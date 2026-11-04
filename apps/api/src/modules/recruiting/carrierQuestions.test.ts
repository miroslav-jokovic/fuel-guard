import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARRIER_QUESTION_KINDS } from "@silvicom/shared";

/**
 * §15.3 D-CQ1: the kinds the settings offer are exactly the six 0567's CHECK admits — read from the migration
 * itself, so a kind added to one side and not the other fails here, not on a carrier's first save. (In the
 * API, not beside the contract: `packages/shared` has no Node types to read a file with.)
 */
describe("the carrier's question kinds", () => {
  it("are exactly the six 0567 admits", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../../../supabase/migrations/0567_recruiting_carrier_questions.sql", import.meta.url)),
      "utf8",
    );
    const listed = /kind in \(([^)]*)\)/.exec(sql)![1]!.split(",").map((k) => k.trim().replace(/'/g, ""));
    expect(listed).toEqual([...CARRIER_QUESTION_KINDS]);
  });
});
