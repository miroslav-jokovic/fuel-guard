import { describe, expect, it } from "vitest";
import { assembleLeaderboard, displayFirstName, getDriverLeaderboard } from "./driverLeaderboard.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

const ORG = "org1";
const WEEK = { week_start: "2026-08-31", week_end: "2026-09-06" };
const row = (driver_id: string, rank: number | null, week_final: number | string | null) => ({
  driver_id, rank, week_final, ...WEEK,
});
const names = new Map([
  ["d1", { first_name: "Ana", full_name: "Ana Petrović" }],
  ["d2", { first_name: null, full_name: "Bojan Kostić" }],
  ["d3", { first_name: "  ", full_name: "Cara" }],
  ["d4", { first_name: "Dmitri", full_name: "Dmitri V" }],
  ["d5", { first_name: "Eve", full_name: "Eve L" }],
  ["d6", { first_name: "Faisal", full_name: "Faisal K" }],
  ["me", { first_name: "Miki", full_name: "Miroslav J" }],
]);

describe("displayFirstName", () => {
  it("prefers the stored first name, falls back to the first word, and never prints nothing", () => {
    expect(displayFirstName({ first_name: "Ana", full_name: "Ana Petrović" })).toBe("Ana");
    expect(displayFirstName({ first_name: null, full_name: "Bojan Kostić" })).toBe("Bojan");
    expect(displayFirstName({ first_name: "  ", full_name: "Cara" })).toBe("Cara");
    expect(displayFirstName({ first_name: null, full_name: "   " })).toBe("Driver");
  });
});

describe("assembleLeaderboard — top five plus me", () => {
  const ranked = [row("d1", 1, 94.4), row("d2", 2, "91"), row("d3", 3, 88), row("d4", 4, 85), row("d5", 5, 80)];

  it("lists the top five by rank and appends the viewer when they placed lower", () => {
    const out = assembleLeaderboard(ranked, row("me", 9, 71.6), names, "me", 23);
    expect(out.entries.map((e) => [e.rank, e.first_name, e.score, e.is_me])).toEqual([
      [1, "Ana", 94, false], [2, "Bojan", 91, false], [3, "Cara", 88, false], [4, "Dmitri", 85, false], [5, "Eve", 80, false],
      [9, "Miki", 72, true],
    ]);
    expect(out).toMatchObject({ ...WEEK, cohort_size: 23, my_rank: 9 });
  });

  it("does not list the viewer twice when they are already in the top five", () => {
    const out = assembleLeaderboard([row("d1", 1, 94), row("me", 2, 92), row("d3", 3, 88)], row("me", 2, 92), names, "me", 3);
    expect(out.entries.filter((e) => e.is_me)).toHaveLength(1);
    expect(out.entries[1]).toMatchObject({ rank: 2, first_name: "Miki", is_me: true });
    expect(out.my_rank).toBe(2);
  });

  it("leaves the viewer off the board, with my_rank null, when they were not ranked that week", () => {
    const out = assembleLeaderboard(ranked, row("me", null, null), names, "me", 5);
    expect(out.entries.some((e) => e.is_me)).toBe(false);
    expect(out.my_rank).toBeNull();
  });

  it("never lets a sixth ranked row through, whatever order the rows arrive in", () => {
    const shuffled = [row("d6", 6, 70), ...ranked].reverse();
    const out = assembleLeaderboard(shuffled, null, names, "me", 6);
    expect(out.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("answers an empty fleet honestly", () => {
    expect(assembleLeaderboard([], null, names, "me", 0)).toEqual({
      week_start: null, week_end: null, cohort_size: 0, entries: [], my_rank: null,
    });
  });
});

describe("getDriverLeaderboard — every read is scoped to the org", () => {
  const has = (q: RecordedQuery, col: string, val: unknown) => q.filters().some((f) => f.col === col && f.val === val);

  it("reads the latest ranked week, its top five, the viewer, the cohort, and the names — all under org_id", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        driver_performance_weeks: (q) => {
          if (has(q, "driver_id", "me")) return { data: row("me", 7, 74), error: null };
          const isCount = q.ops.some((op) => op.method === "select" && (op.args[1] as { head?: boolean } | undefined)?.head);
          if (isCount) return { data: null, error: null, count: 12 };
          if (has(q, "week_start", WEEK.week_start)) return [row("d1", 1, 94), row("d2", 2, 91)];
          return [{ week_start: WEEK.week_start }];
        },
        drivers: (q) => {
          const ids = q.filters().find((f) => f.col === "id")?.val as string[];
          return [...names.entries()].filter(([id]) => ids.includes(id)).map(([id, n]) => ({ id, ...n }));
        },
      },
    });

    const out = await getDriverLeaderboard(rec.client as never, ORG, "me");
    expect(out.entries.map((e) => [e.rank, e.first_name, e.is_me])).toEqual([[1, "Ana", false], [2, "Bojan", false], [7, "Miki", true]]);
    expect(out.cohort_size).toBe(12);
    expectOrgScoped(rec, ORG);
    // The name lookup asks only for the ids on the board — never the whole roster.
    const nameQuery = rec.forTable("drivers")[0]!;
    expect(nameQuery.filters().find((f) => f.col === "id")?.val).toEqual(["d1", "d2", "me"]);
  });

  it("returns an empty board, without touching names, when no week has been ranked", async () => {
    const rec = createSupabaseRecorder({ tables: { driver_performance_weeks: [] } });
    const out = await getDriverLeaderboard(rec.client as never, ORG, "me");
    expect(out).toEqual({ week_start: null, week_end: null, cohort_size: 0, entries: [], my_rank: null });
    expect(rec.forTable("drivers")).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });
});
