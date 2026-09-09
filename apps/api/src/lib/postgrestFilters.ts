/**
 * Values that are safe inside a PostgREST `.or()` (2026-09-09 close-out of I0–I9).
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
 * `.or()` takes ONE STRING that PostgREST parses into a filter tree, and the grammar's separators
 * are `,` `(` `)` and `.`. Two call sites interpolated a user's search term into that string raw:
 * `listParts` (the shop's parts search) and `searchEntries` (the ledger's reference lookup). A
 * technician searching for a part number with a comma in it — or a description containing `)` —
 * does not get "no results", which would at least be honest. The parse either fails with a 400 the
 * page renders as "could not load", or succeeds against a filter tree nobody wrote.
 *
 * It is NOT SQL injection: PostgREST parses its own grammar and never concatenates SQL, so the
 * blast radius is a wrong or refused query rather than a reachable database. That is why this was
 * carried as owed work rather than as a security fix — and why it is being fixed now, because a
 * search box that breaks on a comma is a search box the shop stops trusting.
 *
 * ── THE FIX IS PostgREST'S OWN ESCAPE, NOT A CHARACTER FILTER ─────────────────────────────────
 * Stripping the offending characters was the tempting alternative and it is wrong twice: it
 * silently changes what the person asked for, and it is a denylist that the next grammar change
 * outdates. PostgREST documents double quotes around a value, with `\` and `"` backslash-escaped
 * inside — so a quoted value can contain every separator the grammar has.
 */

/**
 * Quote a value for use inside an `.or()` / `.and()` filter string.
 *
 * ⚠ Only for the VALUE half. The column and the operator are the caller's own literals and must
 * never come from a request — a quoted value cannot escape its position, but a column name
 * interpolated from user input chooses which column is searched.
 */
export function orFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
