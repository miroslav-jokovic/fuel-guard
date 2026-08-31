import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Fitness function — no surface writes `drivers` from the browser (R6a).
 *
 * ── THE DEFECT THIS EXISTS TO STOP COMING BACK ──────────────────────────────────────────────────
 * Until 2026-08-31 the roster's edit drawer called a composable that did `supabase.from("drivers")
 * .update(...)`. Two things followed, both silent, and neither visible in review because the call
 * looked exactly like the read beside it:
 *
 *  - `resolveDriverUpdate` never ran, so the row was never claimed from telematics. The next
 *    `samsaraDriverSync` sweep overwrote the office's correction — the failure that sync's own
 *    comment says "the roster PATCH exists to prevent". 282 of 287 live drivers were exposed.
 *  - No audit row was written for a change to a §391.51-relevant field.
 *
 * A browser INSERT was worse: `drivers.identity_source` is `not null default 'samsara'`, so a driver
 * typed in by hand was born telematics-owned.
 *
 * Written as a source scan because that is the shape of the bug — a WRITE VERB on this table from
 * this layer. A behavioural test would have to guess which composable did it; this cannot miss one.
 */
// Resolved from cwd (the workspace root is `apps/web` under vitest) rather than `import.meta.url`,
// which vite rewrites to a non-file scheme in this setup.
const SRC = readFileSync(path.join(process.cwd(), "src/composables/useDrivers.ts"), "utf8");

describe("useDrivers — the drivers table is not written from the browser", () => {
  it("reads through PostgREST but never writes", () => {
    // Reads are fine and deliberate: the roster list is a read, and RLS scopes it.
    expect(SRC).toContain('.from("drivers")');

    const writes = [...SRC.matchAll(/\.from\("drivers"\)\s*\n?\s*\.(\w+)\(/g)].map((m) => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    // `select` is the only verb allowed to follow it. `insert`, `update`, `upsert` and `delete` all
    // bypass `resolveDriverUpdate`, the audit row, and `identity_source`.
    expect(writes.filter((verb) => verb !== "select")).toEqual([]);
  });

  it("routes create and update through the roster API instead", () => {
    expect(SRC).toContain('apiFetch<{ driver: Driver }>("/api/roster/drivers"');
    expect(SRC).toContain("`/api/roster/drivers/${payload.id}`");
  });

  it("has no `useUpdateDriver` export for anyone to reach for again", () => {
    // Deleted rather than merely left uncalled: a private door left standing is one somebody walks
    // through, and its name is the obvious one to autocomplete.
    expect(SRC).not.toMatch(/export function useUpdateDriver\b/);
  });
});
