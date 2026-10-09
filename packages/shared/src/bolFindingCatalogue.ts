/**
 * The BOL finding catalogue (DOCUMENT-READER-PLAN.md §5.3, D-DR7): the words a dispatcher reads for each
 * printed-paper audit result. One entry per rule id of `auditPrintedPaper` (`@hazmat/engine`,
 * `PAPER_RULE_IDS`), so the review panel, the driver app and any later assistant say the same thing.
 *
 * Each entry: `sentence(ctx)` — one plain sentence for the result in hand, built only from the facts the
 * engine returned; `cite` — the CFR section, as docs/17 Appendix A and plan §5.1 state it; `actor` — who
 * has to act when the rule fails; `howToFix` — what that person does.
 *
 * WHY THE CONTEXT TYPE IS RESTATED HERE. `@silvicom/shared` ships to React Native and has no dependency
 * on the engine, so `BolFindingContext` is a structural mirror of the engine's `PaperRuleResult`. The
 * mirror cannot drift unseen: `apps/api/src/modules/hazmat/paperAuditContract.test.ts` checks the
 * engine's result type is assignable to it and that the catalogue's keys equal the engine's rule ids
 * ("has one catalogue entry for every engine rule id, and no other").
 */

export const BOL_FINDING_ACTORS = ["shipper_must_correct", "driver_must_not_accept", "information_only"] as const;
export type BolFindingActor = (typeof BOL_FINDING_ACTORS)[number];

export type BolFactValue = string | number | boolean | null | readonly string[] | readonly number[];

export interface BolFindingContext {
  readonly outcome: "pass" | "fail" | "cannot_tell";
  readonly reason: string;
  readonly lineIndex: number | null;
  readonly facts: Readonly<Record<string, BolFactValue>>;
}

export interface BolFindingEntry {
  sentence(ctx: BolFindingContext): string;
  cite: string;
  actor: BolFindingActor;
  howToFix: string;
}

// ── wording helpers ───────────────────────────────────────────────────────────────────────────────
const s = (v: BolFactValue | undefined): string => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
const line = (ctx: BolFindingContext): string => s(ctx.facts.lineLabel) || `Line ${(ctx.lineIndex ?? 0) + 1}`;
const PART: Record<string, string> = { id: "the UN/NA number", psn: "the proper shipping name", class: "the hazard class", pg: "the packing group" };
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
const pages = (v: BolFactValue | undefined): string => (Array.isArray(v) && v.length > 1 ? `pages ${s(v)}` : `page ${s(v)}`);
const pgText = (v: BolFactValue | undefined): string => (Array.isArray(v) ? `one of PG ${joinWords(v.map(String))}` : v == null ? "no packing group" : `PG ${s(v)}`);

/**
 * The three reasons any rule can share. They say why the audit stopped short, and name what would let it
 * answer — never implying the paper passed.
 */
function common(ctx: BolFindingContext, subject: string): string | null {
  switch (ctx.reason) {
    case "field_unconfirmed":
      return `Can't check ${subject} on ${line(ctx)} yet: the reader isn't sure of ${s(ctx.facts.unconfirmed)} — confirm it against the paper first.`;
    case "line_unresolved":
      return `Can't check ${subject} on ${line(ctx)}: the line doesn't match one Hazardous Materials Table entry, so there is nothing to compare it with. Pick the right entry first.`;
    case "requirement_not_in_dataset":
      return `Can't check ${subject} on ${line(ctx)}: the regulatory data this check needs (${s(ctx.facts.needs)}) isn't in the loaded dataset version.`;
    default:
      return null;
  }
}

export const BOL_FINDING_CATALOGUE = {
  paper_sequence: {
    cite: "49 CFR 172.202(a), (b)",
    actor: "driver_must_not_accept",
    howToFix: "Ask the shipper for a corrected BOL whose description reads UN number, proper shipping name, hazard class, packing group — in that order.",
    sentence(ctx) {
      const c = common(ctx, "the basic description");
      if (c) return c;
      if (ctx.outcome === "fail") {
        const missing = Array.isArray(ctx.facts.missing) ? ctx.facts.missing.map((m) => PART[String(m)] ?? String(m)) : [];
        return `${line(ctx)} on the BOL is missing ${joinWords(missing)} from its hazmat description.`;
      }
      return `${line(ctx)} prints all four parts (${s(ctx.facts.printed)}); check by eye that they read in that order — the reader does not record it.`;
    },
  },
  paper_psn_matches_hmt: {
    cite: "49 CFR 172.202(a)(1)",
    actor: "shipper_must_correct",
    howToFix: "The shipper reprints the description with the proper shipping name exactly as the Hazardous Materials Table gives it.",
    sentence(ctx) {
      const c = common(ctx, "the shipping name");
      if (c) return c;
      if (ctx.reason === "psn_not_in_hmt") {
        return `The BOL calls ${line(ctx)} "${s(ctx.facts.printedPsn)}", which is not a proper shipping name for that number (the table lists: ${s(ctx.facts.candidatePsns)}).`;
      }
      if (ctx.reason === "psn_missing") return `The BOL shows ${line(ctx)} with no shipping name; the table's name is "${s(ctx.facts.requiredPsn)}".`;
      return `${line(ctx)}'s shipping name matches the table ("${s(ctx.facts.requiredPsn)}").`;
    },
  },
  paper_class_pg_match: {
    cite: "49 CFR 172.202(a)(2)-(4)",
    actor: "driver_must_not_accept",
    howToFix: "Ask the shipper for a corrected BOL with the hazard class and packing group the Hazardous Materials Table gives for this entry.",
    sentence(ctx) {
      const c = common(ctx, "the class and packing group");
      if (c) return c;
      if (ctx.outcome === "pass") return `${line(ctx)}'s class ${s(ctx.facts.requiredClass)} and ${pgText(ctx.facts.requiredPg)} match the table.`;
      const parts: string[] = [];
      if (ctx.facts.classProblem === "missing") parts.push(`prints no hazard class (the table says ${s(ctx.facts.requiredClass)})`);
      if (ctx.facts.classProblem === "differs") parts.push(`prints class ${s(ctx.facts.printedClass)} where the table says ${s(ctx.facts.requiredClass)}`);
      if (ctx.facts.pgProblem === "missing") parts.push(`prints no packing group (the table requires ${pgText(ctx.facts.requiredPg)})`);
      if (ctx.facts.pgProblem === "differs") parts.push(`prints PG ${s(ctx.facts.printedPg)} where the table requires ${pgText(ctx.facts.requiredPg)}`);
      if (ctx.facts.pgProblem === "not_allowed") parts.push(`prints PG ${s(ctx.facts.printedPg)}, but this material has no packing group`);
      return `The BOL for ${line(ctx)} ${joinWords(parts)}.`;
    },
  },
  paper_technical_name: {
    cite: "49 CFR 172.203(k)",
    actor: "shipper_must_correct",
    howToFix: "The shipper adds the technical name of the hazardous component in parentheses after the shipping name.",
    sentence(ctx) {
      const c = common(ctx, "the technical name");
      if (c) return c;
      if (ctx.outcome === "fail") return `${line(ctx)} is an n.o.s. entry ("${s(ctx.facts.requiredPsn)}") and the BOL doesn't name what is actually in it.`;
      if (ctx.reason === "printed") return `${line(ctx)} names its contents (${s(ctx.facts.technicalName)}), as an n.o.s. entry must.`;
      return `${line(ctx)} needs no technical name.`;
    },
  },
  paper_rq: {
    cite: "49 CFR 172.203(c)",
    actor: "shipper_must_correct",
    howToFix: "The shipper adds \"RQ\" before or after the description (or in the HM column).",
    sentence(ctx) {
      const c = common(ctx, "the RQ marking");
      if (c) return c;
      const amount = `${s(ctx.facts.perPackage)} ${s(ctx.facts.unit)} per package`;
      switch (ctx.reason) {
        case "rq_not_printed":
          return `${line(ctx)} has ${amount} of ${s(ctx.facts.substance)}, at or over its reportable quantity of ${s(ctx.facts.rq)} ${s(ctx.facts.unit)}, but the BOL doesn't say "RQ".`;
        case "printed":
          return `${line(ctx)} is marked RQ.`;
        case "below_rq":
          return `${line(ctx)} has ${amount} of ${s(ctx.facts.substance)}, under its reportable quantity of ${s(ctx.facts.rq)} ${s(ctx.facts.unit)} — no RQ needed.`;
        case "not_listed":
          return `${line(ctx)} is not a listed hazardous substance — no RQ needed.`;
        case "quantity_not_by_mass":
          return `${line(ctx)} contains ${s(ctx.facts.substance)}, whose reportable quantity is by weight, and the BOL gives the amount by volume — check whether one package holds the RQ.`;
        case "package_quantity_unknown":
          return `${line(ctx)} contains ${s(ctx.facts.substance)}, but the BOL doesn't show how much is in each package — check whether one package holds the RQ.`;
        case "concentration_unknown":
          return `${line(ctx)} is a mixture containing ${s(ctx.facts.substance)} (RQ ${s(ctx.facts.rq)} ${s(ctx.facts.unit)}); whether it needs "RQ" depends on how much of it is in the mix, which the BOL doesn't say.`;
        default:
          return `${line(ctx)} is an n.o.s. entry with no technical name, so whether it holds a listed hazardous substance can't be told.`;
      }
    },
  },
  paper_lq: {
    cite: "49 CFR 172.203(b)",
    actor: "shipper_must_correct",
    howToFix: "The shipper adds \"Limited Quantity\" (or \"Ltd Qty\") to the description — or removes it if the material may not ship as one.",
    sentence(ctx) {
      const c = common(ctx, "the Limited Quantity marking");
      if (c) return c;
      switch (ctx.reason) {
        case "claimed_not_printed":
          return `${line(ctx)} is booked as a Limited Quantity, but the BOL doesn't say "Limited Quantity" or "Ltd Qty".`;
        case "not_authorised":
          return `The BOL marks ${line(ctx)} as a Limited Quantity, but the table allows no Limited Quantity for ${s(ctx.facts.requiredPsn)}.`;
        case "authorised":
          return `${line(ctx)} is marked Limited Quantity, which the table allows (49 CFR 173.${s(ctx.facts.exceptionsRef)}).`;
        default:
          return `${line(ctx)} is not shipped as a Limited Quantity.`;
      }
    },
  },
  paper_marine_pollutant: {
    cite: "49 CFR 172.203(l)",
    actor: "shipper_must_correct",
    howToFix: "The shipper adds the words \"Marine Pollutant\" to the description.",
    sentence(ctx) {
      const c = common(ctx, "the marine-pollutant marking");
      if (c) return c;
      switch (ctx.reason) {
        case "required_not_printed":
          return `${line(ctx)} (${s(ctx.facts.requiredPsn)}) is a marine pollutant ${ctx.facts.vesselLeg === true ? "with a leg by vessel" : "in bulk"}, and the BOL doesn't say "Marine Pollutant".`;
        case "printed":
          return `${line(ctx)} is marked Marine Pollutant.`;
        case "not_required_non_bulk_highway":
          return `${line(ctx)} is a marine pollutant, but in non-bulk packages moving only by road the words are not required.`;
        case "applicability_unknown":
          return `${line(ctx)} is a marine pollutant; whether the BOL must say so depends on bulk packaging or a vessel leg, and neither is known.`;
        default:
          return `${line(ctx)} is not a marine pollutant.`;
      }
    },
  },
  paper_quantity_present: {
    cite: "49 CFR 172.202(a)(5)",
    actor: "shipper_must_correct",
    howToFix: "The shipper writes the total quantity with its unit (gallons, pounds, …) on the line, or \"1 cargo tank\" for a bulk load.",
    sentence(ctx) {
      const c = common(ctx, "the quantity");
      if (c) return c;
      switch (ctx.reason) {
        case "unit_missing":
          return `${line(ctx)} shows ${s(ctx.facts.value)} with no unit — gallons, pounds or another unit has to be printed.`;
        case "missing":
          return `${line(ctx)} shows no total quantity.`;
        case "bulk_cargo_tank":
          return `${line(ctx)} gives its quantity as "${s(ctx.facts.packaging)}", which a bulk load may.`;
        case "residue":
          return `${line(ctx)} is a residue line and needs no quantity.`;
        default:
          return `${line(ctx)} shows ${s(ctx.facts.value)} ${s(ctx.facts.unit)}.`;
      }
    },
  },
  paper_hm_column: {
    cite: "49 CFR 172.201(a)(1)",
    actor: "information_only",
    howToFix: "If other freight shares the paper, the hazmat lines must be listed first, in a contrasting colour, or marked \"X\" in the HM column.",
    sentence(ctx) {
      const c = common(ctx, "the HM column");
      if (c) return c;
      if (ctx.reason === "marked") return `${line(ctx)} is marked "${s(ctx.facts.mark)}" in the HM column.`;
      if (ctx.reason === "not_mixed") return `The paper carries only hazmat, so ${line(ctx)} needs no HM-column mark.`;
      return `${line(ctx)} has no HM-column mark; if other freight is on this paper, check the hazmat lines are listed first or in a contrasting colour.`;
    },
  },
  paper_er_phone: {
    cite: "49 CFR 172.604",
    actor: "driver_must_not_accept",
    howToFix: "Ask the shipper to print a monitored 24-hour emergency number, with area code, on the BOL.",
    sentence(ctx) {
      if (ctx.reason === "field_unconfirmed") return `Can't check the emergency phone yet: the reader isn't sure of it — confirm it against the paper first.`;
      switch (ctx.reason) {
        case "missing":
          return "The BOL has no 24-hour emergency phone number.";
        case "not_a_number":
          return `The emergency contact reads "${s(ctx.facts.printed)}" — a phone number with area code is required, not words.`;
        case "too_short":
          return `The emergency number "${s(ctx.facts.printed)}" has no area code.`;
        default:
          return `The emergency number ${s(ctx.facts.printed)} is printed.`;
      }
    },
  },
  paper_certification: {
    cite: "49 CFR 172.204",
    actor: "shipper_must_correct",
    howToFix: "The shipper signs the certification statement on the BOL.",
    sentence(ctx) {
      switch (ctx.reason) {
        case "field_unconfirmed":
          return "Can't check the shipper's certification yet: the reader isn't sure of it — confirm it against the paper first.";
        case "present":
          return "The shipper's certification is on the BOL.";
        case "exempt":
          return "The shipper's certification is not on the BOL, and this load doesn't need one (carrier-supplied tank or own product).";
        case "missing":
          return "The shipper's certification is not on the BOL.";
        case "exception_may_apply":
          return "The shipper's certification is not on the BOL; that is fine only for a carrier-supplied cargo tank or a private carrier's own product.";
        default:
          return "The reader couldn't see whether the shipper's certification is on the BOL.";
      }
    },
  },
  paper_page_complete: {
    cite: "49 CFR 172.201(c)",
    actor: "driver_must_not_accept",
    howToFix: "Get every page of the BOL from the shipper before leaving.",
    sentence(ctx) {
      switch (ctx.reason) {
        case "field_unconfirmed":
          return "Can't check the page count yet: the reader isn't sure of the \"page n of m\" marker — confirm it against the paper first.";
        case "pages_missing":
          return `The BOL has ${s(ctx.facts.of)} pages and ${pages(ctx.facts.missingPages)} ${Array.isArray(ctx.facts.missingPages) && ctx.facts.missingPages.length > 1 ? "are" : "is"} missing.`;
        case "pages_not_counted":
          return `The BOL says it has ${s(ctx.facts.of)} pages; check that all of them are here.`;
        case "all_pages":
          return `All ${s(ctx.facts.of)} pages of the BOL are here.`;
        default:
          return "The BOL is a single page.";
      }
    },
  },
} as const satisfies Record<string, BolFindingEntry>;

export type BolFindingRuleId = keyof typeof BOL_FINDING_CATALOGUE;
export const BOL_FINDING_RULE_IDS = Object.keys(BOL_FINDING_CATALOGUE) as BolFindingRuleId[];
