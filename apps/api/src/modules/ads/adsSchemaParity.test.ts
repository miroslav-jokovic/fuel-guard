import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  AD_PROVIDERS,
  APPROVAL_KINDS,
  CAMPAIGN_STATES,
  CREATIVE_STATES,
  OUTCOME_STAGES,
} from "@silvicom/shared";

/**
 * The shared lists (packages/shared/src/ads/contracts.ts) and the CHECK constraints of the migrations
 * "move together or not at all" — the notificationCategoryCheck pattern. It reads the LAST migration
 * that defines each column's CHECK, which is the one production enforces. Here, in apps/api, because
 * packages/shared is also built for React Native and cannot read a file.
 */
const DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const SQL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(DIR + f, "utf8"));

/** The quoted list of the last `<column> … check (<column> in (…))` written for `table`. */
function checkedList(table: string, column: string): string[] {
  const create = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`);
  const body = SQL.map((s) => create.exec(s)?.[1]).filter(Boolean).at(-1);
  expect(body, `${table} is created by a migration`).toBeDefined();
  const m = new RegExp(`\\b${column}\\b[^\\n]*?check \\(${column} in \\(([\\s\\S]*?)\\)\\)`).exec(body!);
  expect(m, `${table}.${column} has an IN-list CHECK`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
}

describe("ads lists vs the 0537 CHECKs", () => {
  it.each([
    ["ads_platform_connections", "provider", AD_PROVIDERS],
    ["ads_campaigns", "state", CAMPAIGN_STATES],
    ["ads_creatives", "state", CREATIVE_STATES],
    ["ads_approvals", "kind", APPROVAL_KINDS],
    ["ads_actions", "kind", ACTION_KINDS],
    ["ads_outcome_events", "stage", OUTCOME_STAGES],
  ] as const)("%s.%s matches the shared list", (table, column, list) => {
    expect(checkedList(table, column)).toEqual([...list].sort());
  });
});
