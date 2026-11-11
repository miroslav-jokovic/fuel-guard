/**
 * Every fact a driver gives on their application — where it is asked, what kind of answer it is,
 * which rule wants it, where the carrier's packet prints it and how the office corrects it today
 * (APPLICATION-FIX-PLAN.md D-AM1, batch F1; D-AM7's parity, SCREEN-MAP §10).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * The owner's 2026-11-09 walk found the form, the office drawer and the filed packet disagreeing,
 * and the audit found the cause: one fact (a ZIP, a phone, a CDL class) has a separate definition in
 * Part 1 (`applicantScreeningContract.ts`), in Part 2 (`applicationContract.ts`), on the packet
 * (`packetFieldValues.ts`) and in the office's correction list (`editableFields.ts`, F3's card since), and nothing
 * made the four agree. This file is the list they are held to. It does not REPLACE them yet: each
 * entry names its contract path, and the parity tests derive the paths from the Zod schemas
 * themselves, so a key added to a contract without an entry here fails CI on the same merge — and
 * so does an entry for a key no contract has, a packet line nobody fills, or a packet value no
 * entry claims.
 *
 * ── WHAT IS DELIBERATELY NOT HERE (YET) ───────────────────────────────────────────────────────
 * - **The schemas.** They stay in the two contracts and are READ from there by the tests. Moving
 *   them in here would be the same Zod in a new file — "deriving beats restating" says the path is
 *   the link, not a copy. The unified rules F1 lists (non-US ZIP, any phone, CLP) are behaviour
 *   changes, and Part 1's two of them are 0376's CHECKs, so they ship as their own merges.
 * - **The words.** A fact's label is the copy its own control renders (`apply/fieldLabels.ts` points
 *   into `APPLY_COPY`, which is typed so the Spanish cannot miss a key). A label here would be the
 *   second copy that file's header was written to remove.
 * - **The wizard screen.** The one-question-per-screen wizard (F4) does not exist; its screen ids
 *   join each entry when it does.
 *
 * ── `office` IS TODAY'S DOOR, NOT THE GOAL ─────────────────────────────────────────────────────
 * D-AM7 and the owner's Q-AM13 ruling (2026-11-10): every fact the driver ANSWERED is office-editable before signing. An entry whose
 * `office` is `{ none }` is a fact that ruling does not yet reach; the reason says why, and F3's
 * single "Applicant facts" card is what closes them. Writing them down is the point: a gap recorded
 * is work, a gap nobody listed is how E4 (endorsements, the §382.301(b) answers) was found by hand.
 */

/**
 * The address of a fact in its contract: `application.<key>`, a row's column as
 * `application.<rows>[].<column>`, Part 1's as `intake.<key>` and `intake.licences[].<column>`.
 */
export type FactPath = string;

/** What kind of answer it is — the control a correction has to offer (E8: never a stored-format box). */
export type FactInput =
  | "text" | "longtext" | "date" | "month" | "us_state" | "jurisdiction" | "phone" | "us_mobile"
  | "email" | "zip" | "yesno" | "count" | "miles" | "choice" | "multi_choice" | "usdot" | "table" | "names";

/**
 * Which rule wants the fact. A §391.21(b) item, the two drug-and-alcohol rules, the §391.23 inquiry,
 * the office's own screening (drug-test site, texting zone, Med-Stop) or the carrier's own question.
 * "Optional" is not a basis: a fact nobody requires still says whose rule it serves.
 */
export type FactBasis =
  | "391.21(b)(2)" | "391.21(b)(3)" | "391.21(b)(5)" | "391.21(b)(6)" | "391.21(b)(7)"
  | "391.21(b)(8)" | "391.21(b)(9)" | "391.21(b)(10)" | "391.21(b)(11)" | "40.25(j)" | "382.301(b)"
  | "391.23(a)(2)" | "screening" | "carrier";

/**
 * Where the carrier's packet prints it: a line id (`p01.phone`), a grid column (`p02.licences#1`),
 * `{ through }` for a Part 1 fact the filing composes into an application fact (which prints it), or
 * `{ notPrinted }` with the reason. A reason that names F2 is a gap F2 closes (P1, P6, P7, P12).
 */
export type FactPacket = readonly string[] | { readonly through: FactPath } | { readonly notPrinted: string };

/**
 * Which writer corrects it — the door the office's "Applicant facts" card uses (F3,
 * `apps/web/src/features/apply/applicantFactRows.ts`, which reads this field and nothing else):
 * - `draft`: the draft-edit route (`applicationEditSchema`);
 * - `identity`: the identity correction (`applicantIdentitySchema`), the same route the Permissions
 *   and Road-test drawers use;
 * - `part_one`: the Part 1 correction (`partOneCorrectionSchema`), one answer at a time
 *   (`partOneCorrectionWith`);
 * - `part_one_answer`: one Part 1 answer the whole-set correction does not carry — the drug-and-alcohol
 *   statements, medical card pending, endorsements, donor gender (`partOneAnswerSchema`). Like `part_one`,
 *   an application fact with this door is the draft's on a legacy link;
 * - `{ none }`: no door yet — see this file's header.
 *
 * Every door writes an `application_edits` row and stops at the driver's first packet mark (F3, E7).
 *
 * ⚠ For a v2 link, which is every invitation sent since C3c2c2: the facts a v2 filing composes from
 * Part 1 (`PART_ONE_COMPOSED_KEYS`) are corrected through Part 1, and a draft edit to them would be
 * thrown away at filing, so the card sends them to Part 1 instead. A legacy link's are draft edits.
 */
export type FactOffice = "draft" | "identity" | "part_one" | "part_one_answer" | { readonly none: string };

/**
 * The owner's Q-AM13 rules for the answers that are not ordinary corrections:
 * - `statement`: the driver's own answer to a question the regulation has the employer ASK. Editable,
 *   but only with the office's reason (`application_edits.note`, 0586), which the driver reads on 3.1.
 * - `replace_only`: must never reach whoever decides the hire. The office may overwrite it, never read
 *   it: the value is not sent to the browser, and its edit row records only THAT it changed
 *   (`application_edits.withheld`, 0586).
 */
export type FactRule = "statement" | "replace_only";

export interface ApplicantFact {
  readonly path: FactPath;
  readonly input: FactInput;
  readonly basis: FactBasis;
  readonly packet: FactPacket;
  readonly office: FactOffice;
  readonly rule?: FactRule;
}

// ── the packet's lines that print a person's whole name ──────────────────────

/**
 * Every line `fullName` fills (`packetSigningFields.ts`, `markSides`, pages 15/18/19). One list,
 * because each name part prints on all of them — and an entry claiming fewer would be the drift
 * AUD-18 found between page 15 and page 22.
 */
export const PACKET_FULL_NAME_LINES = [
  "p03.printed_name", "p04.printed_name", "p10.printed_name", "p15.name", "p18.driver_name",
  "p19.driver_name", "p22.printed_name", "p26.name", "p28.driver_owner_name", "p31.driver_name",
  "p31.owner_operator_name", "p31.aka_op",
] as const;

const both = (field: string): string[] => [`p18.${field}`, `p19.${field}`];

// ── the packet gaps F2 closes, named once ────────────────────────────────────

const ADDENDUM = (item: string) => ({
  notPrinted: `the carrier's paper has no place for it; F2's employment addendum page 12a prints it (${item})`,
});
const EMPTY_GRID = { notPrinted: "the answer IS the empty grid: a declaration of none prints no rows" };

// ── the office gaps F3 closes, named once ────────────────────────────────────

/** The driver's own drug-and-alcohol statements (Q-AM13): corrected one at a time, with a reason. */
const STATEMENT = { office: "part_one_answer", rule: "statement" } as const;

type Door = FactOffice | { readonly office: FactOffice; readonly rule: FactRule };
const door = (d: Door) => (typeof d === "object" && "office" in d ? d : { office: d });
const app = (
  key: string,
  input: FactInput,
  basis: FactBasis,
  packet: FactPacket,
  office: Door = "draft",
): ApplicantFact => ({ path: `application.${key}`, input, basis, packet, ...door(office) });
const intake = (key: string, input: FactInput, basis: FactBasis, packet: FactPacket, office: Door): ApplicantFact => ({
  path: `intake.${key}`, input, basis, packet, ...door(office),
});

/** The catalogue. Order is the order the driver meets the facts. */
export const APPLICANT_FACTS: readonly ApplicantFact[] = [
  // ── Part 1 (`applicantIntakeSchema`, `applicantIntakeLicenceSchema`) ──
  intake("date_of_birth", "date", "391.21(b)(2)", { through: "application.date_of_birth" }, "identity"),
  intake("phone", "us_mobile", "391.21(b)(2)", { through: "application.phone" }, "part_one"),
  intake("address_line1", "text", "391.21(b)(3)", { through: "application.addresses[].line1" }, "part_one"),
  intake("address_line2", "text", "391.21(b)(3)", { through: "application.addresses[].line2" }, "part_one"),
  intake("city", "text", "391.21(b)(3)", { through: "application.addresses[].city" }, "part_one"),
  intake("state", "us_state", "391.21(b)(3)", { through: "application.addresses[].state" }, "part_one"),
  intake("postal_code", "zip", "391.21(b)(3)", { through: "application.addresses[].postal_code" }, "part_one"),
  intake("cdl_class", "choice", "391.21(b)(5)", { through: "application.cdl_class" }, "part_one"),
  intake("licences[].state_code", "jurisdiction", "391.21(b)(5)", { through: "application.cdl_state" }, "part_one"),
  intake("licences[].agency", "text", "391.21(b)(5)", { through: "application.additional_licences[].issuing_authority" }, "part_one"),
  intake("licences[].licence_number", "text", "391.21(b)(5)", { through: "application.cdl_number" }, "part_one"),
  intake("licences[].expires_on", "date", "391.21(b)(5)", { through: "application.cdl_expires_at" }, "part_one"),
  intake("endorsements[]", "multi_choice", "screening",
    { notPrinted: "a declaration verified on the MVR, kept on the intake row only (0376); F2 prints it on the licence line (P12)" },
    "part_one_answer"),
  intake("prior_positive_2y", "yesno", "40.25(j)", { through: "application.prior_failed_pre_employment_test" }, STATEMENT),
  intake("dot_program_30d", "yesno", "382.301(b)", { notPrinted: "a lead for the §382.301(b) exception, the employer's to verify" }, STATEMENT),
  intake("dot_tested_6m", "yesno", "382.301(b)", { notPrinted: "a lead for the §382.301(b) exception, the employer's to verify" }, STATEMENT),
  intake("dot_random_12m", "yesno", "382.301(b)", { notPrinted: "a lead for the §382.301(b) exception, the employer's to verify" }, STATEMENT),
  intake("donor_gender", "choice", "screening",
    { notPrinted: "Med-Stop's donor field; must never reach anything the person deciding the hire reads (DONOR_GENDERS)" },
    { office: "part_one_answer", rule: "replace_only" }),
  intake("medical_card_pending", "yesno", "screening", { notPrinted: "a state of the documents, shown on the office drawer" },
    "part_one_answer"),

  // ── (b)(2) identity ──
  app("first_name", "text", "391.21(b)(2)", ["p01.name#1", "p12.identity#1", ...PACKET_FULL_NAME_LINES]),
  app("middle_name", "text", "391.21(b)(2)", ["p01.name#2", ...PACKET_FULL_NAME_LINES]),
  app("last_name", "text", "391.21(b)(2)", ["p01.name#0", "p12.identity#0", ...PACKET_FULL_NAME_LINES]),
  app("date_of_birth", "date", "391.21(b)(2)", ["p01.dob", "p12.identity#3", "p15.dob"], "identity"),
  app("other_names[]", "names", "391.23(a)(2)", ["p12.identity#2"]),
  app("email", "email", "391.21(b)(2)", { notPrinted: "the carrier's paper has no e-mail line; F2's addendum prints it (P7)" }),
  app("phone", "phone", "391.21(b)(2)", ["p01.phone"], "part_one"),

  // ── (b)(3) residence ──
  app("addresses[].line1", "text", "391.21(b)(3)", ["p01.address#0", ...both("address")], "part_one"),
  app("addresses[].line2", "text", "391.21(b)(3)", ["p01.address#0", ...both("address")], "part_one"),
  app("addresses[].city", "text", "391.21(b)(3)", ["p01.address#1", ...both("city")], "part_one"),
  app("addresses[].state", "us_state", "391.21(b)(3)", ["p01.address#2", ...both("state")], "part_one"),
  app("addresses[].postal_code", "zip", "391.21(b)(3)", ["p01.address#3", ...both("zip")], "part_one"),
  app("addresses[].from", "month", "391.21(b)(3)", ADDENDUM("P6")),
  app("addresses[].to", "month", "391.21(b)(3)", ADDENDUM("P6")),

  // ── (b)(5) licences ──
  app("cdl_number", "text", "391.21(b)(5)", ["p01.cdl", "p02.licences#1", ...both("cdl")], "identity"),
  app("cdl_state", "jurisdiction", "391.21(b)(5)", ["p01.cdl", "p02.licences#0", ...both("cdl_state")], "identity"),
  app("cdl_class", "choice", "391.21(b)(5)", ["p02.licences#2"], "part_one"),
  app("cdl_expires_at", "date", "391.21(b)(5)", ["p02.licences#3", ...both("cdl_expires")], "part_one"),
  app("additional_licences[].issuing_authority", "jurisdiction", "391.21(b)(5)", ["p02.licences#0"], "part_one"),
  app("additional_licences[].number", "text", "391.21(b)(5)", ["p02.licences#1"], "part_one"),
  app("additional_licences[].kind", "text", "391.21(b)(5)", ["p02.licences#2"], "part_one"),
  app("additional_licences[].expires_at", "date", "391.21(b)(5)", ["p02.licences#3"], "part_one"),

  // ── (b)(6) experience ──
  app("experience", "longtext", "391.21(b)(6)", ADDENDUM("P7")),
  // The class picks the ROW: the carrier printed the four class names in column 0, which is never written.
  app("equipment_experience[].equipment_class", "choice", "391.21(b)(6)", ["p02.experience"]),
  app("equipment_experience[].equipment_type", "text", "391.21(b)(6)", ["p02.experience#1"]),
  app("equipment_experience[].from", "month", "391.21(b)(6)", ["p02.experience#2"]),
  app("equipment_experience[].to", "month", "391.21(b)(6)", ["p02.experience#3"]),
  app("equipment_experience[].approx_miles", "miles", "391.21(b)(6)", ["p02.experience#4"]),

  // ── (b)(7) accidents, (b)(8) convictions, (b)(9) denials ──
  app("declares_no_accidents", "yesno", "391.21(b)(7)", EMPTY_GRID),
  app("accidents[].occurred_on", "date", "391.21(b)(7)", ["p02.accidents#0"]),
  app("accidents[].nature", "longtext", "391.21(b)(7)", ["p02.accidents#1"]),
  app("accidents[].fatalities", "count", "391.21(b)(7)", ["p02.accidents#2"]),
  app("accidents[].injuries", "count", "391.21(b)(7)", ["p02.accidents#3"]),
  app("accidents[].hazmat_spill", "yesno", "391.21(b)(7)", ["p02.accidents#4"]),
  app("declares_no_violations", "yesno", "391.21(b)(8)", EMPTY_GRID),
  app("violations[].occurred_on", "date", "391.21(b)(8)", ["p02.convictions#0"]),
  app("violations[].offence", "text", "391.21(b)(8)", ["p02.convictions#1"]),
  app("violations[].state", "jurisdiction", "391.21(b)(8)", ["p02.convictions#2"]),
  app("violations[].penalty", "text", "391.21(b)(8)", ["p02.convictions#3"]),
  app("licence_ever_denied", "yesno", "391.21(b)(9)",
    ["p02.denied.yes", "p02.denied.no", "p02.revoked.yes", "p02.revoked.no"]),
  app("licence_denial_detail", "longtext", "391.21(b)(9)", ["p02.denied.explain"]),
  app("prior_failed_pre_employment_test", "yesno", "40.25(j)", ["p26.prior_test.yes", "p26.prior_test.no"], STATEMENT),

  // ── (b)(10)/(b)(11) employers ──
  app("declares_no_employment", "yesno", "391.21(b)(10)", EMPTY_GRID),
  app("employers[].employer_name", "text", "391.21(b)(10)", ["p12.employment#1"]),
  app("employers[].usdot_number", "usdot", "391.23(a)(2)", ADDENDUM("P1")),
  app("employers[].address_line1", "text", "391.21(b)(10)", ["p12.employment#2"]),
  app("employers[].city", "text", "391.21(b)(10)", ["p12.employment#2"]),
  app("employers[].state", "us_state", "391.21(b)(10)", ["p12.employment#2"]),
  app("employers[].phone", "phone", "391.23(a)(2)", ["p12.employment#4"]),
  app("employers[].email", "email", "391.23(a)(2)", ADDENDUM("P1")),
  app("employers[].position_held", "text", "391.21(b)(10)", ["p12.employment#3"]),
  app("employers[].started_on", "date", "391.21(b)(10)", ["p12.employment#0"]),
  app("employers[].ended_on", "date", "391.21(b)(10)", ["p12.employment#0"]),
  app("employers[].operated_cmv", "yesno", "391.21(b)(11)", ADDENDUM("P1")),
  app("employers[].dot_regulated", "yesno", "391.23(a)(2)", ADDENDUM("P1")),
  app("employers[].reason_for_leaving", "longtext", "391.21(b)(10)", ADDENDUM("P1")),
  app("employers[].subject_to_fmcsr", "yesno", "391.21(b)(10)", ADDENDUM("P1")),
  app("employers[].safety_sensitive", "yesno", "391.21(b)(10)", ADDENDUM("P1")),
  app("employment_gaps[].from", "date", "391.21(b)(10)", ADDENDUM("gap explanations")),
  app("employment_gaps[].to", "date", "391.21(b)(10)", ADDENDUM("gap explanations")),
  app("employment_gaps[].explanation", "longtext", "391.21(b)(10)", ADDENDUM("gap explanations")),

  // ── the carrier's questionnaire (`questionnaireContract.ts`) ──
  app("questionnaire_answers.position", "text", "carrier", ["p01.position"]),
  app("questionnaire_answers.applying_as", "choice", "carrier", ["p22.reason.contracting"]),
  app("questionnaire_answers.heard_from", "text", "carrier", ["p01.heard_from"]),
  app("questionnaire_answers.legally_work", "yesno", "carrier", ["p01.legally_work"]),
  app("questionnaire_answers.proof_of_age", "yesno", "carrier", ["p01.proof_of_age"]),
  app("questionnaire_answers.may_contact_employers", "yesno", "391.23(a)(2)", ["p01.contact_employers"]),
  app("questionnaire_answers.education[]", "table", "carrier", ["p16.education"]),
  app("questionnaire_answers.military_service", "yesno", "carrier", ["p16.military"]),
  app("questionnaire_answers.military_when", "text", "carrier", ["p16.military_when"]),
  app("questionnaire_answers.other_training", "longtext", "carrier", ["p16.training.1", "p16.training.2", "p16.training.3"]),
  app("questionnaire_answers.references", "table", "carrier", ["p16.references"]),
  app("questionnaire_answers.eeo", "choice", "carrier",
    { notPrinted: "reserved: never shown to the person deciding the hire (questionnaireContract's eeo key)" },
    {
      none:
        "NEVER ASKED: no screen writes the reserved key (questionnaireAnswers' `eeo` is only a schema slot), so there is "
        + "no answer to correct; Q-AM13's replace-only rule applies the day a screen asks it",
    }),
  // One fact for every question the carrier wrote: the card lays it out once per question on THIS
  // applicant's stamp, each with its kind's control (`applicantFactRows`), and the API checks a correction
  // against that stamp (`carrierAnswerRefusal`) — the draft does not carry it (Q-CQ7). F3c part 2, step 5.
  app("carrier_answers", "choice", "carrier",
    { notPrinted: "printed on the application's own questions page (questionnairePage.ts), not on the carrier's paper" }),

  // ── the one fact on its own endpoint ──
  {
    path: "ssn",
    input: "text",
    basis: "391.21(b)(2)",
    packet: { notPrinted: "never drawn (D-HIRE6); printing the last four is Q-AM3" },
    office: {
      none:
        "exists only AFTER signing: the driver types it on the sign-off screen and it is sealed into driver_applications "
        + "(D-APP3), so before signing there is nothing to replace — the door needs an owner ruling (APPLICATION-FIX-PLAN §7)",
    },
  },
];

/**
 * Contract keys that are NOT a fact the driver gives, each with why. The parity test treats a key
 * as covered when it is a fact above OR named here, so this is where a new stamp or act is declared.
 */
export const NOT_APPLICANT_FACTS: Readonly<Record<FactPath, string>> = {
  "application.certified": "the §391.21(b) certification is an act the driver performs, never an answer",
  "application.signed_name": "the signature of record (D-APP8), an act",
  "application.employers[].key": "the row's stable id (AW1, D-AW8), minted by the form",
  "application.questionnaire_version": "which definition the answers were given against, stamped at submit",
  "application.questionnaire_required[]": "the invitation's stamp of required questions (D-RS4)",
  "application.carrier_questions[].id": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "application.carrier_questions[].wording": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "application.carrier_questions[].hint": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "application.carrier_questions[].kind": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "application.carrier_questions[].choices[]": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "application.carrier_questions[].required": "the invitation's stamp of the carrier's questions (D-CQ2)",
  "intake.fcra_summary_version": "which FCRA summary the screen showed — an acknowledgement, not an answer",
};

/** Facts that live on no contract the tests can walk — the SSN's own narrow endpoint (D-HIRE6). */
export const OFF_CONTRACT_FACTS: readonly FactPath[] = ["ssn"];

export const applicantFact = (path: FactPath): ApplicantFact | undefined =>
  APPLICANT_FACTS.find((f) => f.path === path);

/**
 * The catalogue entry for one application path, as the edit routes address it: `["phone"]`,
 * `["addresses", 1, "city"]` (a row's column, by index or key), `["questionnaire", "eeo"]` (the draft's
 * name for `questionnaire_answers`). Undefined for a path no fact claims.
 */
export function applicationFactAt(path: readonly (string | number)[]): ApplicantFact | undefined {
  const [head, at, column] = path;
  const key = head === "questionnaire" ? "questionnaire_answers" : String(head ?? "");
  if (key === "questionnaire_answers" && typeof at === "string") return applicantFact(`application.${key}.${at}`);
  if (at === undefined) return applicantFact(`application.${key}`);
  if (column === undefined) return applicantFact(`application.${key}[]`);
  return applicantFact(`application.${key}[].${String(column)}`);
}

/** The Part 1 key an application fact is composed from (`{ through }`), e.g. `prior_failed_pre_employment_test` → `prior_positive_2y`. */
export function partOneKeyThrough(applicationPath: FactPath): string | undefined {
  const from = APPLICANT_FACTS.find(
    (f) => f.path.startsWith("intake.") && !Array.isArray(f.packet) && "through" in f.packet && f.packet.through === applicationPath,
  );
  return from?.path.slice("intake.".length);
}
