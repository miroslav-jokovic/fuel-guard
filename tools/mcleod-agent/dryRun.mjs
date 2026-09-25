/**
 * What a dry run prints: per-field COVERAGE — how many rows carry a value — never the rows themselves.
 *
 * Counting proves the mapping works; printing a value proves nothing extra, and a printed row is a
 * person's details on somebody's screen. The roster dry run has worked this way since it was written,
 * with one masked sample row. The loads and close dry runs did not: until 2026-09-25 they printed
 * every movement and every stop as JSON — stop addresses, contact names, phone numbers — and
 * `--loads --dry-run` is the first command Alex runs with us on the Board VM. His condition
 * (2026-09-24 reply) is that the connector's output stays counts, times and McLeod ids, with no
 * addresses or licence numbers, so the load paths print coverage and NO sample at all.
 */

/** Roster fields masked in the one sample row the roster dry run keeps. */
export const DRY_MASK = new Set([
  "first_name", "middle_name", "last_name", "full_name", "cdl_number", "cdl_state",
  "date_of_birth", "address_line1", "city", "state", "postal_code", "email",
]);

const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * The lines a dry run prints for one entity: a header, then `n/total field` per field, flagged when
 * some or all rows lack it. `sample: true` adds the first row with DRY_MASK applied — the roster's
 * behaviour, kept for it alone.
 */
export function describeDryRun(entity, rows, { sample = false } = {}) {
  const lines = [`\n### ${entity} — ${rows.length} row(s) would be sent`];
  if (!rows.length) return lines;
  const coverage = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) coverage[k] = (coverage[k] ?? 0) + (isEmpty(v) ? 0 : 1);
  }
  for (const [field, n] of Object.entries(coverage).sort()) {
    const flag = n === 0 ? "  ← EMPTY on every row" : n < rows.length ? `  (${rows.length - n} without)` : "";
    lines.push(`  ${String(n).padStart(4)}/${rows.length}  ${field}${flag}`);
  }
  if (sample) {
    const masked = Object.fromEntries(
      Object.entries(rows[0]).map(([k, v]) => [k, DRY_MASK.has(k) && v != null ? "‹masked›" : v]),
    );
    lines.push(`  sample: ${JSON.stringify(masked)}`);
  }
  return lines;
}

/**
 * The mirror's movements and their stops as two coverage blocks. Stops are counted as their own rows,
 * so "location_name 212/247" says how many stops McLeod named; left nested, the only thing a
 * movement's `stops` field could report is that the array was there.
 */
export function describeMirrorDryRun(movements) {
  const bare = movements.map(({ stops, ...m }) => m);
  const stops = movements.flatMap((m) => m.stops ?? []);
  return [...describeDryRun("movements", bare), ...describeDryRun("stops", stops)];
}
