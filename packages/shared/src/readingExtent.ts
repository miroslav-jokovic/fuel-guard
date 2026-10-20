import { packageTypeFromPrinted } from "./hazmatPackaging.js";

/**
 * Two readings of one free-text CELL that stop at different places (READER-CORRECTNESS-PLAN R-M2).
 *
 * Production read 350d2f27 (2026-10-19, Mayo Products BOL 14182): both readers read every element of both
 * hazmat descriptions alike, but pass A carried the cell's trailing commercial text ("UN1824, SODIUM
 * HYDROXIDE, SOLUTION 8, PGII, CAUSTIC SODA 50% 3600# TOTE") and the packaging cell's item-code line ("8
 * 3600LBTOTE FG00035-3600T"), while pass B stopped at the basic description and at the tote. Compared as
 * text they disagree, and every audit rule that reads the description or the packaging answered "confirm
 * it first" — 12 of that read's 13 stops, on a paper both readers had read right.
 *
 * So two readings of these cells AGREE when one is the other plus a tail that carries no regulated fact:
 *   - the shorter reading is non-empty and is the longer one's prefix up to a field boundary (", ", " ",
 *     "; ") — formatting folded first, by the one comparison every field uses (`normalisedForAgreement`);
 *   - the tail holds no token any §172.202/§172.203 element is made of (`REGULATED`, below). Pass B could
 *     have stopped one word short of an "RQ" or a "Ltd Qty": that is a real disagreement, and stays one;
 *   - for packaging, the count it leads with and the package type it reads as are the same.
 * A `marks` list agrees when one list is the other plus marks that carry no regulated token.
 *
 * Never "one is a prefix of the other" alone, and never fuzzy: any other difference is a disagreement for a
 * person. The audit still judges such a field under BOTH extents and refuses a rule whose answer moves
 * with the tail (`paperAudit.ts`), so a commercial tail that matters to a rule this list does not foresee
 * stops that rule, and only that rule — an EPA waste code ("D001") is one: §172.203(k)(2)(i) lets it stand
 * for a hazardous waste's technical name, and no list of words can hold every code.
 *
 * WHY A LIST HERE AND NOT THE ENGINE'S. `@silvicom/shared` takes no `@hazmat/*` dependency (hazmatApi.ts),
 * and this list is wider than any one rule's mark: it names everything an element of a basic description
 * or an additional description is spelled with, not only what a rule tests for. The engine's own marks
 * (LQ_RX, RQ, Marine Pollutant) are held inside it by `readingExtent.property.test.ts`.
 */

const REGULATED: readonly RegExp[] = [
  /(?<![A-Z0-9])(?:UN|NA)\s*\d{4}(?!\d)/, // §172.202(a)(1) id
  /(?<![A-Z])RQ(?![A-Z])/, /\bREPORTABLE\b/, // §172.203(c)
  /LIMITED/, /LTD/, /(?<![A-Z])LQ(?![A-Z])/, /QTY/, // §172.203(b)
  /\bEXCEPTED\b/, /(?<![A-Z])EQ(?![A-Z])/, // §173.4a
  /\bMARINE\b/, /\bPOLLUTANT\b/, /(?<![A-Z])MP(?![A-Z])/, // §172.203(l)
  /\bINHALATION\b/, /\bPOISON/, /\bTOXIC\b/, /\bZONE\b/, // §172.203(m)
  /\bHOT\b/, /\bWASTE\b/, /\bRESIDUE\b/, /\bEMPTY\b/, // §172.203(n), §172.101(c)(9), §172.203(e)
  /[()[\]]/, /\bCONTAIN/, /\bTECHNICAL\b/, /\bN\.?\s?O\.?\s?S\b/, /\bSAMPLES?\b/, // §172.203(k) technical names, (k)(2)(ii)
  /\bDOT[-\s]?(?:SP|E)\b/, /\bSPECIAL\b/, /\bPERMIT\b/, /\bEX\s?\d/, /\bAPPROVAL\b/, // §172.203(a), §172.320
  /\bRADIOACTIVE\b/, /\bFISSILE\b/, /\bLSA\b/, /\bSCO\b/, /\bTYPE\b/, /\bBQ\b|\d\s?[KMGT]?BQ\b/, /\bCI\b/, /\bTI\b/, /\bTRANSPORT\b/, /\bCATEGORY\b/, // §172.203(d)
  /\bAIRCRAFT\b/, /\bPASSENGER\b/, // §172.203(f)
  /\bTEMPERATURE\b/, /\bSTABILI[SZ]ED\b/, /\bINHIBITED\b/, /\bMOLTEN\b/, /\bSELF[-\s]?REACTIVE\b/, /\bPEROXIDE\b/, // §172.203(f)–(o)
  /\bPG\b|\bPG\s?I/, /(?<![A-Z0-9])I{1,3}(?![A-Z0-9])/, // §172.202(a)(4)
  /\bCLASS\b/, /\bDIV(?:ISION)?\b/, /(?<![\w.#%$/-])[1-9](?:\.[1-6][A-HJKLNS]?)?(?![\w#%/-]|[.,]\d)/, // §172.202(a)(3)
  /\b(?:GAS|LIQUID|SOLID|FLAMMABLE|COMBUSTIBLE|CORROSIVE|OXIDI[SZ]ER|OXIDIZING|EXPLOSIVE|INFECTIOUS|MISCELLANEOUS|DANGEROUS|SPONTANEOUSLY|ORGANIC)\b/, // §173.2 class names
];

/** The regulated tokens a piece of text carries, as the extent rule sees them (upper case). */
export function regulatedTokens(text: string): string[] {
  const t = text.toUpperCase();
  return REGULATED.flatMap((rx) => rx.exec(t)?.[0] ?? []);
}

/** The keys of a hazmat line whose cell a reader may transcribe to a different extent. */
export const EXTENT_KEYS = ["descriptionText", "packaging", "marks"] as const;
const EXTENT_PATH = /^hazmat\.lines\[\d+\]\.(descriptionText|packaging|marks)$/;

/** Whether `path` is a field the extent rule applies to. */
export const isExtentPath = (path: string | undefined): boolean => path !== undefined && EXTENT_PATH.test(path);

const BOUNDARY = /^(?:, |; | )/;
const leadingCount = (s: string) => /^\s*(\d+)\b/.exec(s)?.[1] ?? null;

function tailOf(short: string, long: string): string | null {
  if (short === "" || !long.startsWith(short)) return null;
  const tail = long.slice(short.length);
  return BOUNDARY.test(tail) ? tail : null;
}

/**
 * Whether two readings of the extent cell at `path` carry the same facts (above), given `norm` — the field
 * comparison's own folding. Exact agreement is the caller's question; this answers only the extent case.
 */
export function extentAgrees(path: string, a: unknown, b: unknown, norm: (v: unknown) => unknown): boolean {
  const key = EXTENT_PATH.exec(path)?.[1];
  if (!key) return false;
  if (key === "marks") {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const [small, big] = (a.length <= b.length ? [a, b] : [b, a]).map((l) => l.map((m) => JSON.stringify(norm(m))));
    const extra = [...big!];
    for (const m of small!) {
      const at = extra.indexOf(m);
      if (at < 0) return false;
      extra.splice(at, 1);
    }
    return extra.length > 0 && extra.every((m) => regulatedTokens(JSON.parse(m) ?? "").length === 0);
  }
  if (typeof a !== "string" || typeof b !== "string") return false;
  const [na, nb] = [norm(a), norm(b)] as [string, string];
  const [short, long, shortRaw, longRaw] = na.length <= nb.length ? [na, nb, a, b] : [nb, na, b, a];
  const tail = tailOf(short, long);
  if (tail === null || regulatedTokens(tail).length > 0) return false;
  if (key === "packaging") {
    return leadingCount(shortRaw) === leadingCount(longRaw) && packageTypeFromPrinted(shortRaw) === packageTypeFromPrinted(longRaw);
  }
  return true;
}
