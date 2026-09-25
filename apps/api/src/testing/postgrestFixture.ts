import type { RecordedQuery } from "./supabaseRecorder.js";

/**
 * A `supabaseRecorder` fixture that behaves like PostgREST instead of like an array.
 *
 * ── WHY THIS EXISTS, AND IT IS A MEASURED FAILURE RATHER THAN A TIDY-UP ───────────────────────
 * ⚠ **`createSupabaseRecorder`'s flat-array fixture applies no filters, no order, no limit and no
 * column projection** — it hands every row to every query. That is fine for asserting what a
 * service ASKED for, which is what the recorder is for, and it is silently wrong for asserting what
 * a service GOT. Both halves have cost this repo a green test that proved nothing:
 *
 *   · a flat array answered a query for April with March's rows ([[supabase-recorder-does-not-filter]]);
 *   · B3 dropped `revokes` from its authorizations select and NOTHING went red, because the fake
 *     returned whole rows — so *"honours a revoked release"* passed against a service that never
 *     read the revocation.
 *
 * So any test whose property is about NARROWING — the live invitation, marks counted against it,
 * one org's rows and not another's — needs the fake to narrow, or the property is unasserted.
 *
 * ⚠ It lives here rather than beside one test because the second copy is where the drift starts:
 * `applicantChecklist.test.ts` and `applicantBoard.test.ts` assert the same narrowing about the same
 * tables, and two hand-rolled fakes would eventually disagree about which one PostgREST is.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────
 * No joins, no `or`, no `not`, no range. A fixture that grew into a query engine would be a second
 * database to maintain and to be wrong in its own way; when a service needs more than this, the
 * honest answer is a PGlite matrix in `supabase/tests/`, which runs the real planner.
 */

/** One fixture row. `org_id` belongs on it — the tenant filter should be real here too. */
export type FixtureRow = Record<string, unknown>;

/**
 * Build a fixture over these rows.
 *
 * Applies, in PostgREST's order: the filters the query made (`eq`, `in`, `is`), the `select` list as
 * a projection, then `order`, then `limit`.
 */
export function postgrestFixture(rows: readonly FixtureRow[]): (q: RecordedQuery) => FixtureRow[] {
  return (q: RecordedQuery) => {
    let out = rows.filter((row) => q.filters().every((f) => matches(row[f.col], f.val)));

    // ⚠ The projection is the half that caught B3's missing `revokes`: a service that never selects
    // a column must not be handed it, or the test cannot tell reading from not reading.
    const select = q.ops.find((o) => o.method === "select")?.args[0];
    if (typeof select === "string" && select !== "*") {
      const cols = select.split(",").map((c) => c.trim());
      out = out.map((row) =>
        Object.fromEntries(
          cols.flatMap((c) => {
            const picked = project(row, c);
            return picked ? [picked] : [];
          }),
        ),
      );
    }

    const order = q.ops.find((o) => o.method === "order");
    if (order) {
      const col = String(order.args[0]);
      const asc = (order.args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
    }

    const limit = q.ops.find((o) => o.method === "limit");
    if (limit) out = out.slice(0, Number(limit.args[0]));
    return out;
  };
}

/**
 * One select item — `col`, or PostgREST's JSON path `alias:col->key->>key` (Q-HM14 reads one key of
 * a draft that way, so the payload itself never leaves the database).
 *
 * ⚠ A path is EVALUATED against the fixture row's real jsonb rather than looked up by its alias, so a
 * fixture holds `payload: { questionnaire: { applying_as } }` exactly as the table does, and a service
 * whose path names the wrong key gets null — which is what PostgREST would hand it. `->>` returns
 * text; a missing key anywhere on the path is null, never a throw.
 */
function project(row: FixtureRow, item: string): [string, unknown] | null {
  const [alias, expr] = item.includes(":") ? item.split(":", 2) as [string, string] : [null, item];
  const parts = expr.split(/(->>|->)/);
  const col = parts[0]!;
  if (parts.length === 1) return col in row ? [alias ?? col, row[col]] : null;
  if (!(col in row)) return null;
  let value: unknown = row[col];
  let key = col;
  for (let i = 1; i < parts.length; i += 2) {
    key = parts[i + 1]!;
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] ?? null : null;
    if (parts[i] === "->>" && value !== null) value = typeof value === "string" ? value : JSON.stringify(value);
  }
  return [alias ?? key, value];
}

/**
 * One filter, against one cell.
 *
 * ⚠ `.in()` hands an ARRAY as its value and `.is("col", null)` hands `null`, so a bare `===` reads
 * both as "no row matches" — which is the shape of a test that passes by returning nothing. And a
 * column ABSENT from a fixture row is read as null, because that is what the database would say
 * about a nullable column nobody wrote: requiring every fixture to spell out every null would make
 * adding a column to a service a sweep through every test that ever touched its table.
 */
function matches(cell: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return want.includes(cell);
  if (want === null) return cell === null || cell === undefined;
  return cell === want;
}
