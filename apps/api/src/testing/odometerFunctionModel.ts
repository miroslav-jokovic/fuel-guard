/**
 * 0507's `odometer_readings_for_periods`, modelled for the recorder (PLATFORM-RELIABILITY-PLAN D-RLY6):
 * per period bound and per (truck, counter), the last reading in `[floor, bound]`; per period, the count
 * over `(floor, to]`. Compared instant by instant, as Postgres compares `timestamptz`.
 *
 * The model is held to Postgres itself, pick by pick, in
 * `supabase/tests/odometer-readings-for-periods.test.mjs`; here it lets the readers' tests run against
 * the production path without a database. A row with a counter 0311's check refuses cannot exist in
 * the table, so the model never returns or counts one.
 *
 * ⚠ Fixtures should render instants the way Postgres does (`…+00:00`, trailing zeros trimmed), because
 * the distance rule compares them as TEXT against `toISOString()` bounds (`…Z`). At an exactly equal
 * instant `+` sorts before `.` and `Z` after it, so a `…Z` fixture reading ON a bound is "after" it to
 * the rule while the database calls it at-or-before — a disagreement production never sees.
 */
export interface OdometerFixtureRow {
  vehicle_id: string;
  reading_at: string;
  meters: number;
  source: string;
}

interface Args {
  p_org: string;
  p_periods: { from: string; to: string; floor: string }[];
}

const COUNTERS = new Set(["obd", "gps_distance", "gps_odometer"]);

export function odometerFunctionModel(rows: readonly OdometerFixtureRow[], orgId: string) {
  return (raw: unknown) => {
    const args = raw as Args;
    if (args.p_org !== orgId) return { rows: [], counts: args.p_periods.map(() => 0) };
    const valid = rows.filter((r) => COUNTERS.has(r.source));
    const ms = (s: string) => Date.parse(s);
    const picks = new Map<string, OdometerFixtureRow>();
    for (const p of args.p_periods) {
      for (const at of [p.from, p.to]) {
        const last = new Map<string, OdometerFixtureRow>();
        for (const r of valid) {
          if (ms(r.reading_at) < ms(p.floor) || ms(r.reading_at) > ms(at)) continue;
          const k = `${r.vehicle_id}|${r.source}`;
          const best = last.get(k);
          if (!best || ms(r.reading_at) > ms(best.reading_at)) last.set(k, r);
        }
        for (const r of last.values()) picks.set(`${r.vehicle_id}|${r.source}|${ms(r.reading_at)}`, r);
      }
    }
    const counts = args.p_periods.map(
      (p) => valid.filter((r) => ms(r.reading_at) > ms(p.floor) && ms(r.reading_at) <= ms(p.to)).length,
    );
    return { rows: [...picks.values()], counts };
  };
}

/** An instant as Postgres renders a `timestamptz` in UTC: `2026-07-10T00:00:00+00:00`, `…:39.8+00:00`. */
export function pgInstant(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-07-10T00:00:00.000Z
  const [whole, frac] = iso.slice(0, -1).split(".");
  const trimmed = (frac ?? "").replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""}+00:00`;
}
