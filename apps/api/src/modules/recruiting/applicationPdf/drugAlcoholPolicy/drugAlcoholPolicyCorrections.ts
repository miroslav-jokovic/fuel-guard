import type { HandbookSpelling } from "../handbook/handbookSpelling.js";

/**
 * Every correction made to the carrier's DRUG AND ALCOHOL ABUSE POLICY (HIRING-WORKFLOW-AUDIT §15.2,
 * D-DAP6) — the whole difference between the owner's scan and what prints.
 *
 * Owner, 2026-11-04, on the typing errors listed with the first proof: *"yes correct this, we have to make
 * sure all documents are really professional and precise"*. So, unlike the handbook (D-HB6: spelling only,
 * drafting listed and left), this register corrects DRAFTING too: a sentence copied twice, a double
 * negative, a clause that contradicts the paragraph before it, a regulation cited in the wrong form. Each
 * drafting entry says why. Meaning is never changed: no rule, number, period, cost or consequence moves.
 *
 * `drugAlcoholPolicyText.json` stays the faithful transcription of the scan; this register is applied on top
 * of it by the handbook's own `correctHandbook`, so an entry that stops matching — or matches a different
 * number of times than it says — fails at import instead of printing the error again.
 */
type Kind = HandbookSpelling["kind"] | "drafting";
interface PolicyCorrection extends Omit<HandbookSpelling, "kind"> {
  kind: Kind;
}

const s = (wrong: string, right: string, times?: number): PolicyCorrection => ({ wrong, right, kind: "spelling", times });
const c = (wrong: string, right: string, times?: number): PolicyCorrection => ({ wrong, right, kind: "character", times });
const d = (wrong: string, right: string, why: string, times?: number): PolicyCorrection => ({ wrong, right, kind: "drafting", times, why });

export const DRUG_ALCOHOL_POLICY_CORRECTIONS: readonly PolicyCorrection[] = [
  // ── Section 1 — Purpose
  s("To insure that we achieve", "To ensure that we achieve"),
  c("Some of those requirements include;", "Some of those requirements include:"),
  s("answer drivers questions", "answer drivers' questions"),
  s("what driver's are required", "which drivers are required", 2),
  s("on the drivers personal health", "on the driver's personal health"),
  s("require that the driver's be made aware", "require that drivers be made aware"),
  s("Commercial Drivers License (CDL)", "Commercial Driver's License (CDL)", 2),
  c("PHONE: (708) 236-5732 - Safety", "Phone: (708) 236-5732 (Safety)"),
  // ── Section 2 — Definitions
  c("makes an initial inspection of the specimen", "makes an initial inspection of the specimen."),
  s("procedure preformed on", "procedure performed on"),
  s("The company's consortium is Med Stop, Elk Grove Village, IL", "The company's consortium is Med-Stop, Elk Grove Village, IL."),
  s("The term includes and employer's officers", "The term includes an employer's officers"),
  d("as required by 49 CFR Parts 392.7 and 392.8", "as required by 49 CFR 392.7 and 392.8", "a section is cited as a section, not as Parts"),
  d("(a berth conforming to requirements of 49 CFR Parts 393.76)", "(a berth conforming to the requirements of 49 CFR 393.76);", "a section cited as a section; the list's own punctuation"),
  s("in attendance upon disable vehicle.", "in attendance upon a disabled vehicle."),
  s("Fail to appear", "Fails to appear"),
  s("Fail to remain", "Fails to remain"),
  s("Fail to provide", "Fails to provide", 2),
  s("Fail or declines", "Fails or declines"),
  s("Fail to undergo", "Fails to undergo"),
  s("Fail to cooperate", "Fails to cooperate"),
  c("subpart 40/63(c)", "subpart 40.63(c)"),
  c("subpart 40/67(l)", "subpart 40.67(l)"),
  c("(see CFR 49, Part 40, subpart 40.193(d)(2))", "(see 49 CFR Part 40, subpart 40.193(d)(2))"),
  d(
    "as directed by the MRO as part of the verification process, or as directed by the MRO as part of the verification process, or as directed by the DER",
    "as directed by the MRO as part of the verification process, or as directed by the DER",
    "the same clause was typed twice",
  ),
  s("when so direct by the collector", "when so directed by the collector"),
  d(
    "Federal agency under the Department of Health Services (DHHS)",
    "Federal agency under the Department of Health and Human Services (DHHS)",
    "the department's name, as Section 2's own definition of DHHS gives it",
  ),
  // ── Section 3 — Use prohibited
  c("The Code of Federal Regulations, Part 382,", "49 CFR Part 382"),
  s("Not withstanding", "Notwithstanding"),
  d(
    "as stated in SECTION 3 below. The only exception to alcohol not intended for human consumption or products containing alcohol which, when ingested would not impair driving ability while performing safety-sensitive functions.",
    "as stated below in this Section. The only exception for alcohol is alcohol not intended for human consumption, or products containing alcohol which, when ingested, would not impair driving ability while performing safety-sensitive functions.",
    "the sentence pointed at its own section as 'below', and the alcohol exception had no verb",
  ),
  c("Schedule 1 drug", "Schedule I drug"),
  d("Federal Motor Carrier Safety Administration, and while on or off duty,", "Federal Motor Carrier Safety Administration, while on or off duty,", "a stray 'and' joined nothing"),
  c("safety–sensitive", "safety-sensitive", 2),
  c("company–owned", "company-owned"),
  // ── Section 4 — Types of testing
  c("drug and/or alcohol testing-pre-employment,", "drug and/or alcohol testing: pre-employment,"),
  c("\"Follow – Up Testing\"", "\"Follow-Up Testing\""),
  c("Once the consortium makes the quarterly selections drivers", "Once the consortium makes the quarterly selections, drivers"),
  c("post–accident", "post-accident"),
  d("for a moving violation and either the accident", "for a moving violation and the accident", "'either' introduced no 'or'", 2),
  c("away from the scene of the accident,", "away from the scene of the accident;"),
  s("shall be constructed to require", "shall be construed to require"),
  s("All persons designed by our company", "All persons designated by our company"),
  s("Refusal to summit", "Refusal to submit"),
  s("months of the drivers return to duty", "months of the driver's return to duty"),
  s("positive pre-employment drug test results.", "positive pre-employment drug test result."),
  // ── Section 5 — Drug testing
  s("No unauthorized personal shall", "No unauthorized personnel shall"),
  s("petitioned area", "partitioned area"),
  c("proof that it, is his/her specimen", "proof that it is his/her specimen"),
  // ── Section 6 — Alcohol testing
  c("safety – sensitive", "safety-sensitive", 2),
  s("in the drivers' presence", "in the driver's presence"),
  c("tamper – evident", "tamper-evident"),
  s("the BST shall sign", "the BAT shall sign"),
  s("does not sign the Step Four", "does not sign Step Four"),
  s("will initialize the \"Remarks\" section", "will initial the \"Remarks\" section"),
  s("will initialized the \"Remarks\" section", "will initial the \"Remarks\" section"),
  c("individually – sealed", "individually-sealed"),
  d(
    "If the driver does not sign Step Four it will not be considered a refusal to test; however, the BAT indicates sufficient breath has been obtained.",
    "If the driver does not sign Step Four it will not be considered a refusal to test; however, the BAT will note the driver's failure to sign in the \"Remarks\" section.",
    "the clause after 'however' was copied from the paragraph above it; the screening test's paragraph states the rule",
  ),
  s("If the test results printed by the EBT does not agree", "If the test results printed by the EBT do not agree"),
  d(
    "No driver tested under Section 4 of this Policy, who is found to have an alcohol Concentration of .02 or greater, but less than .04 shall not perform",
    "Any driver tested under Section 4 of this Policy who is found to have an alcohol concentration of .02 or greater, but less than .04, shall not perform",
    "'No driver … shall not perform' said the opposite of the rule (49 CFR 382.505)",
  ),
  // ── Section 7 — Access to records
  c("in accordance with 49 CFR Parts 40, 382 & 391:", "in accordance with 49 CFR Parts 40, 382 & 391."),
  s("Secretary of Transportation, and DOT agency,", "Secretary of Transportation, any DOT agency,"),
  // ── Section 8
  s("SECTION 8 – EMPLOYEE ADMISSION PROGRAM", "SECTION 8 – EMPLOYEE ASSISTANCE PROGRAM"),
  d(
    "The driver will be removed from any safety sensitive function, and if no other position is available, will place the driver on unpaid leave of absence",
    "The driver will be removed from any safety-sensitive function and, if no other position is available, will be placed on unpaid leave of absence",
    "the driver was the subject of 'will place the driver'",
  ),
  s("a written letter by their SAP stating the driver's readiness to return to duty to a safety sensitive function.", "a written letter from their SAP stating the driver's readiness to return to a safety-sensitive function."),
  // ── Section 9 — Effects
  d(
    "Employees who abuse drugs and/or alcohol cause more absenteeism, loss in the workplace is:",
    "Employees who abuse drugs and/or alcohol cause more absenteeism and loss in the workplace. They are:",
    "the figures below are what such employees are, not what the loss is",
  ),
  c("Marijuana-The common name", "Marijuana – The common name"),
  c("mind – altering", "mind-altering"),
  c("Dilated pupils reddened eyes", "Dilated pupils, reddened eyes"),
  s("Increase appetite", "Increased appetite"),
  c("Phencyclidine (PCP)-PCP", "Phencyclidine (PCP) – PCP"),
  c("ingested by mouth snorted", "ingested by mouth, snorted"),
  c("Cocaine-Cocaine comes", "Cocaine – Cocaine comes"),
  s("Some of the systems and signs of cocaine use", "Some of the symptoms and signs of cocaine use"),
  s("tetanus's", "tetanus"),
  c("Amphetamines-Amphetamines are", "Amphetamines – Amphetamines are"),
  s("\"speed, crank, math, crystal,", "\"speed, crank, meth, crystal,"),
  s("the tolerance of the user the dosage", "the tolerance of the user and the dosage"),
  c("Opiates-Some opiates", "Opiates – Some opiates"),
  c(
    "\"Some common street names are horse, junk, smack, downers, M, yellow jackets, blues and ludes.\"",
    "Some common street names are \"horse, junk, smack, downers, M, yellow jackets, blues and ludes.\"",
  ),
  s("Other compounds forms", "Other compound forms"),
  d("Opiates can be injected, smoked or injected intravenously.", "Opiates can be smoked or injected intravenously.", "'injected' was listed twice"),
  c("Alcohol-Some common", "Alcohol – Some common"),
  s("a feeling of well being", "a feeling of well-being"),
  c("mood – altering", "mood-altering"),
  s("symptoms and sign of alcohol use", "symptoms and signs of alcohol use"),
  // ── Section 10 — Disciplinary action
  s("that states he has successfully completed", "that states the driver has successfully completed"),
  c("return–to-duty", "return-to-duty"),
  c("follow–up", "follow-up"),
  s("one or more SAP's and treatment facilities", "one or more SAPs and treatment facilities"),
  s("please feel free to contact as at SILVICOM INC", "please feel free to contact us at SILVICOM INC"),
  // ── Second pass, the whole text read as printed (owner: "really professional and precise")
  c("safety sensitive function", "safety-sensitive function", 3),
  c("Safety Sensitive Functions shall include", "Safety-Sensitive Functions shall include"),
  s("the effects of drug and alcohol use on driver's health", "the effects of drug and alcohol use on a driver's health"),
  d(
    "40.63(c)), a pre-employment test is not deemed to have refused to test",
    "40.63(c)) for a pre-employment test is not deemed to have refused to test",
    "the proviso read 'an employee who leaves … , a pre-employment test is not deemed' — 49 CFR 40.191(a)(2)'s wording",
    2,
  ),
  d(
    "(e.g., refuse to empty pockets when so directed by the collector, behave in a confrontational way",
    "(e.g., refusing to empty pockets when so directed by the collector, or behaving in a confrontational way",
    "the examples did not agree with 'Fails to cooperate'",
  ),
  s("the unlawful manufacture, distribution, dispensation or possession of drugs are prohibited", "the unlawful manufacture, distribution, dispensation or possession of drugs is prohibited"),
  c("engaging in activities, as stated above will be", "engaging in activities as stated above will be"),
  s("The only exception being a substance administered", "The only exception is a substance administered"),
  s("Any driver having a BAC of .04 or greater may result in disciplinary action", "A driver having a BAC of .04 or greater may be subject to disciplinary action"),
  d(
    "On a quarterly basis from the total group a computer-based random number generator program randomly selects drivers.",
    "On a quarterly basis, a computer-based random number generator program randomly selects drivers from the total group.",
    "word order",
  ),
  d(
    "shall remain readily available for such testing or may be deemed by our company as a refusal to test.",
    "shall remain readily available for such testing, or may be deemed by our company to have refused to test.",
    "the driver, not the availability, is deemed to have refused",
  ),
  c("in accordance with Part 382.603.", "in accordance with 49 CFR 382.603."),
  c("required to be in compliance with Part 382.", "required to be in compliance with 49 CFR Part 382."),
  s("conduct prohibited in the \"Use Prohibited\" (SECTION 3) of this policy", "conduct prohibited in the \"Use Prohibited\" provisions (Section 3) of this policy"),
  s("subject to a minimum of at least six unannounced tests", "subject to a minimum of six unannounced tests"),
  s("follow-up testing for both drugs and alcohol are necessary", "follow-up testing for both drugs and alcohol is necessary"),
  c("in accordance with 49 CFR 382, subpart 382.311.", "in accordance with 49 CFR Part 382, subpart 382.311."),
  s("applicants who refuse to submit to a pre-employment drug test or who receives a positive", "applicants who refuse to submit to a pre-employment drug test or who receive a positive"),
  s("the driver must contact the Medical Review Officer that he/she wishes", "the driver must notify the Medical Review Officer that he/she wishes"),
  d(
    "the BAT will have to note in the \"Remarks\" section of the driver's failure to sign.",
    "the BAT will note the driver's failure to sign in the \"Remarks\" section.",
    "the sentence's object was inside its prepositional phrase",
  ),
  s("pertaining to their use of drug and alcohol, including any records pertaining to their drug and alcohol test.", "pertaining to their use of drugs and alcohol, including any records pertaining to their drug and alcohol tests."),
  s("until such time the driver has completed", "until such time as the driver has completed"),
  c("complete a return to duty test", "complete a return-to-duty test"),
  s("The driver shall pay all expenses as a result of this program.", "The driver shall pay all expenses resulting from this program."),
  s("5 times more likely to file a worker's compensation claim; and, incur 300% higher claims.", "5 times more likely to file a workers' compensation claim, and incur 300% higher claims."),
  c("(usually metal – slim tubular devices)", "(usually slim metal tubular devices)"),
  s("reduced immune systems", "a weakened immune system"),
  s("PCP and alcohol together is dangerous", "PCP and alcohol together are dangerous"),
  s("the tolerance of the user and dosage or amount taken", "the tolerance of the user and the dosage or amount taken"),
  c("over stimulated reflexes", "overstimulated reflexes", 2),
  c("Nose bleed", "Nosebleed"),
  s("The most common are the pills, tablets or capsules. Other compound forms are in liquid or powder form.", "The most common are pills, tablets or capsules. Other forms are liquid or powder."),
  s("likely to experience distorted sense of time", "likely to experience a distorted sense of time"),
  c("Opiates are water soluble,", "Opiates are water-soluble,"),
  d(
    "What determines the rate of metabolism in the body and how fast it dissipates the alcohol depends on the altitude,",
    "How fast the body metabolizes and dissipates alcohol depends on the altitude,",
    "the subject 'What determines…' was then said to 'depend on'",
  ),
  d(
    "after the employee returns to safety-sensitive duties the driver must continue with these recommendation(s) at the cost of the employee.",
    "after the driver returns to safety-sensitive duties, the driver must continue with these recommendation(s) at the driver's expense.",
    "one person, one name: the policy calls them the driver",
  ),
  d("Any driver who has engaged in conduct prohibited in this Section", "Any driver who has engaged in conduct prohibited by this policy", "Section 10 prohibits nothing; Section 3 does"),
  s("please feel free to contact us at SILVICOM INC at:", "please feel free to contact SILVICOM INC at:"),
];
