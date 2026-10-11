/**
 * SMS Appendix A, by edition (D-IC5: every authority is versioned). The JSON beside this package is
 * generated from FMCSA's workbook by `scripts/gen-sms-appendix.mjs` and held to it by `lint:codegen`.
 */
import raw321 from "../datasets/appendix-a-3.21.generated.json" with { type: "json" };
import type { SmsBasic } from "./basics.js";

export interface AppendixViolation {
  code: string;
  key: string;
  basic: SmsBasic;
  group: string;
  severity: number;
  dsms: boolean;
}

export interface AppendixEdition {
  version: string;
  /** The first SMS snapshot the edition applies to. */
  snapshot: string;
  sha256: string;
  byKey: ReadonlyMap<string, AppendixViolation>;
}

/**
 * The comparison key for a violation code. FMCSA's SMS input writes `393.75A3-TAOL` as `39375A3TAOL`
 * and the inspection file keeps the punctuation, so both sides are compared uppercased with every
 * non-alphanumeric removed (2,412 Appendix A rows, no two share a key).
 */
export function violationKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function load(raw: { edition: { version: string; snapshot: string; sha256: string }; violations: unknown[] }): AppendixEdition {
  const byKey = new Map<string, AppendixViolation>();
  for (const v of raw.violations as AppendixViolation[]) byKey.set(v.key, v);
  return { ...raw.edition, byKey };
}

export const APPENDIX_A_EDITIONS: readonly AppendixEdition[] = [load(raw321)];

/**
 * The edition in force for a measurement date: the latest whose first snapshot is on or before it.
 * Null when the date predates every edition we hold — a caller must not score under a guess.
 */
export function appendixFor(measurementDate: string): AppendixEdition | null {
  let best: AppendixEdition | null = null;
  for (const e of APPENDIX_A_EDITIONS) if (e.snapshot <= measurementDate && (!best || e.snapshot > best.snapshot)) best = e;
  return best;
}
