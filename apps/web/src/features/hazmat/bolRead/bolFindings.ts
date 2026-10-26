import { BOL_FINDING_CATALOGUE, bolBlockedSentence, bolFieldWords, bolFindingActor, valuesAgree, type BolFindingActor, type BolFindingRuleId, type FieldEvidence, type PaperAuditView } from "@silvicom/shared";

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
  /** For "confirm it first": each field the check waits on, with what the page may say there (Q-RC5). */
  choices?: FieldChoice[];
}

/** One field a person can settle by saying what the page prints there. */
export interface FieldChoice {
  path: string;
  /** The field in the dispatcher's words ("the shipper's certification"). */
  label: string;
  options: { value: unknown; text: string }[];
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

const shown = (v: unknown): string =>
  v == null || v === "" ? "nothing" : Array.isArray(v) ? (v.length ? v.join(", ") : "nothing") : typeof v === "number" ? v.toLocaleString("en-US") : String(v);

/**
 * What a person can say the page prints in each field a check waits on (READER-CORRECTNESS-PLAN Q-RC5): the
 * readings the two readers gave — never a value neither read — or, for a yes/no field such as the certification,
 * yes and no (a reader that saw nothing read neither). A field neither reader read offers nothing to pick.
 */
export function fieldChoices(paths: readonly string[], evidence: readonly FieldEvidence[]): FieldChoice[] {
  return paths.flatMap((path) => {
    const e = evidence.find((x) => x.path === path);
    if (!e) return [];
    const read = e.sources.filter((s) => s.reader === "passA" || s.reader === "passB").map((s) => s.value as unknown);
    const label = bolFieldWords(path);
    if (read.some((v) => typeof v === "boolean")) {
      return [{ path, label, options: [{ value: true, text: "Yes, it is printed" }, { value: false, text: "No, it is not printed" }] }];
    }
    const options: { value: unknown; text: string }[] = [];
    for (const v of read) if (v != null && !options.some((o) => valuesAgree(o.value, v))) options.push({ value: v, text: `“${shown(v)}”` });
    return options.length ? [{ path, label, options }] : [];
  });
}

export function bolFindings(audit: PaperAuditView | null, evidence: readonly FieldEvidence[] = []): BolFindings | null {
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
    const unconfirmed = r.reason === "field_unconfirmed" && Array.isArray(r.facts.unconfirmed) ? r.facts.unconfirmed.map(String) : [];
    const choices = fieldChoices(unconfirmed, evidence);
    const finding: BolFinding = {
      key: `${r.ruleId}:${r.lineIndex ?? "doc"}`,
      sentence: entry.sentence(r),
      cite: entry.cite,
      actor: bolFindingActor(entry, r),
      howToFix: entry.howToFix,
      ...(choices.length ? { choices } : {}),
    };
    (r.outcome === "fail" ? out.wrong : r.outcome === "cannot_tell" ? out.check : out.passed).push(finding);
  }
  for (const [key, g] of blocked) {
    const choices = g.reason === "field_unconfirmed" ? fieldChoices(g.unconfirmed, evidence) : [];
    out.check.push({
      key,
      sentence: bolBlockedSentence(g.reason, g.label, g.ruleIds, g.unconfirmed),
      cite: g.cites.join("; "),
      actor: "information_only",
      howToFix: "",
      ...(choices.length ? { choices } : {}),
    });
  }
  out.wrong.sort((a, b) => ACTOR_ORDER[a.actor] - ACTOR_ORDER[b.actor]);
  return out;
}
