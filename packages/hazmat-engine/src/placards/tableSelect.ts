/**
 * Choosing between the two §172.504 placarding-table rows that share a class number (F-P1).
 *
 * WHY THIS EXISTS. Two class/division values appear in BOTH Table 1 and Table 2, separated only by
 * prose inside the class string:
 *
 *   6.1  "…(material poisonous by inhalation…)"        vs  "…(other than material poisonous by inhalation)"
 *   5.2  "…Type B, liquid or solid, temperature controlled"  vs  "…(Other than …)"
 *
 * `compute.ts` matched rows on the leading numeric token, which strips exactly that qualifier, so both
 * candidates collapsed to one key, the match count came back as 2, and the determination was withheld
 * with the message "outside the fuel scope". The effect: **every Class 6.1 material in the Hazardous
 * Materials Table — 534 of 2,479 entries, the largest class in it — has never produced a placard**,
 * despite D4 listing non-PIH 6.1 as in scope. Class 5.2 (21 entries) did the same.
 *
 * The qualifier is decidable from the entry, so decide it from the entry — never from the class number.
 *
 * HOW EACH IS DECIDED
 *
 * 6.1 — §172.102(c)(1) special provisions. Codes 1–4 ASSERT the material is poisonous by inhalation
 * (Hazard Zones A–D respectively; 1 and 2 reference §173.133(a), the Division 6.1 zone rule). Code 5
 * does NOT: it reads "**If** this material meets the definition for a material poisonous by inhalation
 * …, a shipping name must be selected which identifies the inhalation hazard" — the answer depends on
 * the shipper's chosen name, which the table cannot tell us. So code 5 is UNDETERMINABLE, not "no".
 * Getting this backwards would under-placard a PIH material, which is the one error this engine exists
 * to prevent (D2).
 *
 * The PSN text is used as a second, independent PIH signal. It can only ever push a material TOWARD
 * Table 1 (which is blocked as out of scope), never away from it — the safe direction.
 *
 * 5.2 — the Table 1 row is exactly "Organic peroxide, Type B, … temperature controlled", and the HMT
 * proper shipping names say so literally ("Organic peroxide type B, liquid, temperature controlled").
 * Both conditions must hold; type C–F, and type B without temperature control, are Table 2.
 *
 * This module is deliberately data-shaped and dependency-free so it can be unit-tested against the real
 * dataset rows without constructing a whole LoadInput.
 */

export interface TableSelectEntry {
  psnPrinted: string;
  hazardClass: string | null;
  pgRows: { specialProvisions?: string[] }[];
}

export interface TableSelectSpec {
  classOrDivision: string;
  table: 1 | 2;
}

export type TableSelection<S extends TableSelectSpec> =
  | { ok: true; spec: S; because: string }
  | { ok: false; reason: string; citation: string };

/** §172.102(c)(1) codes that ASSERT poison-by-inhalation. Code 5 is deliberately absent — see above. */
const PIH_ASSERTING_PROVISIONS = new Set(["1", "2", "3", "4"]);
/** §172.102(c)(1) code 5 — conditional on the shipper's name choice; decides nothing on its own. */
const PIH_CONDITIONAL_PROVISION = "5";

const PIH_PSN_PATTERN = /poisonous by inhalation|toxic by inhalation|inhalation hazard/i;

function provisionsOf(entry: TableSelectEntry): Set<string> {
  const out = new Set<string>();
  for (const row of entry.pgRows ?? []) for (const sp of row.specialProvisions ?? []) out.add(sp);
  return out;
}

function pick<S extends TableSelectSpec>(matches: S[], table: 1 | 2, because: string): TableSelection<S> {
  const spec = matches.find((m) => m.table === table);
  return spec
    ? { ok: true, spec, because }
    : { ok: false, reason: `no Table ${table} row exists for this class`, citation: "49 CFR 172.504" };
}

function selectDivision61<S extends TableSelectSpec>(
  entry: TableSelectEntry,
  matches: S[],
): TableSelection<S> {
  const sps = provisionsOf(entry);
  const asserting = [...sps].filter((sp) => PIH_ASSERTING_PROVISIONS.has(sp));
  if (asserting.length > 0) {
    return pick(matches, 1, `special provision ${asserting.join("/")} declares this poisonous by inhalation`);
  }
  if (PIH_PSN_PATTERN.test(entry.psnPrinted)) {
    return pick(matches, 1, "the proper shipping name identifies an inhalation hazard");
  }
  if (sps.has(PIH_CONDITIONAL_PROVISION)) {
    return {
      ok: false,
      reason:
        "special provision 5 applies — whether this is a material poisonous by inhalation depends on the " +
        "shipping name the shipper selected, which the Hazardous Materials Table cannot settle",
      citation: "49 CFR 172.102(c)(1) special provision 5",
    };
  }
  return pick(matches, 2, "no inhalation-hazard special provision and no inhalation-hazard shipping name");
}

function selectDivision52<S extends TableSelectSpec>(
  entry: TableSelectEntry,
  matches: S[],
): TableSelection<S> {
  const psn = entry.psnPrinted;
  const isTypeB = /\btype\s*B\b/i.test(psn);
  const isTempControlled = /temperature[-\s]?controlled/i.test(psn);
  return isTypeB && isTempControlled
    ? pick(matches, 1, "Type B organic peroxide, temperature controlled")
    : pick(matches, 2, "not a temperature-controlled Type B organic peroxide");
}

/**
 * Pick the one placarding-table row that applies to this entry.
 *
 * `matches` is every row whose leading class token equals `key`. One match is the ordinary case and is
 * returned as-is. Two means the class appears in both tables and the qualifier decides. Zero, or a
 * class we have no disambiguation rule for, fails closed with a reason a reviewer can act on.
 */
export function selectPlacardRow<S extends TableSelectSpec>(
  key: string,
  entry: TableSelectEntry,
  matches: S[],
): TableSelection<S> {
  if (matches.length === 1) return { ok: true, spec: matches[0] as S, because: "single matching table row" };
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `class "${entry.hazardClass ?? key}" does not appear in either placarding table`,
      citation: "49 CFR 172.504",
    };
  }
  if (key === "6.1") return selectDivision61(entry, matches);
  if (key === "5.2") return selectDivision52(entry, matches);
  return {
    ok: false,
    reason: `class "${entry.hazardClass ?? key}" matches ${matches.length} placarding-table rows and this engine has no rule to tell them apart`,
    citation: "49 CFR 172.504",
  };
}

/**
 * Does the table itself assert this material is poisonous by inhalation?
 *
 * Used twice: to pick the 6.1 table row, and by §172.505(a), where a Table 2 material carrying a
 * subsidiary inhalation hazard needs a POISON INHALATION HAZARD placard **in addition** to its own.
 * Special provision 5 is excluded on purpose — it is conditional on the shipper's name choice.
 */
export function assertsPoisonInhalation(entry: TableSelectEntry): boolean {
  const sps = provisionsOf(entry);
  return [...sps].some((sp) => PIH_ASSERTING_PROVISIONS.has(sp)) || PIH_PSN_PATTERN.test(entry.psnPrinted);
}

/** True when the Table 2 choice rests only on the absence of a PIH special provision (see D2). */
export function pihRestsOnAbsence(key: string, entry: TableSelectEntry): boolean {
  return key === "6.1" && !assertsPoisonInhalation(entry);
}
