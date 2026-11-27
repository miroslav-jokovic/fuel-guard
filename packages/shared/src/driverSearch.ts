import type { Vehicle } from "./fleet.js";

/**
 * One rule for "find a driver" (HOME-TIME-VISIBILITY-PLAN D-HT22) — the Drivers list, the Home time tab,
 * the home-time drawer's driver picker. Pure, so the three agree and the cases are tested once.
 *
 * ── WHY THE SEARCH WAS REWRITTEN (measured on production 2026-11-23) ────────────────────────────
 * The Drivers list searched name, employee ID, phone and Samsara username as substrings, and NOT the
 * truck its own Vehicles column shows. Typing each of the 178 active trucks' unit numbers found that
 * truck's own driver for 2 of them and SOME OTHER driver for 138: "676" is inside somebody's phone
 * number. A search that answers confidently and wrongly is worse than one that answers nothing.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 * - **Names** (full name, Samsara username) match as a substring, case-insensitive — as before.
 * - **Identifiers** (truck units, employee ID) match a whole TOKEN or the start of one: "676" finds
 *   676 and "676 - OLD", never 1676; "67" lists 670–679 while it is being typed. A leading "truck",
 *   "unit" or "#" is the reader saying which field they mean: the rest is matched against units only.
 * - **Phone** matches by digits, and only for a term of digits and separators with at least
 *   `PHONE_MIN_DIGITS` digits — so a unit number never reaches a phone, and "555-0134" finds
 *   "(312) 555-0134".
 */
export interface DriverSearchFields {
  names: readonly (string | null | undefined)[];
  ids?: readonly (string | null | undefined)[];
  units?: readonly (string | null | undefined)[];
  phones?: readonly (string | null | undefined)[];
}

/** A term this long in digits may be a phone number; a unit number is shorter (the fleet's are 3). */
export const PHONE_MIN_DIGITS = 4;

const UNIT_PREFIX = /^(?:truck|unit|#)\s*#?\s*/;
const PHONE_TERM = /^[\d\s()+.-]+$/;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const digits = (s: string) => s.replace(/\D/g, "");
const present = (xs: readonly (string | null | undefined)[] | undefined): string[] =>
  (xs ?? []).filter((x): x is string => typeof x === "string" && x.trim() !== "");

/** Does `term` name this identifier — the whole value, a whole token, or the start of one? */
function idMatch(term: string, value: string): 0 | 1 | null {
  const v = norm(value);
  const toks = tokens(value);
  if (v === term || toks.includes(term)) return 0;
  if (v.startsWith(term) || toks.some((t) => t.startsWith(term))) return 1;
  return null;
}

/**
 * How well `rawTerm` names this driver: 0 an exact truck or ID, 1 the start of one, 2 a name that
 * starts with it, 3 anything else that matches; null when it does not match. An empty term matches
 * everybody at 3. The picker sorts by it; a list only asks whether it is null.
 */
export function driverSearchRank(rawTerm: string, f: DriverSearchFields): number | null {
  let term = norm(rawTerm);
  if (!term) return 3;
  const unitsOnly = UNIT_PREFIX.test(term);
  if (unitsOnly) {
    term = term.replace(UNIT_PREFIX, "").trim();
    if (!term) return 3;
  }
  let best: number | null = null;
  const take = (r: number | null) => {
    if (r !== null && (best === null || r < best)) best = r;
  };

  for (const u of present(f.units)) take(idMatch(term, u));
  if (unitsOnly) return best;

  for (const id of present(f.ids)) take(idMatch(term, id));
  for (const n of present(f.names)) {
    const v = norm(n);
    if (v.startsWith(term) || tokens(n).some((t) => t.startsWith(term))) take(2);
    else if (v.includes(term)) take(3);
  }
  if (PHONE_TERM.test(term)) {
    const d = digits(term);
    if (d.length >= PHONE_MIN_DIGITS && present(f.phones).some((p) => digits(p).includes(d))) take(3);
  }
  return best;
}

export const matchesDriverSearch = (term: string, f: DriverSearchFields): boolean => driverSearchRank(term, f) !== null;

/**
 * The trucks each driver sits in — either seat, retired trucks left out — in unit order. The same
 * seats `seatedDriverIds` counts: a co-driver is in the truck (#1471), and the Drivers list's Vehicles
 * column and its search both read this, so the search finds exactly what the column shows.
 */
export function unitsByDriver(
  vehicles: readonly Pick<Vehicle, "unit_number" | "assigned_driver_id" | "co_driver_id" | "status">[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string | null | undefined, unit: string) => {
    if (!id) return;
    const list = out.get(id);
    if (!list) out.set(id, [unit]);
    else if (!list.includes(unit)) list.push(unit);
  };
  for (const v of vehicles) {
    if (v.status === "retired" || !v.unit_number?.trim()) continue;
    add(v.assigned_driver_id, v.unit_number.trim());
    add(v.co_driver_id, v.unit_number.trim());
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}
