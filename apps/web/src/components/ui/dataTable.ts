/**
 * The pieces `DataTable.vue` and `DataTableCards.vue` both need.
 *
 * They exist as a module rather than as two copies because the card view and the table view render
 * the SAME cell from the same column definition, and a blank rule that drifted between them would
 * show a dash on a phone and an empty cell on a laptop for the same row. Two lines each, and still
 * worth deriving: a copy is a workaround with a delay fuse (D-ROS11).
 */

/** What counts as an empty cell, and therefore renders the ink-subtle dash. */
export const isBlank = (v: unknown): boolean => v == null || v === "";

/**
 * A cell's raw value, before a `#cell-<key>` slot has a chance to override it.
 *
 * The return type is INFERRED, not annotated, and that is deliberate. `Row extends Record<string,
 * any>` makes it `any`, which is what the slot prop `value` has always been. Annotating it `unknown`
 * — the instinct when moving code into a shared module — broke five pages that do arithmetic on a
 * slot value (`ReportsPage`, `ReeferCoveragePage`). Tightening it is a real improvement and would
 * find real unsafe arithmetic, but it is a change to what every `#cell-` slot may assume, and that
 * is its own step rather than a rider on an extraction.
 */
export const cellValue = <Row extends Record<string, any>>(row: Row, key: string) => row[key];
