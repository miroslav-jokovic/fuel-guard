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
 * "move together or not at all" — the notificationCategoryCheck pattern. It reads the LAST CHECK written for
 * each column, which is the one production enforces. Here, in apps/api, because packages/shared is also built
 * for React Native and cannot read a file.
 *
 * A CHECK is written in one of two forms: inline in the `create table` (0537), or as a later
 * `alter table public.<t> add constraint <name> check (<column> in (…))` (0570 replaced the outcome stages
 * that way, Q-AD39). Until 0570 this read only `create table` bodies, so an `alter table` would have been
 * invisible to it, and the test would have stayed green against a CHECK nobody enforces any more. Both forms
 * are now read in migration order (and in file order within one migration), and the last one wins.
 */
const DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const SQL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(DIR + f, "utf8"));

const quoted = (list: string): string[] => [...list.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();

/** The quoted list of the last CHECK on `table.column`, from a `create table` body or an `alter table … add constraint`. */
function checkedList(sql: readonly string[], table: string, column: string): string[] {
  const create = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "g");
  const inline = new RegExp(`\\b${column}\\b[^\\n]*?check \\(${column} in \\(([\\s\\S]*?)\\)\\)`);
  const altered = new RegExp(
    `alter table (?:only )?public\\.${table}\\s+add constraint \\w+\\s+check \\(${column} in \\(([\\s\\S]*?)\\)\\)`, "g");
  let created = false;
  let last: string | undefined;
  for (const file of sql) {
    const found: Array<{ at: number; list: string }> = [];
    for (const c of file.matchAll(create)) {
      created = true;
      const m = inline.exec(c[1]!);
      if (m) found.push({ at: c.index!, list: m[1]! });
    }
    for (const a of file.matchAll(altered)) found.push({ at: a.index!, list: a[1]! });
    const newest = found.sort((x, y) => x.at - y.at).at(-1);
    if (newest) last = newest.list;
  }
  expect(created, `${table} is created by a migration`).toBe(true);
  expect(last, `${table}.${column} has an IN-list CHECK`).toBeDefined();
  return quoted(last!);
}

describe("ads lists vs the migrations' CHECKs", () => {
  it.each([
    ["ads_platform_connections", "provider", AD_PROVIDERS],
    ["ads_campaigns", "state", CAMPAIGN_STATES],
    ["ads_creatives", "state", CREATIVE_STATES],
    ["ads_approvals", "kind", APPROVAL_KINDS],
    ["ads_actions", "kind", ACTION_KINDS],
    ["ads_outcome_events", "stage", OUTCOME_STAGES],
  ] as const)("%s.%s matches the shared list", (table, column, list) => {
    expect(checkedList(SQL, table, column)).toEqual([...list].sort());
  });

  it("a later `alter table … add constraint … check` replaces the create table's list", () => {
    const sql = [
      "create table if not exists public.t (\n  s text not null check (s in ('a', 'b'))\n);",
      "alter table public.t drop constraint if exists t_s_check;\nalter table public.t add constraint t_s_check\n  check (s in ('a', 'c'));",
    ];
    expect(checkedList(sql, "t", "s")).toEqual(["a", "c"]);
    expect(checkedList(sql.slice(0, 1), "t", "s")).toEqual(["a", "b"]);
  });
});
