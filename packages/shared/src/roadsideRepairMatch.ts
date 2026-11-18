/**
 * Which kind of repair answers a roadside violation — the "matches the violation" mark on a proposed work
 * order (ROADSIDE-REPAIR-FLOW-PLAN RR1; INSPECTION-CHALLENGE-PLAN Q-IC14, ruled 2026-10-16: candidates are
 * "ranked: VMRS component agreeing with the violation, then the nearest date" — never accepted by it).
 *
 * ── EXACTLY WHAT WAS MEASURED, AND NOTHING ELSE ─────────────────────────────────────────────────────────
 * Each row is a 49 CFR section whose candidate work orders' FleetPal jobs carried that VMRS system as the
 * clear majority, measured on production on 2026-11-18 over 90 violated units (plan §1.4):
 *   393.75 tires (34 units)                → 017 tires     (44 jobs; next 013 with 17)
 *   393.45 / .47 / .48 / .53 brakes        → 013 brakes    (15 / 18 / 3 / 13 jobs)
 *   393.9 lighting (9 units)               → 034 lighting  (9 jobs)
 *   393.205 wheels (6 units)               → 018 wheels    (4 jobs)
 * Every other section maps to nothing — 393.95, 393.60 and the rest were too thin to call — and an
 * unmapped violation gets NO mark, never a guessed one. Adding a row needs its own measurement.
 *
 * Only VMRS SYSTEM codes (the first three characters, e.g. `013` of `013-002-000`) appear here; the words
 * beside them are ours, not TMC's descriptions (D-FP8).
 */

export const VMRS_SYSTEM_WORDS = { "013": "brakes", "017": "tires", "018": "wheels", "034": "lighting" } as const;
export type MatchedSystem = keyof typeof VMRS_SYSTEM_WORDS;

/** The measured rows: a CFR section (exact, as `393.47`) to the VMRS system its repairs carry. */
const SECTION_SYSTEM: Record<string, MatchedSystem> = {
  "393.75": "017",
  "393.45": "013",
  "393.47": "013",
  "393.48": "013",
  "393.53": "013",
  "393.9": "034",
  "393.205": "018",
};

/** The CFR section of an FMCSA violation code: `393.47E` → `393.47`, `393.205C-WR` → `393.205`. */
export function violationSection(code: string | null | undefined): string | null {
  const m = /^(\d{3}\.\d+)/.exec((code ?? "").trim());
  return m ? m[1]! : null;
}

/** The VMRS systems that would answer these violations; empty when none of them is a measured section. */
export function violationSystems(codes: readonly (string | null | undefined)[]): MatchedSystem[] {
  const out = new Set<MatchedSystem>();
  for (const c of codes) {
    const s = SECTION_SYSTEM[violationSection(c) ?? ""];
    if (s) out.add(s);
  }
  return [...out].sort();
}

/** A VMRS code's system: `013-002-000` → `013`. Null for anything that is not one. */
export function vmrsSystem(code: string | null | undefined): string | null {
  const m = /^([0-9A-Z]{3})(-|$)/.exec((code ?? "").trim());
  return m ? m[1]! : null;
}
