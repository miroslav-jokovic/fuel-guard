import type { Dataset, HmtEntry, PackingGroup } from "./schema.js";

/**
 * `resolveHmtLine()` — the BOL↔library resolution algorithm (plan H6, LOCKED SPEC). Turns an extracted or
 * typed (id, psn, class, pg) line into a canonical `hmtRef` (`${entryId}#${pg ?? 'none'}`), or a NAMED
 * failure the caller routes to human review. It lives in `@hazmat/data` (not `@hazmat/engine` as the plan
 * originally wrote) because the resolution machinery already lives here and the engine — which never
 * resolves from text (callers pass pre-resolved `hmtRef`s) — cannot import this package (D3 boundary).
 * Pure: no I/O, no network, no clock.
 *
 * Design doctrine (Fellegi–Sunter / record-linkage for safety-critical domains): deterministic matching
 * with BLOCKING on the strongest key (prefix+id); a near-miss is clerical review, NEVER a lowered
 * threshold. There are NO similarity scores anywhere in the accept path — the table has real pairs where
 * fuzzy matching confidently picks the wrong product (Heptanes UN1206 / Hexanes UN1208; Petroleum crude
 * UN1267 / Petroleum distillates UN1268). Fuzzy ranking may ONLY order suggestions shown to a reviewer
 * after a failure. Every normalization here is a transform §172.101(c)(1)–(2) authorizes and nothing more.
 */

/** Bump on ANY change to the normalization ruleset — stored on every run so a verdict stays reproducible. */
export const PSN_NORMALIZER_VERSION = "1.4.0";

export type ResolveLineFailureReason =
  | "id_missing" // no parseable UN/NA id on the line
  | "id_prefix_ambiguous" // no prefix on paper and BOTH UN+NA exist as different materials
  | "id_not_found" // id not present in the dataset
  | "psn_no_match" // a name was given but no candidate under the id matches it
  | "psn_ambiguous" // >1 distinct material matches (after D/I collapse) — the id+name don't pin one
  | "pg_required_ambiguous" // entry has multiple pg-rows and the paper's PG can't select exactly one
  | "class_mismatch"; // a class was given and it contradicts the entry

export interface ResolveLineInput {
  /** As printed: "UN1203", "NA 1993", "1203", … Prefix optional (then UN is tried, then NA). */
  idText: string | null;
  psn: string | null;
  /** "3", "3 (6.1)", "Combustible liquid", … null = not provided (class check skipped). */
  hazardClass: string | null;
  pg: PackingGroup | null;
  /** The offeror's §173.150(f) election — INPUT, never inferred. Lets "Combustible liquid" satisfy a Class-3 PG III entry. */
  reclassedCombustible?: boolean;
}

export interface ResolveLineOk {
  ok: true;
  hmtRef: string;
  entryId: string;
  pg: PackingGroup | null;
  /** The printed/alternate name that matched (or the entry's PSN when resolved by id alone). */
  matchedName: string;
  normalizerVersion: string;
  /** Non-fatal review flags (resolution succeeded but the paper disagrees on a non-identifying field). */
  findings: ResolveLineFinding[];
}
export type ResolveLineFinding =
  | "pg_present_on_no_pg_entry" // Class 2 gas carries no PG, but the paper printed one
  | "pg_missing" // single-PG entry, no PG on the paper (resolved to the entry's PG)
  | "pg_mismatch" // single-PG entry, the paper's PG differs (resolved to the authoritative PG)
  | "row_chosen_by_class" // several rows share the name; the printed class picked one (D-RC4)
  | "row_chosen_by_pg"; // several rows share the name and class; the printed PG picked one (D-RC4)

export interface ResolveLineFail {
  ok: false;
  reason: ResolveLineFailureReason;
  normalizerVersion: string;
  /** Candidates for a reviewer to choose from (fuzzy-ranked ONLY here, never in the accept path). */
  candidates?: Array<{ entryId: string; psn: string; pg: PackingGroup | null }>;
}
export type ResolveLineResult = ResolveLineOk | ResolveLineFail;

/**
 * The parts of an `hmtRef` (`${entryId}#${pg ?? "none"}`, built below). An entry id may itself hold a "#" —
 * the dataset numbers repeated rows of one name `UN1950-aerosols#2` — so the ref splits at its LAST "#"; a
 * first-"#" split read UN1950 Division 2.1 as its 2.2 sibling (2026-10-19). @hazmat/engine parses the same
 * format for itself (D3 keeps the packages apart); @hazmat/golden's ref census holds the two to every entry.
 */
export function parseHmtRef(hmtRef: string): { entryId: string; pg: PackingGroup | null } {
  const at = hmtRef.lastIndexOf("#");
  if (at < 0) return { entryId: hmtRef, pg: null };
  const token = hmtRef.slice(at + 1);
  return { entryId: hmtRef.slice(0, at), pg: token === "none" ? null : (token as PackingGroup) };
}

// ── dataset index (hash blocking on prefix+id; build once per dataset version, memoize) ────────────
export interface DatasetIndex {
  version: string;
  byId: Map<string, HmtEntry[]>;
}
export function buildDatasetIndex(dataset: Dataset): DatasetIndex {
  const byId = new Map<string, HmtEntry[]>();
  for (const e of dataset.entries) {
    const key = `${e.idPrefix}${e.idNumber}`;
    const arr = byId.get(key);
    if (arr) arr.push(e);
    else byId.set(key, [e]);
  }
  return { version: dataset.version, byId };
}

// ── normalization (only §172.101(c)(1)–(2)-authorized transforms) ──────────────────────────────────
const LEADING_MODIFIERS = new Set(["waste", "rq", "hot"]);

/**
 * Normalize a shipping name for matching. `stripTrailingParenthetical` is passed true ONLY when the
 * candidate entry carries the G symbol (appended technical names are correct on G-entries); parentheticals
 * are load-bearing everywhere else ("Fuel oil (No. 2)", UN3475's ">10% ethanol"), so they are NOT stripped.
 */
export function normalizePsnForMatch(psn: string, stripTrailingParenthetical: boolean): string {
  let s = psn.toLowerCase();
  s = s.replace(/n\.?\s*o\.?\s*s\.?/g, "nos"); // n.o.s. / NOS / n o s → nos
  if (stripTrailingParenthetical) s = s.replace(/\([^)]*\)\s*$/, "");
  s = s.replace(/[.,;:()]/g, " ").replace(/\s+/g, " ").trim();
  let toks = s.split(" ").filter(Boolean);
  while (toks.length > 1 && LEADING_MODIFIERS.has(toks[0]!)) toks = toks.slice(1);
  return toks.join(" ");
}

/**
 * Singular/plural fold on every token — safe because matching only ever runs WITHIN an id block, and a fold
 * that made two names of one block equal would surface as `psn_ambiguous`, never as a pick. It used to fold
 * the final token only, which on an n.o.s. entry is "nos": "FLAMMABLE LIQUID, N.O.S." then failed UN1993's
 * "Flammable liquids, n.o.s." and the audit told a shipper to reprint a name §172.101(c)(1) allows
 * (owner's calculator test, 2026-10-19). Normalizer 1.1.0.
 */
function depluralize(s: string): string {
  return s.split(" ").map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t)).join(" ");
}

function nameMatches(candidateName: string, inputPsn: string, gEntry: boolean): boolean {
  const c = normalizePsnForMatch(candidateName, gEntry);
  const i = normalizePsnForMatch(inputPsn, gEntry);
  if (c === i) return true;
  return depluralize(c) === depluralize(i);
}

// ── id parsing ──────────────────────────────────────────────────────────────────────────────────
function parseIdText(idText: string): { prefix: "UN" | "NA" | null; idNumber: string } | null {
  // The prefix may be glued to the digits ("UN1993") or spaced ("NA 1993"), so anchor at the start rather
  // than use a word boundary (there is no \b between "UN" and "1993").
  const prefixMatch = /^\s*(UN|NA)/i.exec(idText);
  const digits = idText.replace(/[^0-9]/g, "");
  if (digits.length < 1 || digits.length > 4) return null;
  return { prefix: prefixMatch ? (prefixMatch[1]!.toUpperCase() as "UN" | "NA") : null, idNumber: digits };
}

// ── class check ───────────────────────────────────────────────────────────────────────────────────
function classMatches(entry: HmtEntry, printedClass: string, reclassedCombustible: boolean): boolean {
  // §172.202(a)(3)(i): "The words 'Class' or 'Division' may precede the primary and subsidiary numbers" — a
  // Henkel master BOL prints "CLASS 8(6.1)" (production read a4119634, 2026-10-21).
  const norm = printedClass.trim().toLowerCase().replace(/^(?:class|division)\s+/, "");
  // "Samples, explosive" (UN0190) carries no class in Column (3): §173.56 assigns the division with the approval,
  // and the paper prints it. Any Class 1 division is the entry's; anything else is not an explosive sample. Every
  // correct printing was refused here (the paper audit's golden census, READER-CORRECTNESS-PLAN RC5) — the RC1
  // census printed the table's empty class and so never asked.
  if (entry.hazardClass == null) return /^(?:class\s+|division\s+)?1(?:\.[1-6][a-l]?)?$/i.test(norm);
  const entryClass = (entry.hazardClass ?? "").trim().toLowerCase();

  if (/combustible/.test(norm)) {
    if (entryClass.includes("comb")) return true; // the entry itself is a combustible-liquid entry
    // §173.150(f): a Class-3 PG III material may be reclassed Combustible — only on the offeror's election.
    return entryClass === "3" && entry.pgRows.some((r) => r.pg === "III") && reclassedCombustible;
  }

  const sub = printedSubsidiaries(norm); // "3 (6.1)", "1.3c (6.1)"
  if (sub) {
    if (sub.primary !== entryClass) return false;
    const entrySubs = entry.subsidiaryClasses.map((s) => s.toLowerCase());
    return sub.subs.every((w) => entrySubs.includes(w));
  }
  return norm === entryClass;
}

/** The primary and the parenthesised subsidiaries of a printed class, lower-cased; null when none are printed. */
function printedSubsidiaries(norm: string): { primary: string; subs: string[] } | null {
  const m = /^([0-9.]+[a-z]?)\s*\(([0-9.,\s]+)\)$/.exec(norm);
  if (!m) return null;
  return { primary: m[1]!, subs: m[2]!.split(/[,\s]+/).filter(Boolean) };
}

/**
 * Whether the printed class names the entry's subsidiaries exactly — the primary alone where the entry has
 * none, or every subsidiary where it has them. Where rows of one name differ only in their subsidiaries (UN1230
 * Methanol's D row "3" and I row "3 (6.1)"; UN1831 fuming sulfuric acid under and over 30 % free SO3), the
 * printed class is what tells them apart (D-PC1, 2026-10-26): "3" is the D row's own printing and the I row's
 * omission, and §172.202(a)(3) lets a subsidiary be omitted only where its label is not required — so the row
 * printed exactly wins, recorded as `row_chosen_by_class` (D-RC4), and rows that fit only loosely are kept
 * only when none fits exactly.
 */
function classExact(entry: HmtEntry, printedClass: string): boolean {
  const norm = printedClass.trim().toLowerCase().replace(/^(?:class|division)\s+/, "");
  const printed = printedSubsidiaries(norm)?.subs ?? [];
  const entrySubs = entry.subsidiaryClasses.map((s) => s.toLowerCase());
  return printed.length === entrySubs.length && printed.every((w) => entrySubs.includes(w));
}

// ── D/I collapse: entries that differ ONLY by symbol are the same material (both valid domestically) ──
// It is NOT enough to share class/PG — UN1202 holds three DIFFERENT products (Diesel fuel, Gas oil,
// Heating oil) at the same class/PG, and those must stay ambiguous without a PSN. Same material requires
// the same printed name too; only then are the remaining differences (the D/I symbols) transport-regime
// variants of one substance, both valid on a domestic highway move.
function sameMaterial(a: HmtEntry, b: HmtEntry): boolean {
  const pgs = (e: HmtEntry) => e.pgRows.map((r) => r.pg ?? "none").sort().join(",");
  return (
    normalizePsnForMatch(a.psnPrinted, false) === normalizePsnForMatch(b.psnPrinted, false) &&
    (a.hazardClass ?? "") === (b.hazardClass ?? "") &&
    pgs(a) === pgs(b) &&
    a.subsidiaryClasses.slice().sort().join(",") === b.subsidiaryClasses.slice().sort().join(",")
  );
}
/** Collapse symbol-only variants to a deterministic canonical entry; return null if they truly differ. */
function collapse(entries: HmtEntry[]): HmtEntry | null {
  if (entries.length === 1) return entries[0]!;
  const first = entries[0]!;
  if (!entries.every((e) => sameMaterial(e, first))) return null;
  return entries.slice().sort((a, b) => a.entryId.localeCompare(b.entryId))[0]!;
}

const asCandidateList = (entries: HmtEntry[]) =>
  entries.map((e) => ({ entryId: e.entryId, psn: e.psnPrinted, pg: e.pgRows[0]?.pg ?? null }));

// ── the resolver ────────────────────────────────────────────────────────────────────────────────
export function resolveHmtLine(index: DatasetIndex, input: ResolveLineInput): ResolveLineResult {
  const nv = PSN_NORMALIZER_VERSION;
  const fail = (reason: ResolveLineFailureReason, candidates?: ResolveLineFail["candidates"]): ResolveLineFail => ({
    ok: false, reason, normalizerVersion: nv, ...(candidates ? { candidates } : {}),
  });

  // 1 & 2. Normalize the id and block on (prefix, idNumber).
  const parsed = input.idText ? parseIdText(input.idText) : null;
  if (!parsed) return fail("id_missing");

  // 3 & 4. Match the PSN within a blocked candidate set (or resolve by id alone when unambiguous).
  const hasPsn = input.psn != null && input.psn.trim() !== "";
  const byName = (block: HmtEntry[]) => {
    const hits: HmtEntry[] = [];
    let name = "";
    for (const e of block) {
      const gEntry = e.symbols.includes("G");
      const hit = [e.psnPrinted, ...e.psnAlternates].find((n) => nameMatches(n, input.psn!, gEntry));
      if (hit) { hits.push(e); if (!name) name = hit; }
    }
    return { hits, name };
  };

  let candidates: HmtEntry[];
  if (parsed.prefix) {
    candidates = index.byId.get(`${parsed.prefix}${parsed.idNumber}`) ?? [];
    if (candidates.length === 0) return fail("id_not_found");
  } else {
    const un = index.byId.get(`UN${parsed.idNumber}`) ?? [];
    const na = index.byId.get(`NA${parsed.idNumber}`) ?? [];
    if (un.length && na.length) {
      // The spec's step 1 is "both RESOLVING → ambiguous", not "both existing": each key space is still
      // blocked on its own and the printed name decides which one holds the line — "1760, Corrosive liquid
      // N.O.S." is UN1760, never NA1760 "Compounds, cleaning liquid". With no name, or a name both blocks
      // hold, nothing decides. The missing prefix is still the shipper's error (`paper_sequence`).
      if (!hasPsn) return fail("id_prefix_ambiguous", asCandidateList([...un, ...na]));
      const onUn = byName(un).hits.length > 0;
      const onNa = byName(na).hits.length > 0;
      if (onUn && onNa) return fail("id_prefix_ambiguous", asCandidateList([...un, ...na]));
      if (!onUn && !onNa) return fail("psn_no_match", asCandidateList([...un, ...na]));
      candidates = onUn ? un : na;
    } else {
      candidates = un.length ? un : na;
      if (candidates.length === 0) return fail("id_not_found");
    }
  }

  let matched: HmtEntry[];
  let matchedName = "";
  if (hasPsn) {
    ({ hits: matched, name: matchedName } = byName(candidates));
    if (matched.length === 0) return fail("psn_no_match", asCandidateList(candidates));
  } else {
    matched = candidates;
  }

  // 5. Collapse D/I symbol-only variants. Where the rows still differ, they are the table's rows that share
  // one name and are told apart by italic qualifiers the paper never prints — UN1950 Aerosols (2.1 / 2.2),
  // UN1005 Ammonia, anhydrous (2.2 domestic / 2.3), UN2790 Acetic acid solution (PG II / III). The census
  // (resolveLine.census.test.ts) found every correct printing of ten such numbers refused here. The printed
  // class, then the printed PG, picks the row (owner, Q-RC3, 2026-10-19) — never a guess: a value that fits
  // no row, or still fits two, refuses. The table then no longer refutes the class on its own, since it
  // took the class from the paper, so the pick is a finding a review must see (D-RC4).
  const rowFindings: ResolveLineFinding[] = [];
  let entry = collapse(matched);
  if (!entry) {
    let rows = matched;
    if (input.hazardClass != null && input.hazardClass.trim() !== "") {
      let byClass = rows.filter((e) => classMatches(e, input.hazardClass!, input.reclassedCombustible ?? false));
      if (byClass.length === 0) return fail("class_mismatch", asCandidateList(rows));
      // The exactly printed row wins only among rows the printed PG also fits: nitric acid "8, PG I" names the
      // ≥70 % row (8 (5.1), PG I) with its subsidiary left off, not the <65 % row ("8", PG II) printed exactly.
      // …and only where the rows differ in their subsidiaries at all: two rows of one class and no subsidiary
      // (UN2790 acetic acid, PG II and III) are the PG's to tell apart, and the finding says so.
      const subsDiffer = new Set(byClass.map((e) => e.subsidiaryClasses.slice().sort().join(","))).size > 1;
      const exact = byClass.filter((e) => classExact(e, input.hazardClass!) && (input.pg == null || e.pgRows.some((r) => r.pg === input.pg)));
      if (subsDiffer && exact.length > 0 && exact.length < byClass.length) byClass = exact;
      if (byClass.length < rows.length) { rowFindings.push("row_chosen_by_class"); rows = byClass; }
      entry = collapse(rows);
    }
    if (!entry && hasPsn) {
      // A row whose own Column (2) name was printed outranks one that only lists it as an alternate:
      // UN2037 "Gas cartridges" is its own row and also an alternate of "Receptacles, small, containing gas".
      const own = rows.filter((e) => nameMatches(e.psnPrinted, input.psn!, e.symbols.includes("G")));
      if (own.length > 0 && own.length < rows.length) rows = own;
      entry = collapse(rows);
    }
    if (!entry && input.pg != null) {
      const byPg = rows.filter((e) => e.pgRows.some((r) => r.pg === input.pg));
      if (byPg.length > 0 && byPg.length < rows.length) { rowFindings.push("row_chosen_by_pg"); rows = byPg; }
      entry = collapse(rows);
    }
    if (!entry) return fail("psn_ambiguous", asCandidateList(rows));
  }
  if (!matchedName) matchedName = entry.psnPrinted;

  // 6. PG — conditional, not always mandatory.
  const pgs = entry.pgRows.map((r) => r.pg);
  const findings: ResolveLineFinding[] = [...rowFindings];
  let resolvedPg: PackingGroup | null;
  if (pgs.length === 1 && pgs[0] === null) {
    resolvedPg = null; // Class 2 gas — no PG exists
    if (input.pg != null) findings.push("pg_present_on_no_pg_entry");
  } else if (pgs.length === 1) {
    resolvedPg = pgs[0]!;
    if (input.pg == null) findings.push("pg_missing");
    else if (input.pg !== resolvedPg) findings.push("pg_mismatch");
  } else {
    if (input.pg == null || !pgs.includes(input.pg)) return fail("pg_required_ambiguous", asCandidateList([entry]));
    resolvedPg = input.pg;
  }

  // 7. Class — normalized comparison (skipped when the paper carries no class).
  if (input.hazardClass != null && input.hazardClass.trim() !== "") {
    if (!classMatches(entry, input.hazardClass, input.reclassedCombustible ?? false)) {
      return fail("class_mismatch", asCandidateList([entry]));
    }
  }

  return {
    ok: true,
    hmtRef: `${entry.entryId}#${resolvedPg ?? "none"}`,
    entryId: entry.entryId,
    pg: resolvedPg,
    matchedName,
    normalizerVersion: nv,
    findings,
  };
}
