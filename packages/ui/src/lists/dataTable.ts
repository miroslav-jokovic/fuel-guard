/**
 * The rule `DataTable.vue` and `DataTableCards.vue` must agree on.
 *
 * Only one thing belongs here, and it is not much code — it is a DECISION: what counts as an empty
 * cell. The table view and the card view render the same column from the same definition, and a
 * blank rule that drifted between them would show a dash on a phone and an empty cell on a laptop
 * for the same row. Reading `row[key]` is a property access and stays where it is used; this is a
 * rule, and a rule with two copies has two answers (D-ROS11).
 */
export const isBlank = (v: unknown): boolean => v == null || v === "";

/**
 * The columns worth drawing for these rows: a column every row leaves blank is dropped, so a list never
 * shows a header over nothing (owner, 2026-11-03: "let's not have empty rows and columns if data does
 * not exist"). `keep` columns are always drawn — the title a row is read by. `empty` overrides what
 * counts as no data for one column (a usage count of 0 says nothing a missing one would not).
 *
 * ⚠ Rows that have not arrived are not evidence: with no rows at all every column is kept, so a table
 * does not draw itself one column wide while it loads and then jump.
 */
export function columnsWithData<C extends { key: string }>(
  columns: readonly C[],
  rows: readonly Record<string, unknown>[],
  opts: { keep?: readonly string[]; empty?: Partial<Record<string, (v: unknown) => boolean>> } = {},
): C[] {
  if (rows.length === 0) return [...columns];
  return columns.filter((c) => {
    if (opts.keep?.includes(c.key)) return true;
    const empty = opts.empty?.[c.key] ?? isBlank;
    return rows.some((r) => !empty(r[c.key]));
  });
}
