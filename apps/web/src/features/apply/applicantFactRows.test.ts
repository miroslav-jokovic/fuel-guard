import { describe, expect, it } from "vitest";
import {
  APPLICANT_FACTS, RATHER_NOT_SAY, carrierQuestionnaire, questionnaireForApplicant, type CarrierQuestionStamp, type PartOneFactsView,
} from "@silvicom/shared";
import { fromDraftPayload } from "./draft";
import { buildReviewSummary } from "./reviewSummary";
import { applicantFactRows, factSections, jobsMatch, questionControl, type FactRow } from "./applicantFactRows";
import { correctionFor } from "./factCorrection";

/**
 * The "Applicant facts" card's rows (F3). What is worth pinning is that the card is the CATALOGUE —
 * every fact with a door is a row, once, with the catalogue's input kind — and that on a v2 link each
 * row sends its correction to the writer filing will take the answer from.
 */

/** Step 5: the carrier's own questions, as stamped on THIS applicant's invitation (D-CQ2). */
const TERMINAL = "11111111-1111-4111-8111-111111111111";
const START = "22222222-2222-4222-8222-222222222222";
const STARTED = "33333333-3333-4333-8333-333333333333";
const MILES = "44444444-4444-4444-8444-444444444444";
const STAMP: CarrierQuestionStamp = [
  { id: TERMINAL, wording: "Which terminal would you report to?", hint: null, kind: "select", choices: ["Melrose Park", "Joliet"], required: true },
  { id: START, wording: "Can you start within two weeks?", hint: null, kind: "boolean", choices: null, required: false },
  { id: STARTED, wording: "When did you last drive?", hint: null, kind: "date", choices: null, required: false },
  { id: MILES, wording: "How many miles last year?", hint: null, kind: "number", choices: null, required: true },
];

const PAYLOAD = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  other_names: ["Susan Smith"], email: "s@example.test", phone: "3125550000",
  addresses: [
    { line1: "9 Old Rd", line2: null, city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12" },
    { line1: "1 Draft St", line2: null, city: "Draftville", state: "IL", postal_code: "60000", from: "2023-01", to: null },
  ],
  cdl_number: "DRAFT1", cdl_state: "IL", cdl_class: "B", cdl_expires_at: "2028-01-01",
  additional_licences: [{ issuing_authority: "WI", number: "W-1", kind: "CDL", expires_at: "2027-01-01" }],
  experience: "Ten years of line haul.",
  equipment_experience: [{ equipment_class: "Tractor and semi-trailer", equipment_type: "Dry van", from: "2015-01", to: null, approx_miles: 900000 }],
  declares_no_accidents: false,
  accidents: [{ occurred_on: "2024-03-01", nature: "Rear-ended", fatalities: 0, injuries: 0, hazmat_spill: false }],
  declares_no_violations: false,
  violations: [{ occurred_on: "2023-05-01", offence: "Speeding", state: "IL", penalty: "Fine" }],
  licence_ever_denied: false, licence_suspended: false, licence_denial_detail: null, prior_failed_pre_employment_test: false,
  declares_no_employment: false,
  employers: [{ key: "k1", employer_name: "Old Carrier" }],
  employment_gaps: [],
  questionnaire: {
    position: "Line-haul driver", legally_work: true,
    education: [{ school: "Joliet JC", years_completed: "2", field_of_study: "", graduated: false, graduated_when: "" }],
    references: [{ full_name: "Ann Lee", years_known: "5", phone: "3125550100" }],
  },
  carrier_answers: { [TERMINAL]: "Joliet", [START]: RATHER_NOT_SAY.value, [STARTED]: "03/01/2026" },
};

const PART_ONE: PartOneFactsView = {
  intake: {
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false, cdl_class: "A", endorsements: ["N", "H"],
  },
  licences: [
    { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
    // Expired: composition does not FILE it, but Part 1 holds it and the MVR is ordered from it.
    { position: 1, state_code: "IN", agency: null, licence_number: "IN-9", expires_on: "2020-01-01" },
  ],
  asOf: "2026-11-10",
};

const ANSWERS = {
  dot_program_30d: true, dot_tested_6m: false, dot_random_12m: null, medical_card_pending: false,
  endorsements: ["N", "H"], donorGenderGiven: true,
};
const rows = (over: {
  partOne?: PartOneFactsView | null; edits?: Array<{ path: Array<string | number> }>; answers?: typeof ANSWERS | null; carrier?: CarrierQuestionStamp;
} = {}) =>
  applicantFactRows({
    payload: PAYLOAD, partOne: over.partOne ?? null, edits: over.edits ?? [], questionnaire: questionnaireForApplicant(),
    partOneAnswers: over.answers === undefined ? (over.partOne ? ANSWERS : null) : over.answers,
    carrier: over.carrier ?? STAMP,
  });
const row = (list: FactRow[], key: string) => list.find((r) => r.key === key);

describe("the card is the catalogue", () => {
  it("offers every application fact that has a door, with the catalogue's own input kind", () => {
    const list = rows();
    for (const fact of APPLICANT_FACTS) {
      if (!fact.path.startsWith("application.") || typeof fact.office !== "string") continue;
      if (/^application\.(employers|employment_gaps)\[\]/.test(fact.path)) continue; // the card's jobs timeline
      const id = fact.path.replace(/^application\./, "").replace(/^questionnaire_answers\./, "questionnaire.");
      // A table answer is one row per row given, at `["questionnaire", id, i]` (F3c part 2).
      if (fact.input === "table") {
        const q = id.replace(/^questionnaire\./, "").replace(/\[\]$/, "");
        const tableRows = list.filter((r) => r.path[0] === "questionnaire" && r.path[1] === q && typeof r.path[2] === "number");
        expect(tableRows.length, fact.path).toBeGreaterThan(0);
        for (const r of tableRows) expect(r.input, fact.path).toBe("table");
        continue;
      }
      // The carrier's own questions are one row per stamped question, each with its kind's control (step 5).
      // F2b: the endorsements are Part 1's, so a legacy link has none (pinned in the Q-AM13 block below).
      if (id === "cdl_endorsements[]") continue;
      if (id === "carrier_answers") {
        expect(list.filter((r) => r.path[0] === "carrier_answers").map((r) => r.input), fact.path)
          .toEqual(STAMP.map((q) => questionControl(q.kind)));
        continue;
      }
      const [name, column] = id.split("[].");
      const matching = list.filter((r) => {
        const [head, at, col] = r.path;
        if (column) return head === name && typeof at === "number" && col === column;
        if (name!.endsWith("[]")) return head === name!.slice(0, -2) && typeof at === "number";
        return r.key === name;
      });
      // A question the live questionnaire no longer asks has no label to show, so no row.
      if (name!.startsWith("questionnaire.") && !questionnaireForApplicant().questions.some((q) => `questionnaire.${q.id}` === name)) continue;
      expect(matching.length, fact.path).toBeGreaterThan(0);
      for (const r of matching) expect(r.input, fact.path).toBe(fact.input);
    }
  });

  it("keeps each row's answers together, row by row, in the catalogue's column order", () => {
    const addresses = rows().filter((r) => r.path[0] === "addresses").map((r) => r.key);
    expect(addresses.slice(0, 3)).toEqual(["addresses.0.line1", "addresses.0.line2", "addresses.0.city"]);
    expect(addresses.indexOf("addresses.0.to")).toBeLessThan(addresses.indexOf("addresses.1.line1"));
  });

  it("still lists the answers when the response carries no edits", () => {
    const list = applicantFactRows({ payload: PAYLOAD, partOne: null, edits: undefined as never, questionnaire: questionnaireForApplicant() });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => !r.corrected)).toBe(true);
  });

  it("lists each answer once", () => {
    const keys = rows().map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("offers no fact the catalogue has no door for yet, and never the jobs (they have their own form)", () => {
    const list = rows();
    expect(row(list, "questionnaire.eeo")).toBeUndefined(); // never asked (the catalogue's reason)
    expect(list.some((r) => r.path[0] === "employers" || r.path[0] === "employment_gaps")).toBe(false);
  });

  it("labels the carrier's questions by the question and stores them where the draft does", () => {
    const position = row(rows(), "questionnaire.position")!;
    expect(position.label).toBe("Position you are applying for");
    expect(position.value).toBe("Line-haul driver");
    expect(position.door).toBe("draft");
  });

  it("step 5: lays the carrier's own questions out from THIS applicant's stamp, worded and ordered as they were asked", () => {
    const own = rows().filter((r) => r.path[0] === "carrier_answers");
    expect(own.map((r) => [r.label, r.value, r.door, r.section])).toEqual([
      ["Which terminal would you report to?", "Joliet", "draft", "questions"],
      ["Can you start within two weeks?", RATHER_NOT_SAY.value, "draft", "questions"],
      ["When did you last drive?", "03/01/2026", "draft", "questions"],
      ["How many miles last year?", null, "draft", "questions"],
    ]);
    // The select offers exactly its frozen choices; only an optional question offers the skip.
    expect(own[0]!.choices?.map((c) => c.value)).toEqual(["Melrose Park", "Joliet"]);
    expect(own.map((r) => r.skip?.value ?? null)).toEqual([null, RATHER_NOT_SAY.value, RATHER_NOT_SAY.value, null]);
    // An answer to a question the stamp does not hold is not a row; no stamp, no rows.
    expect(rows({ carrier: STAMP.slice(1) }).some((r) => r.key === `carrier_answers.${TERMINAL}`)).toBe(false);
    expect(rows({ carrier: [] }).some((r) => r.path[0] === "carrier_answers")).toBe(false);
  });

  it("step 5: corrects a date and a number in the plain box the applicant's form typed them into", () => {
    expect(["text", "longtext", "boolean", "select", "date", "number"].map(questionControl))
      .toEqual(["text", "longtext", "yesno", "choice", "text", "count"]);
    const edit = correctionFor(row(rows(), `carrier_answers.${STARTED}`)!, "04/01/2026", { revision: 7, partOne: null, rows: [], addresses: [] });
    expect(edit).toEqual({ door: "draft", edit: { path: ["carrier_answers", STARTED], value: "04/01/2026", revision: 7 } });
  });

  it("offers a built-in optional question's skip too, as the form does", () => {
    const military = row(rows(), "questionnaire.military_service");
    expect(military?.skip).toEqual(RATHER_NOT_SAY);
    expect(row(rows(), "questionnaire.position")?.skip).toBeUndefined();
  });

  it("gives a choice its options from the contract's own constant", () => {
    expect(row(rows(), "cdl_class")!.choices?.map((c) => c.value)).toEqual(["A", "B", "C"]);
  });

  it("groups the rows by the section the driver met them in, in the application's order", () => {
    const sections = factSections(rows()).map((g) => g.section);
    expect(sections.indexOf("identity")).toBeLessThan(sections.indexOf("licence"));
    expect(new Set(sections).size).toBe(sections.length);
  });

  it("marks an answer the office corrected — and every cell of a row it replaced", () => {
    const list = rows({ edits: [{ path: ["first_name"] }, { path: ["additional_licences", 0] }] });
    expect(row(list, "first_name")!.corrected).toBe(true);
    expect(row(list, "last_name")!.corrected).toBe(false);
    expect(row(list, "additional_licences.0.number")!.corrected).toBe(true);
  });
});

describe("on a v2 link, each answer is corrected where filing takes it from", () => {
  const v2 = () => rows({ partOne: PART_ONE });

  it("shows Part 1's phone, not the draft's copy, and corrects it at Part 1", () => {
    const phone = row(v2(), "phone")!;
    expect(phone.value).toBe("+13125550142");
    expect(phone.door).toBe("part_one");
    expect(row(rows(), "phone")!.door).toBe("draft"); // legacy: the draft's own answer
  });

  it("gives the CURRENT home Part 1's street and door, and keeps earlier homes and the months the driver's", () => {
    const list = v2();
    expect(row(list, "addresses.1.line1")).toMatchObject({ value: "1 Main St", door: "part_one" });
    expect(row(list, "addresses.0.line1")).toMatchObject({ value: "9 Old Rd", door: "draft" });
    expect(row(list, "addresses.1.from")).toMatchObject({ value: "2023-01", door: "draft" });
  });

  it("shows every licence Part 1 holds — the expired one too — and no column Part 1 never asks", () => {
    const list = v2();
    expect(row(list, "additional_licences.0.number")).toMatchObject({ value: "IN-9", door: "part_one" });
    expect(row(list, "additional_licences.0.kind")).toBeUndefined();
    expect(row(list, "cdl_number")).toMatchObject({ value: "IL123", door: "identity" });
  });

  it("sends a Part 1 change as the whole set with that one answer changed", () => {
    const list = v2();
    const c = correctionFor(row(list, "addresses.1.city")!, "Aurora", { revision: 3, partOne: PART_ONE, rows: list, addresses: PAYLOAD.addresses });
    expect(c).toMatchObject({ door: "part_one", body: { city: "Aurora", address_line1: "1 Main St", phone: "+13125550142" } });
  });

  it("refuses, in the contract's words, a Part 1 change the route would refuse", () => {
    const list = v2();
    const c = correctionFor(row(list, "addresses.1.postal_code")!, "123", { revision: 3, partOne: PART_ONE, rows: list, addresses: PAYLOAD.addresses });
    expect(c).toEqual({ problem: "A ZIP code is five digits" });
  });
});

describe("the request each door takes", () => {
  const list = rows();
  const ctx = { revision: 7, partOne: null, rows: list, addresses: PAYLOAD.addresses };

  it("sends a draft answer as its path, its value and the revision read", () => {
    expect(correctionFor(row(list, "middle_name")!, "Ann", ctx)).toEqual({ door: "draft", edit: { path: ["middle_name"], value: "Ann", revision: 7 } });
  });

  /** The browser-pass finding in `draftStored`'s ⚠: a null in the draft takes the summary down. */
  it("⚠ sends a cleared draft answer as the form's own blank, never null", () => {
    const line2 = row(list, "addresses.0.line2")!;
    for (const typed of ["  ", "", null]) {
      expect(correctionFor(line2, typed, ctx)).toEqual({ door: "draft", edit: { path: ["addresses", 0, "line2"], value: "", revision: 7 } });
    }
  });

  it("…and the summary the drawer and the driver read survives that blank, where a null would not", () => {
    const summarise = (line2: unknown) => () => {
      const home = { line1: "9 Old Rd", line2, city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "" };
      const d = fromDraftPayload({ first_name: "Susan", last_name: "Godfrey", addresses: [home], employers: [], questionnaire: {} });
      buildReviewSummary({ draft: d, questionnaire: questionnaireForApplicant(), carrier: carrierQuestionnaire([]), captures: [] });
    };
    expect(summarise("")).not.toThrow();
    expect(summarise(null)).toThrow();
  });

  it("sends the identity as all three values, the two unchanged ones as shown", () => {
    expect(correctionFor(row(list, "date_of_birth")!, "1980-01-04", ctx)).toEqual({
      door: "identity", identity: { date_of_birth: "1980-01-04", cdl_number: "DRAFT1", cdl_state: "IL" },
    });
  });

  it("refuses a blank licence number before it is sent", () => {
    expect(correctionFor(row(list, "cdl_number")!, "", ctx)).toHaveProperty("problem");
  });
});

describe("the driver's own statements and the blind answers (Q-AM13)", () => {
  it("offers §40.25(j) as a statement: the draft's on a legacy link, Part 1's on a v2 one", () => {
    expect(row(rows(), "prior_failed_pre_employment_test")).toMatchObject({ door: "draft", rule: "statement", value: false });
    expect(row(rows({ partOne: PART_ONE }), "prior_failed_pre_employment_test")).toMatchObject({ door: "part_one_answer", rule: "statement" });
  });

  it("shows Part 1's own answers on a v2 link only, beside the application's facts of the same kind", () => {
    const list = rows({ partOne: PART_ONE });
    expect(row(list, "dot_program_30d")).toMatchObject({ value: true, rule: "statement", section: "safety", door: "part_one_answer" });
    // F2b: filed as `cdl_endorsements`, so the card names it there, in the roster's order, one set.
    expect(row(list, "cdl_endorsements")).toMatchObject({ value: ["H", "N"], section: "licence", input: "multi_choice", door: "part_one_answer" });
    expect(row(list, "endorsements")).toBeUndefined();
    expect(row(rows(), "cdl_endorsements")).toBeUndefined();
    expect(row(list, "medical_card_pending")).toMatchObject({ value: false, section: "documents" });
    expect(row(rows(), "dot_program_30d")).toBeUndefined();
  });

  it("⚠ never holds the donor gender — only whether one was given", () => {
    const gender = row(rows({ partOne: PART_ONE }), "donor_gender")!;
    expect(gender).toMatchObject({ value: null, given: true, rule: "replace_only" });
    expect(gender.choices?.map((c) => c.value)).toEqual(["male", "female", "declined"]);
  });

  it("refuses a statement without a reason, whichever writer holds it", () => {
    for (const partOne of [null, PART_ONE]) {
      const list = rows({ partOne });
      const ctx = { revision: 7, partOne, rows: list, addresses: PAYLOAD.addresses };
      expect(correctionFor(row(list, "prior_failed_pre_employment_test")!, true, ctx, "  ")).toHaveProperty("problem");
    }
  });

  it("sends §40.25(j) on a v2 link as Part 1's own key, with the reason", () => {
    const list = rows({ partOne: PART_ONE });
    const c = correctionFor(row(list, "prior_failed_pre_employment_test")!, true, { revision: 7, partOne: PART_ONE, rows: list, addresses: [] }, " Called 11/10 ");
    expect(c).toEqual({ door: "part_one_answer", answer: { key: "prior_positive_2y", value: true, note: "Called 11/10" } });
  });

  it("sends the reason with a legacy link's draft statement", () => {
    const list = rows();
    const c = correctionFor(row(list, "prior_failed_pre_employment_test")!, true, { revision: 7, partOne: null, rows: list, addresses: [] }, "Called");
    expect(c).toMatchObject({ door: "draft", edit: { path: ["prior_failed_pre_employment_test"], value: true, note: "Called" } });
  });

  it("sends endorsements as the ticked list and the donor gender with no reason", () => {
    const list = rows({ partOne: PART_ONE });
    const ctx = { revision: 7, partOne: PART_ONE, rows: list, addresses: [] };
    expect(correctionFor(row(list, "cdl_endorsements")!, ["H", "T"], ctx)).toEqual({ door: "part_one_answer", answer: { key: "endorsements", value: ["H", "T"] } });
    expect(correctionFor(row(list, "donor_gender")!, "male", ctx)).toEqual({ door: "part_one_answer", answer: { key: "donor_gender", value: "male" } });
  });
});

/**
 * F3c part 2: the jobs are the card's Employment group, drawn by the timeline, not as rows — so the
 * row filter alone could never find them, and "employer" typed into the search hid the jobs it named.
 */
describe("finding the jobs with the card's search", () => {
  const jobs = [{ employer_name: "Werner Enterprises" }];
  it("shows them with no search, by the employer's name, or by the employer form's own labels", () => {
    expect(jobsMatch("", jobs)).toBe(true);
    expect(jobsMatch("  werner ", jobs)).toBe(true);
    expect(jobsMatch("reason", jobs)).toBe(true); // the form's "reason for leaving"
    expect(jobsMatch("gap", [])).toBe(true);
  });
  it("leaves them out of a search for another answer", () => {
    expect(jobsMatch("date of birth", jobs)).toBe(false);
    expect(jobsMatch("swift", jobs)).toBe(false);
  });
});

/**
 * F3c part 2, step 4: education and references — a carrier question answered as a table — are on the
 * card as one row per row the driver gave, each corrected whole.
 */
describe("a table answer on the card", () => {
  it("lists each row the driver gave, labelled by the question and its number, with its columns", () => {
    const ref = row(rows(), "questionnaire.references.0")!;
    expect(ref.label).toBe("Three personal references · 1");
    expect(ref.door).toBe("draft");
    expect(ref.columns?.map((c) => [c.id, c.input])).toEqual([["full_name", "text"], ["years_known", "count"], ["phone", "text"]]);
  });
});
