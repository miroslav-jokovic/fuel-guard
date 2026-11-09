import { catalogueAnswer } from "../leadContract.js";
import { CLASS_A_YEAR_BUCKETS, type LeadFacts } from "../leadMatch.js";

/**
 * What a Meta Instant Form's answers say (LQ7; before LQ7 this was `leadFactsFromAnswers` in leadMatch.ts).
 * Every fact is `self_reported`; an answer we cannot read through `META_FORM_CATALOGUE` is absent — never a
 * guess (`catalogueAnswer`'s rule). The form may not ask age, licence numbers or disqualifiers (ADS-AGENT-PLAN
 * §1), so this reader never produces those facts.
 */
export function metaFacts(answers: Record<string, string>): LeadFacts {
  const facts: LeadFacts = {};
  const held = catalogueAnswer("class_a_held", answers.class_a_held);
  if (held) facts.class_a_held = { value: held === "yes", evidence: "self_reported" };
  const years = catalogueAnswer("class_a_years", answers.class_a_years);
  if (years && CLASS_A_YEAR_BUCKETS[years]) facts.class_a_years = { value: CLASS_A_YEAR_BUCKETS[years], evidence: "self_reported" };
  const hazmat = catalogueAnswer("hazmat_endorsement", answers.hazmat_endorsement);
  if (hazmat) facts.hazmat_endorsement = { value: hazmat === "yes", evidence: "self_reported" };
  return facts;
}
