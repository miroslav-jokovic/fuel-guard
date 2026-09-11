import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_CLASS_LABELS,
  questionnaireForApplicant,
  type ApplicationCaptureView,
  type EquipmentClass,
} from "@silvicom/shared";
import { buildReviewSummary, showDate, showMonth, type ReviewSection } from "./reviewSummary";
import {
  emptyAccident,
  emptyAddress,
  emptyDraft,
  emptyEmployer,
  emptyEquipment,
  emptyLicence,
  emptyViolation,
  type ApplicationDraft,
} from "./draft";

/**
 * The screen a driver certifies (D-AX6).
 *
 * ⚠ The first test is the one that matters, and it is written so that it cannot be satisfied by
 * agreeing with the implementation. It WALKS a fully answered draft and asserts every answer in it
 * reaches the screen — so a field added to the form and forgotten here fails the build, which is
 * exactly what did not happen to `equipment_experience`, `other_names`,
 * `prior_failed_pre_employment_test` and the whole questionnaire when each of them was added.
 */

function filled(): ApplicationDraft {
  const d = emptyDraft();
  d.first_name = "Susan";
  d.middle_name = "Marie";
  d.last_name = "Godfrey";
  d.other_names = ["Susan Trent"];
  d.date_of_birth = "1980-04-01";
  d.email = "susan@example.test";
  d.phone = "555-0111";
  d.ssn = "123-45-6789";
  d.addresses = [
    { ...emptyAddress(), line1: "14 Kestrel Road", line2: "Apt 3", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" },
    { ...emptyAddress(), line1: "2 Foundry Lane", city: "Gary", state: "IN", postal_code: "46402", from: "2017-06", to: "2019-12" },
  ];
  d.cdl_number = "PA334554";
  d.cdl_state = "PA";
  d.cdl_class = "A";
  d.cdl_expires_at = "2029-01-01";
  d.additional_licences = [{ ...emptyLicence(), issuing_authority: "Illinois SOS", number: "HZ99", expires_at: "2027-05-04", kind: "Hazmat endorsement" }];
  d.experience = "Eight years, dry van and reefer.";
  d.equipment_experience = [{ ...emptyEquipment(), equipment_class: "tractor_semi_trailer", equipment_type: "Reefer", from: "2021-03", to: "2024-08", approx_miles: "480000" }];
  d.accidents = [{ ...emptyAccident(), occurred_on: "2024-02-11", nature: "Rear-ended at a light", fatalities: "0", injuries: "1", hazmat_spill: false }];
  d.violations = [{ ...emptyViolation(), occurred_on: "2023-09-02", offence: "Speeding 12 over", state: "OH", penalty: "Fine" }];
  d.licence_ever_denied = true;
  d.licence_denial_detail = "Suspended for points in 2015";
  d.prior_failed_pre_employment_test = true;
  d.employers = [
    { ...emptyEmployer(), employer_name: "Old Carrier", position_held: "Driver", address_line1: "12 Depot Rd", city: "Joliet", state: "IL", phone: "555-0100", started_on: "2023-01-01", ended_on: "2025-06-30", reason_for_leaving: "Better route" },
    { ...emptyEmployer(), employer_name: "Second Carrier", position_held: "Yard hostler", city: "Gary", state: "IN", phone: "555-0177", started_on: "2019-02-01", ended_on: "2022-11-30", reason_for_leaving: "Laid off" },
  ];
  d.questionnaire = {
    position: "Company driver",
    heard_from: "A friend at the terminal",
    legally_work: true,
    proof_of_age: true,
    may_contact_employers: false,
    military_service: false,
    other_training: "Defensive driving course",
    education: [{ school: "Joliet Central", years_completed: 4, field_of_study: "General", graduated: true, graduated_when: "1998" }],
    references: [{ full_name: "Ray Bellamy", years_known: 9, phone: "555-0134" }],
  };
  return d;
}

const CAPTURES: ApplicationCaptureView[] = [
  { slot: "cdl_front", contentType: "image/jpeg", bytes: 100, capturedAt: "2026-09-11T10:00:00Z" },
];

const summary = (d: ApplicationDraft, captures: ApplicationCaptureView[] = CAPTURES): ReviewSection[] =>
  buildReviewSummary({ draft: d, questionnaire: questionnaireForApplicant(), captures });

/** Everything the screen renders, as one string — labels and values alike. */
const asText = (sections: ReviewSection[]): string =>
  sections
    .flatMap((s) => [s.heading, ...s.groups.flatMap((g) => [g.title ?? "", ...g.entries.flatMap((e) => [e.label, e.value])])])
    .join(" | ");

/**
 * Every string a driver typed, pulled out of the draft rather than listed — so a new field is
 * covered the moment it exists, which is the only way this assertion keeps its value.
 */
function answersIn(node: unknown, key = ""): string[] {
  // Never shown, by decision: it is not in the certified payload and never enters a draft.
  if (key === "ssn") return [];
  // ⚠ The one value a driver did not type. `equipment_class` is a machine token behind a picker, and
  // what they chose — and must see back — is its label. Mapped rather than skipped, so the screen is
  // still held to showing it.
  if (key === "equipment_class" && typeof node === "string" && node !== "") {
    return [EQUIPMENT_CLASS_LABELS[node as EquipmentClass]];
  }
  if (typeof node === "string") return node.trim() === "" ? [] : [node.trim()];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap((v) => answersIn(v, key));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => answersIn(v, k));
  }
  return [];
}

describe("everything the driver typed is on the page they certify", () => {
  it("shows every answer in a fully filled-in draft", () => {
    const d = filled();
    const text = asText(summary(d));
    const answers = answersIn(d);

    // The guard against a vacuous pass.
    expect(answers.length).toBeGreaterThan(40);

    const missing = answers.filter((a) => {
      // Dates and months are re-formatted the way the pickers show them, and a state is shown by
      // name — so a raw value may legitimately not appear verbatim, and its rendering must.
      const forms = [a, showDate(a), showMonth(a)];
      return !forms.some((f) => f !== "" && text.includes(f));
    });
    expect(missing).toEqual([]);
  });

  it("never shows the Social Security number", () => {
    const d = filled();
    expect(asText(summary(d))).not.toContain("123-45-6789");
    expect(asText(summary(d))).not.toContain("6789");
  });

  it("shows the SECOND employer, not a count of employers", () => {
    // The exact regression: this screen rendered "2 employers" and nothing about either of them.
    const text = asText(summary(filled()));
    expect(text).toContain("Old Carrier");
    expect(text).toContain("Second Carrier");
    expect(text).toContain("Yard hostler");
    expect(text).not.toMatch(/\b2 employers\b/);
  });

  it("shows each carrier question beside the answer to it", () => {
    const text = asText(summary(filled()));
    expect(text).toContain("Position you are applying for");
    expect(text).toContain("Company driver");
    // A table answer is its rows, not a count of them.
    expect(text).toContain("Ray Bellamy");
    expect(text).toContain("Joliet Central");
  });

  it("shows the two-year drug and alcohol answer, which was on no summary at all", () => {
    const yes = asText(summary(filled()));
    expect(yes).toContain("Drug and alcohol tests");
    const d = filled();
    d.prior_failed_pre_employment_test = false;
    const no = summary(d).find((s) => s.section === "safety")!;
    const entry = no.groups.flatMap((g) => g.entries).find((e) => e.label === "Drug and alcohol tests");
    expect(entry?.value).toBe("No");
  });

  it("says which photographs were taken and which were not", () => {
    const text = asText(summary(filled(), CAPTURES));
    expect(text).toContain("Front of your licence");
    const back = summary(filled(), CAPTURES)
      .find((s) => s.section === "documents")!
      .groups.flatMap((g) => g.entries)
      .find((e) => e.label === "Back of your licence");
    expect(back?.value).toBe("None declared");
  });
});

describe("how the answers read", () => {
  it("writes dates and months the way the pickers wrote them", () => {
    expect(showDate("2026-04-01")).toBe("04/01/2026");
    expect(showMonth("2024-03")).toBe("03/2024");
    // Anything that is not one of those shapes travels unchanged rather than becoming "NaN/NaN".
    expect(showDate("")).toBe("");
    expect(showMonth("whenever")).toBe("whenever");
  });

  it("ends an open period with a word, not a blank", () => {
    const current = summary(filled())
      .find((s) => s.section === "addresses")!
      .groups[0]!.entries.find((e) => e.label === "Lived there");
    expect(current?.value).toBe("01/2020 — now");
  });

  it("names a state rather than showing two letters on their own", () => {
    const text = asText(summary(filled()));
    expect(text).toContain("Illinois (IL)");
    expect(text).toContain("Pennsylvania (PA)");
  });

  it("distinguishes a declared none from an unanswered question", () => {
    const d = emptyDraft();
    d.declares_no_accidents = true;
    const safety = summary(d, []).find((s) => s.section === "safety")!;
    const accidents = safety.groups.find((g) => g.title === "Accidents")!;
    expect(accidents.entries[0]!.value).toBe("None declared");

    const unanswered = summary(emptyDraft(), []).find((s) => s.section === "safety")!;
    expect(unanswered.groups.find((g) => g.title === "Accidents")!.entries[0]!.value).toBe("Not answered");
  });

  it("covers every screen that holds an answer, and only those", () => {
    // `review` and `certify` are absent on purpose: one IS this screen, and the other is the act
    // that follows it.
    expect(summary(filled()).map((s) => s.section)).toEqual([
      "identity", "addresses", "licence", "employment", "safety", "questions", "documents",
    ]);
  });
});
