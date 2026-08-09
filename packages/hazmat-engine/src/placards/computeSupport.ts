import type { Finding, LoadInput, PlacardName, PlacardOutput, TraceNode } from "../types.js";
import {
  LQ_ENCODED_CLASS_KEYS,
  LQ_PACKAGE_GROSS_CAP_LB,
  pgRowForRef,
  type DsEntry,
  type DsPlacard,
} from "./classify.js";

export interface Resolved {
  line: LoadInput["lines"][number];
  entry: DsEntry;
  spec: DsPlacard;
  placard: PlacardName;
  /** H-LQ (0.10.0): the offeror's LQ claim was VERIFIED and accepted. */
  lqAccepted: boolean;
}

export interface PlacardComputation {
  placards: PlacardOutput;
  findings: Finding[];
  trace: TraceNode[];
}

/**
 * H-LQ (0.10.0) — verify one line's Limited Quantity claim, fail-closed. A claim is ACCEPTED only
 * when every checkable fact supports it; anything else refuses and leaves the line fully regulated.
 */
export function verifyLqClaim(
  line: LoadInput["lines"][number],
  entry: DsEntry,
  classKey: string,
  isTank: boolean,
): { accepted: true } | { accepted: false; reason: string; cfr: string } {
  if (isTank || line.packagingKind === "bulk") {
    return {
      accepted: false,
      reason: "a Limited Quantity is by definition non-bulk packaging — this line is bulk",
      cfr: "49 CFR 171.8",
    };
  }
  if (!LQ_ENCODED_CLASS_KEYS.has(classKey)) {
    return {
      accepted: false,
      reason: `LQ semantics for class "${classKey}" are not encoded (gases use §173.306's own structure; Classes 1/7 and Divisions 6.1/6.2 sit outside the §172.315 mark scheme)`,
      cfr: "49 CFR 172.315(a)",
    };
  }
  const row = pgRowForRef(entry, line.hmtRef);
  if (!row || !("exceptionsRef" in row)) {
    return {
      accepted: false,
      reason: "the loaded dataset predates HMT column 8A (exceptions) — use dataset 2026.08.0 or later to evaluate LQ claims",
      cfr: "49 CFR 172.101 col. 8A",
    };
  }
  if (row.exceptionsRef == null) {
    return {
      accepted: false,
      reason: `the §172.101 table lists NO exceptions section for ${entry.psnPrinted} (column 8A is "None") — a Limited Quantity is not authorized`,
      cfr: "49 CFR 172.101 col. 8A",
    };
  }
  if (line.grossWeightLb != null && line.packageCount != null && line.packageCount > 0) {
    const perPackage = line.grossWeightLb / line.packageCount;
    if (perPackage > LQ_PACKAGE_GROSS_CAP_LB) {
      return {
        accepted: false,
        reason: `per-package gross weight ${Math.round(perPackage)} lb exceeds the 30 kg (66 lb) LQ package cap (§173.150(b)/§173.155(b) family)`,
        cfr: "49 CFR 173.150(b)",
      };
    }
  }
  return { accepted: true };
}

export function withheld(reason: string, evidence: Record<string, unknown>): Finding {
  return {
    ruleId: "placard_determination_withheld",
    tier: "conditional",
    message: `${reason} — placard determination withheld. Route to a hazmat-trained reviewer.`,
    citations: [{ cfr: "internal: determination withheld (plan D2/D4)" }],
    evidence,
  };
}
