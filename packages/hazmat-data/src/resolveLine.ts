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
export const PSN_NORMALIZER_VERSION = "1.0.0";

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
  | "pg_mismatch"; // single-PG entry, the paper's PG differs (resolved to the authoritative PG)

export interface ResolveLineFail {
  ok: false;
  reason: ResolveLineFailureReason;
  normalizerVersion: string;
  /** Candidates for a reviewer to choose from (fuzzy-ranked ONLY here, never in the accept path). */
  candidates?: Array<{ entryId: string; psn: string; pg: PackingGroup | null }>;
}
export type ResolveLineResult = ResolveLineOk | ResolveLineFail;

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

/** Singular/plural fold on the final token — safe because matching only ever runs WITHIN an id block. */
function depluralize(s: string): string {
  const toks = s.split(" ");
  const last = toks[toks.length - 1];
  if (last && last.length > 3 && last.endsWith("s")) toks[toks.length - 1] = last.slice(0, -1);
  return toks.join(" ");
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
  const norm = printedClass.trim().toLowerCase();
  const entryClass = (entry.hazardClass ?? "").trim().toLowerCase();

  if (/combustible/.test(norm)) {
    if (entryClass.includes("comb")) return true; // the entry itself is a combustible-liquid entry
    // §173.150(f): a Class-3 PG III material may be reclassed Combustible — only on the offeror's election.
    return entryClass === "3" && entry.pgRows.some((r) => r.pg === "III") && reclassedCombustible;
  }

  const sub = /^([0-9.]+)\s*\(([0-9.,\s]+)\)$/.exec(norm); // "3 (6.1)"
  if (sub) {
    if (sub[1] !== entryClass) return false;
    const wanted = sub[2]!.split(/[,\s]+/).filter(Boolean);
    const entrySubs = entry.subsidiaryClasses.map((s) => s.toLowerCase());
    return wanted.every((w) => entrySubs.includes(w));
  }
  return norm === entryClass;
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

  let candidates: HmtEntry[];
  if (parsed.prefix) {
    candidates = index.byId.get(`${parsed.prefix}${parsed.idNumber}`) ?? [];
    if (candidates.length === 0) return fail("id_not_found");
  } else {
    const un = index.byId.get(`UN${parsed.idNumber}`) ?? [];
    const na = index.byId.get(`NA${parsed.idNumber}`) ?? [];
    if (un.length && na.length) return fail("id_prefix_ambiguous", asCandidateList([...un, ...na]));
    candidates = un.length ? un : na;
    if (candidates.length === 0) return fail("id_not_found");
  }

  // 3 & 4. Match the PSN within the blocked candidate set (or resolve by id alone when unambiguous).
  const hasPsn = input.psn != null && input.psn.trim() !== "";
  let matched: HmtEntry[];
  let matchedName = "";
  if (hasPsn) {
    matched = [];
    for (const e of candidates) {
      const gEntry = e.symbols.includes("G");
      const hit = [e.psnPrinted, ...e.psnAlternates].find((name) => nameMatches(name, input.psn!, gEntry));
      if (hit) { matched.push(e); if (!matchedName) matchedName = hit; }
    }
    if (matched.length === 0) return fail("psn_no_match", asCandidateList(candidates));
  } else {
    matched = candidates;
  }

  // 5. Collapse D/I symbol-only variants; anything left over is a genuine ambiguity.
  const entry = collapse(matched);
  if (!entry) return fail("psn_ambiguous", asCandidateList(matched));
  if (!matchedName) matchedName = entry.psnPrinted;

  // 6. PG — conditional, not always mandatory.
  const pgs = entry.pgRows.map((r) => r.pg);
  const findings: ResolveLineFinding[] = [];
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
