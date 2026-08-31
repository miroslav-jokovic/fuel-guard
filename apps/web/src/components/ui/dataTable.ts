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
