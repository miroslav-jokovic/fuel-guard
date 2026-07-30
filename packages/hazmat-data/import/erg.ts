/**
 * ERG 2024 ID-index parser (Phase H1, deliverable 4).
 *
 * The Emergency Response Guidebook is a quadrennial PDF (2020 → 2024 → 2028), not a live API — so
 * this is a ONE-TIME extraction, frozen until ERG 2028, not a fetch client. It parses the yellow-
 * bordered "ID Number Index" (ID No. → Guide No.) into `ErgEntry` rows. The parser is built against
 * the REAL `pdftotext -layout` output of the official PDF (physical pages 30–89), and a verbatim
 * slice of that output is frozen as the test fixture — never a guessed layout.
 *
 * Layout facts that shaped this (all verified against ERG2024-Eng-Web-a.pdf):
 *   - TWO physical columns per page — one text line can hold two entries side by side.
 *   - Guide numbers may carry a trailing 'P' (polymerization), e.g. "116P". Kept faithfully; the
 *     guide PAGE is the number without the P.
 *   - Some rows have NO id ("— — 112  Ammonium nitrate-fuel oil") — excluded (no UN/NA number).
 *   - Long names wrap to a continuation line with no id/guide — naturally ignored.
 *   - Alternate names for one id repeat the same id+guide — collapsed to one entry.
 *   - A few ids map to MULTIPLE guides by material form (e.g. 3171 battery-powered → 138/147/154) —
 *     kept as multiple entries, because that is what the ERG says.
 */

import type { ErgEntry } from "../src/schema.js";

/** The fuel-relevant ID numbers (plan H1 d4) — asserted present after every extraction. */
export const ERG_FUEL_IDS = [
  "1075", "1170", "1202", "1203", "1223", "1268", "1863", "1978", "1987", "1993", "3257", "3475",
] as const;

/** IDs the ERG legitimately maps to MULTIPLE guides (verified in the 2024 edition). */
export const ERG_MULTI_GUIDE_IDS = ["1057", "3166", "3171", "3536"] as const;

// ID = 4 digits, Guide = 3 digits + optional P; lookarounds keep it off 5-digit runs.
const ROW = /(?<!\d)(\d{4})\s+(\d{3}P?)(?!\d)/g;

/**
 * Parse the ID Number Index text (the `pdftotext -layout` output of the yellow pages) into rows.
 * Two-column-safe: every `ID Guide` token on every line is captured, so both columns are read and
 * no-id / continuation lines are ignored. Returns distinct (idNumber, guideNumber) pairs, sorted by
 * id then guide.
 */
export function parseErgIdIndex(layoutText: string): ErgEntry[] {
  const seen = new Set<string>();
  const out: ErgEntry[] = [];
  for (const m of layoutText.matchAll(ROW)) {
    const idNumber = m[1];
    const guideNumber = m[2];
    if (idNumber == null || guideNumber == null) continue;
    const key = `${idNumber}:${guideNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ idNumber, guideNumber });
  }
  out.sort((a, b) => Number(a.idNumber) - Number(b.idNumber) || a.guideNumber.localeCompare(b.guideNumber));
  return out;
}

export interface ErgVerification {
  ok: boolean;
  count: number;
  uniqueIds: number;
  missingFuelIds: string[];
  /** Every id that maps to more than one guide (id → guides). */
  multiGuide: Record<string, string[]>;
}

/**
 * The extraction acceptance gate: every fuel id must be present. Also surfaces the multi-guide ids
 * so a reviewer can confirm they match the known set (they are expected, not errors).
 */
export function verifyErg(entries: ErgEntry[]): ErgVerification {
  const byId = new Map<string, string[]>();
  for (const e of entries) {
    const list = byId.get(e.idNumber) ?? [];
    list.push(e.guideNumber);
    byId.set(e.idNumber, list);
  }
  const missingFuelIds = ERG_FUEL_IDS.filter((id) => !byId.has(id));
  const multiGuide: Record<string, string[]> = {};
  for (const [id, guides] of byId) {
    if (guides.length > 1) multiGuide[id] = guides;
  }
  return { ok: missingFuelIds.length === 0, count: entries.length, uniqueIds: byId.size, missingFuelIds, multiGuide };
}

/** The guide PAGE for an entry — the guide number with any polymerization 'P' stripped. */
export function guidePage(entry: ErgEntry): string {
  return entry.guideNumber.replace(/P$/, "");
}
