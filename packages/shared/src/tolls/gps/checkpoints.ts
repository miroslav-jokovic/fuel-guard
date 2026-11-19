/**
 * The places and printed times a toll line can be checked at (TOLLS-PER-TRUCK-PLAN D-TL14, D-TL21). Pure.
 *
 * ── WHAT NAMES A PLAZA ─────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-19 on the owner's 18 statements: every provider prints an exit plaza and an exit
 * time; E-ZPass also prints the entry plaza and time on a closed road (2,802 of 14,088 lines); K-TAG
 * prints a location beside its zone code (603 locations over 578 codes, so the code alone joins plazas
 * that are not one place); no provider prints a direction except ExpressToll's lane, on 218 of 831
 * lines. So a plaza is provider + agency + plaza + location, and the role: an entry plaza is learned
 * apart from the exit plaza with the same code, because nothing measured says they stand in one place.
 *
 * ── A PRINTED TIME IS A WALL CLOCK, AND SOME WALL CLOCKS ARE TWO INSTANTS ────────────────────────
 * Statements print local time with no zone (D-TL4). On the autumn night 01:00–01:59 happens twice and
 * on the spring night 02:00–02:59 never happens. `instantsOf` says so instead of picking one, which
 * `wallClockToUtc` must do for its callers.
 */
import { wallClockInZone, wallClockToUtc, type WallClock } from "../../calendarDay.js";
import type { TollProvider } from "../tollTags.js";

export const TOLL_CHECKPOINT_ROLES = ["exit", "entry"] as const;
export type TollCheckpointRole = (typeof TOLL_CHECKPOINT_ROLES)[number];

/** A stored toll line, as much of it as the GPS check needs. */
export interface TollLineForGps {
  id: string;
  provider: TollProvider;
  kind: string;
  tagNumber: string | null;
  plate: string | null;
  agency: string | null;
  entryPlaza: string | null;
  entryAt: string | null;
  exitPlaza: string | null;
  exitAt: string | null;
  location: string | null;
}

export interface TollCheckpoint {
  lineId: string;
  role: TollCheckpointRole;
  plazaKey: string;
  provider: TollProvider;
  agency: string | null;
  /** The printed local time, `YYYY-MM-DDTHH:MM[:SS]`. */
  local: string;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** The plaza's name in `toll_plazas.plaza_key`. */
export function plazaKeyOf(provider: TollProvider, role: TollCheckpointRole, agency: string | null, plaza: string, location: string | null): string {
  return [provider, role, norm(agency), norm(plaza), norm(location)].join("|");
}

/** Every place a toll line can be checked: its exit, and its entry when one is printed. Non-tolls have none. */
export function checkpointsOf(line: TollLineForGps): TollCheckpoint[] {
  if (line.kind !== "toll") return [];
  const out: TollCheckpoint[] = [];
  const add = (role: TollCheckpointRole, plaza: string | null, at: string | null, location: string | null) => {
    if (!norm(plaza) || !at || !parseLocal(at)) return;
    out.push({ lineId: line.id, role, plazaKey: plazaKeyOf(line.provider, role, line.agency, plaza!, location), provider: line.provider, agency: line.agency, local: at });
  };
  add("exit", line.exitPlaza, line.exitAt, line.location);
  add("entry", line.entryPlaza, line.entryAt, null);
  return out;
}

/** `YYYY-MM-DDTHH:MM[:SS]` → its wall clock, or null. */
export function parseLocal(local: string): WallClock | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

const same = (a: WallClock, b: WallClock) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;

const HOUR = 3_600_000;

/**
 * Every instant at which a clock in `zone` read `local`: one on an ordinary day, two in the autumn's
 * repeated hour, none in the spring's skipped hour.
 */
export function instantsOf(local: string, zone: string): number[] {
  const wc = parseLocal(local);
  if (!wc) return [];
  const t = wallClockToUtc(wc, zone);
  return [t - HOUR, t, t + HOUR].filter((x) => same(wallClockInZone(new Date(x), zone), wc));
}

/** The local calendar day the toll was printed on (for "tolls on 2 different days"). */
export const dayOfLocal = (local: string): string => local.slice(0, 10);
