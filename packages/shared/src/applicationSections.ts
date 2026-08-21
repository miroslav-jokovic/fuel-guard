import { driverApplicationObject, type DriverApplicationFields } from "./applicationContract.js";

/**
 * The application, cut into screens (A3, and one more since A8).
 *
 * ── WHY THIS VOCABULARY IS SHARED AND NOT A UI DETAIL ─────────────────────────────────────────
 * `application_drafts.furthest_section` stores one of these tokens, and A10's abandonment sweep will
 * read it to say what a stalled driver was looking at when they walked away. A section id is
 * therefore a value in the database and a word in an office-facing email, not a component name — so
 * it ships as the pair every state vocabulary in this product ships as: the machine tokens here, and
 * an exported label map beside them.
 *
 * ── WHY THE KEY SETS LIVE HERE TOO ────────────────────────────────────────────────────────────
 * Because they are checkable. `driverApplicationSchema` is the one definition of what §391.21(b)
 * requires; a wizard is a promise that every one of those fields appears on exactly one screen. That
 * promise is worth nothing as a convention and everything as a test — `sectionsCoverTheContract`
 * below is the assertion, and it fails the build the day somebody adds a field to the contract
 * without giving it a home. A field the form never renders is a field the driver never answers and
 * the server then refuses at submit, which is the worst possible place to discover it.
 *
 * ── THE ONE SCREEN WHOSE FIELDS ARE NOT THE REGULATION'S (A9) ─────────────────────────────────
 * `questions` owns `questionnaire_version` and `questionnaire_answers`, and no §391.21(b) paragraph.
 * That is D-APP12 made visible in the map: the carrier's own questions travel in the same payload and
 * are answered in the same flow, and a reader checking this file against the CFR can see at a glance
 * which screen is not the CFR's.
 *
 * ── THE ONE SCREEN THAT OWNS NO CONTRACT FIELD ────────────────────────────────────────────────
 * `documents` (A8's capture step) collects photographs, not answers: nothing it produces belongs in
 * `driverApplicationSchema`, because §391.21(b) is a form and a licence photograph is not one of its
 * paragraphs. It sits before `review` — the driver takes the photographs while they still have the
 * documents in their hand, and then checks the answers they are about to certify. Like `review` it
 * claims no keys, and `sectionsCoverTheContract` is unaffected by it in either direction.
 */

export const APPLICATION_SECTION_ORDER = [
  "identity",
  "addresses",
  "licence",
  "employment",
  "safety",
  "questions",
  "documents",
  "review",
  "certify",
] as const;

export type ApplicationSection = (typeof APPLICATION_SECTION_ORDER)[number];

export const APPLICATION_SECTION_LABELS: Record<ApplicationSection, string> = {
  identity: "About you",
  addresses: "Where you have lived",
  licence: "Your licence",
  employment: "Where you have worked",
  safety: "Your driving record",
  questions: "The carrier's own questions",
  documents: "Your documents",
  review: "Check your answers",
  certify: "Sign and send",
};

/** The §391.21(b) paragraph each screen discharges, for the driver and for anyone auditing us. */
export const APPLICATION_SECTION_CITATIONS: Record<ApplicationSection, string | null> = {
  identity: "§391.21(b)(2)",
  addresses: "§391.21(b)(3)",
  licence: "§391.21(b)(5)",
  employment: "§391.21(b)(6), (b)(10), (b)(11)",
  safety: "§391.21(b)(7), (b)(8), (b)(9)",
  // Null, and emphatically so: these are the CARRIER's questions, and printing a CFR citation beside
  // them would tell a driver the regulation asks something it does not (A9, D-APP12).
  questions: null,
  // Null, and honestly so: §391.21(b) enumerates twelve paragraphs and none of them is a photograph.
  // The screen exists because §391.51's file is assembled from documents the driver is holding right
  // now, not because the application form asks for them.
  documents: null,
  review: null,
  certify: "§391.21(b)(12)",
};

/**
 * Which contract fields each screen owns. Exactly one screen owns each field.
 *
 * `experience` ((b)(6), "the nature and extent of the applicant's experience in the operation of
 * motor vehicles, including the type of equipment") sits with employment rather than with the
 * licence: it is a question about work done, the driver answers it while thinking about the jobs
 * they just listed, and (b)(6) reads as the preamble to (b)(10) rather than as a licence detail.
 */
export const APPLICATION_SECTION_KEYS: Record<
  ApplicationSection,
  readonly (keyof DriverApplicationFields)[]
> = {
  // `other_names` sits with identity because that is where a person types their names, even though
  // §391.21(b)(2) does not ask for it and §391.23(a)(2) is what it serves (see the contract).
  identity: ["first_name", "middle_name", "last_name", "other_names", "date_of_birth", "email", "phone"],
  addresses: ["addresses"],
  licence: ["cdl_number", "cdl_state", "cdl_class", "cdl_expires_at", "additional_licences"],
  // Both halves of (b)(6) live here: the narrative and the equipment grid the same sentence requires.
  employment: ["experience", "equipment_experience", "employers", "declares_no_employment"],
  safety: [
    "accidents",
    "declares_no_accidents",
    "violations",
    "declares_no_violations",
    "licence_ever_denied",
    "licence_denial_detail",
  ],
  // The two fields A9 added — the only place in this map where a screen owns keys that discharge no
  // §391.21(b) paragraph at all, which is exactly what D-APP12 separated them out to be.
  questions: ["questionnaire_version", "questionnaire_answers"],
  // Nothing of its own: photographs are staged in `application_captures`, not in the certified
  // payload, so this screen owns no §391.21(b) field (A8, D-APP10).
  documents: [],
  // Nothing of its own: it renders what the other screens collected, which is the point of it.
  review: [],
  certify: ["certified", "signed_name"],
};

/**
 * Does every contract field have exactly one home?
 *
 * Returns what is wrong rather than a boolean, so the test that fails prints the field name and the
 * next person fixes it in one step instead of bisecting the map.
 */
export function sectionsCoverTheContract(): { homeless: string[]; duplicated: string[] } {
  const contractKeys = Object.keys(driverApplicationObject.shape);
  const seen = new Map<string, number>();
  for (const section of APPLICATION_SECTION_ORDER) {
    for (const key of APPLICATION_SECTION_KEYS[section]) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return {
    homeless: contractKeys.filter((k) => !seen.has(k)),
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  };
}

/** The section a key belongs to — how an error on the review screen finds the screen that owns it. */
export function sectionOwning(key: keyof DriverApplicationFields): ApplicationSection | null {
  return (
    APPLICATION_SECTION_ORDER.find((s) => APPLICATION_SECTION_KEYS[s].includes(key)) ?? null
  );
}

/** Is this a section token we know? `furthest_section` is free text in the database on purpose. */
export const isApplicationSection = (v: unknown): v is ApplicationSection =>
  typeof v === "string" && (APPLICATION_SECTION_ORDER as readonly string[]).includes(v);
