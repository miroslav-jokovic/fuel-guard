import { BOL_FINDING_CATALOGUE, bolBlockedSentence, type BolFindingActor, type BolFindingRuleId, type PaperAuditView } from "@silvicom/shared";

/**
 * The paper audit of a read BOL as the dispatcher reads it (§5, §7A N6 part 3): every rule's result worded by
 * the catalogue (D-DR7), sorted by what someone has to do about it. A failure says who acts and how to fix it;
 * "can't tell" says what to look at; a pass is kept, counted and listed, because "the audit looked and it was
 * right" is the answer the dispatcher asked for, but it never sits among the things to act on.
 *
 * Line rules stopped by one cause — the line matches no table entry, or one field the readers did not agree on
 * — are said ONCE per line and cause (`bolBlockedSentence`), naming every check it stopped. Seen in a browser
 * 2026-10-12: one unmatched line alone filled the list with five copies of the same sentence.
 */
export interface BolFinding {
  key: string;
  sentence: string;
  cite: string;
  actor: BolFindingActor;
  howToFix: string;
}

export interface BolFindings {
  /** Failures: the shipper must reprint, or the driver must not take the paper. */
  wrong: BolFinding[];
  /** The audit could not answer: a field to confirm, a fact the BOL does not carry, a check by eye. */
  check: BolFinding[];
  passed: BolFinding[];
  datasetVersion: string;
}

/** A failure the driver must refuse comes before one the shipper merely has to fix. */
const ACTOR_ORDER: Record<BolFindingActor, number> = { driver_must_not_accept: 0, shipper_must_correct: 1, information_only: 2 };

const GROUPED = new Set(["line_unresolved", "field_unconfirmed"]);

export function bolFindings(audit: PaperAuditView | null): BolFindings | null {
  if (!audit) return null;
  const out: BolFindings = { wrong: [], check: [], passed: [], datasetVersion: audit.datasetVersion };
  const blocked = new Map<string, { reason: string; label: string; ruleIds: string[]; unconfirmed: string[]; cites: string[] }>();
  for (const r of audit.results) {
    if (r.outcome === "cannot_tell" && r.lineIndex !== null && GROUPED.has(r.reason)) {
      const unconfirmed = Array.isArray(r.facts.unconfirmed) ? r.facts.unconfirmed.map(String) : [];
      const key = `${r.reason}:${r.lineIndex}:${unconfirmed.join(",")}`;
      const g = blocked.get(key) ?? { reason: r.reason, label: String(r.facts.lineLabel ?? `Line ${r.lineIndex + 1}`), ruleIds: [], unconfirmed, cites: [] };
      g.ruleIds.push(r.ruleId);
      const cite = BOL_FINDING_CATALOGUE[r.ruleId as BolFindingRuleId]?.cite;
      if (cite) g.cites.push(cite);
      blocked.set(key, g);
      continue;
    }
    // A rule the API knows and this build does not (a newer deploy) is left out rather than shown as code.
    const entry = BOL_FINDING_CATALOGUE[r.ruleId as BolFindingRuleId];
    if (!entry) continue;
    const finding: BolFinding = {
      key: `${r.ruleId}:${r.lineIndex ?? "doc"}`,
      sentence: entry.sentence(r),
      cite: entry.cite,
      actor: entry.actor,
      howToFix: entry.howToFix,
    };
    (r.outcome === "fail" ? out.wrong : r.outcome === "cannot_tell" ? out.check : out.passed).push(finding);
  }
  for (const [key, g] of blocked) {
    out.check.push({
      key,
      sentence: bolBlockedSentence(g.reason, g.label, g.ruleIds, g.unconfirmed),
      cite: g.cites.join("; "),
      actor: "information_only",
      howToFix: "",
    });
  }
  out.wrong.sort((a, b) => ACTOR_ORDER[a.actor] - ACTOR_ORDER[b.actor]);
  return out;
}
