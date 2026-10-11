/**
 * The BOL finding catalogue (DOCUMENT-READER-PLAN.md §5.3, D-DR7): the words a dispatcher reads for each
 * printed-paper audit result. One entry per rule id of `auditPrintedPaper` (`@hazmat/engine`,
 * `PAPER_RULE_IDS`), so the review panel, the driver app and any later assistant say the same thing.
 *
 * Each entry: `sentence(ctx)` — one plain sentence for the result in hand, built only from the facts the
 * engine returned; `cite` — the CFR paragraph as eCFR numbers it (checked against its text of 2026-10-09,
 * owner ruling Q-DR15); `actor` — who has to act when the rule fails; `howToFix` — what that person does,
 * in the regulation's terms and never claiming a check the engine did not make.
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
/** §172.604(d)'s exception codes (paperErPhone.ts) in a dispatcher's words. */
const EXCEPTION_WORDS: Record<string, string> = {
  d1_limited_quantity: "shipped as a limited quantity",
  d1_excepted_quantity: "shipped as an excepted quantity",
  d2_named_material: "a material the rule names as needing no number",
  d3_fumigated_unit: "fumigated lading in a unit marked FUMIGANT",
};
const exceptionText = (v: BolFactValue | undefined): string =>
  (Array.isArray(v) ? v : [v]).map((x) => EXCEPTION_WORDS[String(x)] ?? String(x)).join(" or ");

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
    howToFix: "Ask the shipper for a corrected BOL whose hazmat description gives the UN or NA number, proper shipping name, hazard class and packing group one after another, with nothing else printed between them.",
    sentence(ctx) {
      const c = common(ctx, "the basic description");
      if (c) return c;
      switch (ctx.reason) {
        case "elements_missing": {
          const missing = Array.isArray(ctx.facts.missing) ? ctx.facts.missing.map((m) => PART[String(m)] ?? String(m)) : [];
          return `${line(ctx)} on the BOL is missing ${joinWords(missing)} from its hazmat description.`;
        }
        case "in_sequence":
          return `${line(ctx)}'s description reads in the required order: ${s(ctx.facts.printed)}.`;
        case "out_of_order":
          return `${line(ctx)}'s description reads "${s(ctx.facts.descriptionText)}" — the number, shipping name, class and packing group must come in that order.`;
        case "interspersed":
          return `${line(ctx)}'s description has "${s(ctx.facts.interspersed)}" in the middle of it; nothing else may stand between the number, shipping name, class and packing group.`;
        case "description_text_unmatched":
          return `Can't check the order of ${line(ctx)}'s description: the parts the reader recorded don't all appear in the printed text "${s(ctx.facts.descriptionText)}".`;
        default:
          return `${line(ctx)} prints all four parts (${s(ctx.facts.printed)}); check by eye that they read in that order with nothing between them — the reader does not record it.`;
      }
    },
  },
  paper_psn_matches_hmt: {
    cite: "49 CFR 172.202(a)(2)",
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
    cite: "49 CFR 172.202(a)(3)-(4)",
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
    howToFix: "The shipper adds the technical name of the hazardous component in parentheses after the shipping name — the two that contribute most to the hazard, for a mixture of two or more hazardous materials.",
    sentence(ctx) {
      const c = common(ctx, "the technical name");
      if (c) return c;
      switch (ctx.reason) {
        case "missing":
          return `${line(ctx)} is an n.o.s. entry ("${s(ctx.facts.requiredPsn)}") and the BOL doesn't name what is actually in it.`;
        case "printed":
          return `${line(ctx)} names its contents (${s(ctx.facts.technicalName)}), as an n.o.s. entry must.`;
        case "needs_two_components":
          return `${line(ctx)} is a mixture of two or more hazardous materials and the BOL names only one (${s(ctx.facts.technicalName)}); the two that contribute most to the hazard must be named.`;
        case "mixture_unknown":
          return `${line(ctx)} names one component (${s(ctx.facts.technicalName)}); if it is a mixture of two or more hazardous materials, two must be named — check the safety data sheet.`;
        case "excepted_k2i_waste_code":
          return `${line(ctx)} is hazardous waste with its EPA waste number printed, which takes the place of a technical name.`;
        case "excepted_k2i_hazardous_substance_named":
          return `${line(ctx)} is hazardous waste and names its hazardous substance (${s(ctx.facts.technicalName)}).`;
        case "excepted_k2ii_sample":
          return `${line(ctx)} is a sample whose class is still to be determined by testing, so no technical name is required.`;
        case "k2_group_named":
          return `${line(ctx)}'s shipping name ("${s(ctx.facts.requiredPsn)}") already names a chemical group; whether it still needs a technical name depends on what makes it hazardous — check the safety data sheet.`;
        default:
          return `${line(ctx)} needs no technical name.`;
      }
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
    howToFix: "The shipper adds \"Limited Quantity\" (or \"Ltd Qty\") after the description — or removes it if the material may not ship as one.",
    sentence(ctx) {
      const c = common(ctx, "the Limited Quantity marking");
      if (c) return c;
      switch (ctx.reason) {
        case "claimed_not_printed":
          return `${line(ctx)} is booked as a Limited Quantity, but the BOL doesn't say "Limited Quantity" or "Ltd Qty".`;
        case "not_authorised":
          return `The BOL marks ${line(ctx)} as a Limited Quantity, but the table allows no Limited Quantity for ${s(ctx.facts.requiredPsn)}.`;
        case "lq_not_following":
          return `${line(ctx)}'s "Limited Quantity" words are printed ahead of its description; they must follow it.`;
        case "lq_outside_description":
          return `${line(ctx)} is marked Limited Quantity somewhere on the line, but not in its description — check the words follow the description.`;
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
        case "excepted_oil_130_11":
          return `${line(ctx)} is a marine pollutant, but on a move with no vessel leg the description naming it as an oil is enough.`;
        case "oil_exception_may_apply":
          return `${line(ctx)} is a marine pollutant described as an oil; that excuses the "Marine Pollutant" words only for oil covered by 49 CFR part 130 on a move with no vessel leg — confirm both.`;
        case "excepted_small_package_171_4_c2":
          return `${line(ctx)} is a marine pollutant, but at ${s(ctx.facts.perPackage)} ${s(ctx.facts.unit)} per package it is small enough to be exempt (49 CFR 171.4(c)(2)).`;
        case "package_quantity_unknown":
          return `${line(ctx)} is a marine pollutant; packages of 5 L or 5 kg or less are exempt, and the BOL doesn't show how much is in each package.`;
        case "physical_state_unknown":
          return `${line(ctx)} is a marine pollutant in small packages; whether they are exempt depends on whether it is a liquid (5 L) or a solid (5 kg), which isn't known.`;
        case "hazardous_substance_may_apply":
          return `${line(ctx)} is a marine pollutant in small packages, which are exempt unless it is also a hazardous substance or hazardous waste — check whether it is.`;
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
    howToFix: "The shipper writes the total quantity with its unit (gallons, pounds, …) on the line — or, for bulk packages or cylinders, how many (\"1 cargo tank\", \"2 IBCs\", \"10 cylinders\").",
    sentence(ctx) {
      const c = common(ctx, "the quantity");
      if (c) return c;
      switch (ctx.reason) {
        case "unit_missing":
          return `${line(ctx)} shows ${s(ctx.facts.value)} with no unit — gallons, pounds or another unit has to be printed.`;
        case "missing":
          return `${line(ctx)} shows no total quantity.`;
        case "bulk_package_count":
          return `${line(ctx)} gives its quantity as "${s(ctx.facts.packaging)}", which a bulk load may.`;
        case "cylinder_count":
          return `${line(ctx)} gives its quantity as "${s(ctx.facts.packaging)}", which cylinders may.`;
        case "residue":
          return `${line(ctx)} is a residue line and needs no quantity.`;
        default:
          return `${line(ctx)} shows ${s(ctx.facts.value)} ${s(ctx.facts.unit)}.`;
      }
    },
  },
  paper_package_count: {
    cite: "49 CFR 172.202(a)(7)",
    actor: "shipper_must_correct",
    howToFix: "The shipper writes how many packages and what kind they are on the line (\"12 drums\", \"1 cargo tank\").",
    sentence(ctx) {
      const c = common(ctx, "the number and type of packages");
      if (c) return c;
      switch (ctx.reason) {
        case "count_missing":
          return `${line(ctx)} says "${s(ctx.facts.packaging)}" but not how many.`;
        case "type_missing":
          return `${line(ctx)} shows ${s(ctx.facts.packageCount)} packages but not what kind (drums, cases, cylinders, …).`;
        case "missing":
          return `${line(ctx)} shows neither the number nor the type of packages.`;
        default:
          return `${line(ctx)} shows its number and type of packages (${s(ctx.facts.packaging)}).`;
      }
    },
  },
  paper_hm_column: {
    cite: "49 CFR 172.201(a)(1)",
    actor: "information_only",
    howToFix: "If other freight shares the paper, the hazmat lines must be listed first, in a contrasting colour, or marked \"X\" in a column headed \"HM\".",
    sentence(ctx) {
      const c = common(ctx, "the HM column");
      if (c) return c;
      if (ctx.reason === "marked") return `${line(ctx)} is marked "${s(ctx.facts.mark)}" in the HM column.`;
      if (ctx.reason === "not_mixed") return `The paper carries only hazmat, so ${line(ctx)} needs no HM-column mark.`;
      if (ctx.reason === "listed_first") return `${line(ctx)} is listed ahead of the other freight on the paper, which identifies it as hazmat.`;
      return `${line(ctx)} has no HM-column mark; if other freight is on this paper, check the hazmat lines are listed first or in a contrasting colour.`;
    },
  },
  paper_er_phone: {
    cite: "49 CFR 172.604",
    actor: "driver_must_not_accept",
    howToFix: "Ask the shipper to print an emergency response telephone number on the BOL — in digits, with the area code (or \"+\" and the country code for a number outside the US), monitored at all times the hazardous material is in transportation.",
    sentence(ctx) {
      const shown = s(ctx.facts.printed);
      switch (ctx.reason) {
        case "field_unconfirmed":
          return "Can't check the emergency phone yet: the reader isn't sure of it — confirm it against the paper first.";
        case "missing":
          return "The BOL has no emergency response telephone number.";
        case "excepted_172_604_d":
          return `Every hazmat line on this BOL is ${exceptionText(ctx.facts.exceptions)}, so no emergency response telephone number is required (49 CFR 172.604(d)).`;
        case "exception_may_apply":
          return `Can't tell whether this BOL needs an emergency response telephone number: ${s(ctx.facts.unknownLines)} may be one of the materials 49 CFR 172.604(d) excepts — confirm the line first.`;
        case "not_a_number":
          return `The emergency contact reads "${shown}" — a phone number with area code is required, not words.`;
        case "not_numeric":
          return `The emergency number "${shown}" is spelled in letters; it has to be printed as digits.`;
        case "too_short":
          return `The emergency number "${shown}" has no area code.`;
        case "words_beside_number":
          return `The emergency number reads "${shown}" — check that the words are a name beside the number, not a call-back instruction; a number that needs a call back does not count.`;
        case "number_shape_unrecognised":
          return `The emergency number "${shown}" isn't a US number with an area code or an international number with its "+" and country code — check it by eye.`;
        case "international":
          return `The emergency number ${shown} is an international number with its country code.`;
        default:
          return `The emergency number ${shown} is printed with its area code.`;
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
          return "The shipper's certification is not on the BOL, and this load doesn't need one: it is not hazardous waste and moves in a cargo tank the carrier supplied, or with the shipper as a private carrier without being reshipped or transferred.";
        case "missing":
          return "The shipper's certification is not on the BOL.";
        case "exception_may_apply":
          return "The shipper's certification is not on the BOL; that is fine only in a cargo tank the carrier supplied, or when the shipper hauls it as a private carrier and it won't be reshipped or transferred — and never for hazardous waste.";
        default:
          return "The reader couldn't see whether the shipper's certification is on the BOL.";
      }
    },
  },
  paper_page_complete: {
    cite: "49 CFR 172.201(c)",
    actor: "driver_must_not_accept",
    howToFix: "Get every page of the BOL from the shipper before leaving; a BOL of more than one page must number each page and give the total on page 1 (\"Page 1 of 4\").",
    sentence(ctx) {
      const many = Array.isArray(ctx.facts.missingPages) && ctx.facts.missingPages.length > 1;
      switch (ctx.reason) {
        case "field_unconfirmed":
          return "Can't check the page count yet: the reader isn't sure of the \"page n of m\" marker — confirm it against the paper first.";
        case "pages_missing":
          return `The BOL has ${s(ctx.facts.of)} pages and ${pages(ctx.facts.missingPages)} ${many ? "are" : "is"} missing.`;
        case "pages_not_counted":
          return `The BOL says it has ${s(ctx.facts.of)} pages; check that all of them are here.`;
        case "all_pages":
          return `All ${s(ctx.facts.of)} pages of the BOL are here.`;
        case "single_page":
          return "The BOL is a single page.";
        case "page_count_unknown":
          return "The BOL prints no page count, and how many pages it has wasn't recorded — if it runs past one page, each page must be numbered and page 1 must give the total.";
        case "multi_page_unnumbered":
          return `The BOL runs to ${s(ctx.facts.pages)} pages but doesn't give the total on page 1 ("Page 1 of ${s(ctx.facts.pages)}").`;
        case "page_not_numbered":
          return `The BOL has ${s(ctx.facts.of)} pages and ${s(ctx.facts.unnumberedImages)} of the pages photographed carries no page number.`;
        case "total_not_on_first_page":
          return `The BOL has ${s(ctx.facts.of)} pages, but page 1 doesn't say so — the total has to be on the first page.`;
        case "numbering_inconsistent":
          return `The BOL says it has ${s(ctx.facts.of)} pages but ${pages(ctx.facts.pagesBeyond)} ${Array.isArray(ctx.facts.pagesBeyond) && ctx.facts.pagesBeyond.length > 1 ? "are" : "is"} also here — the numbering doesn't add up.`;
        default:
          return "The reader couldn't tell how many pages the BOL has.";
      }
    },
  },
} as const satisfies Record<string, BolFindingEntry>;

export type BolFindingRuleId = keyof typeof BOL_FINDING_CATALOGUE;
export const BOL_FINDING_RULE_IDS = Object.keys(BOL_FINDING_CATALOGUE) as BolFindingRuleId[];
