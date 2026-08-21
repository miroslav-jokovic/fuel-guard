import { driverApplicationObject, type DriverApplicationFields } from "./applicationContract.js";

/**
 * The application, cut into screens (A3).
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
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────────────────────────
 * `documents` (A7's capture step) has no entry yet. A section that renders nothing is a dead screen
 * in the middle of somebody's application; A7 inserts it before `review` when there is something to
 * put on it. The order below is otherwise the plan's.
 */

export const APPLICATION_SECTION_ORDER = [
  "identity",
  "addresses",
  "licence",
  "employment",
  "safety",
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
  identity: ["first_name", "middle_name", "last_name", "date_of_birth", "email", "phone"],
  addresses: ["addresses"],
  licence: ["cdl_number", "cdl_state", "cdl_class", "cdl_expires_at", "additional_licences"],
  employment: ["experience", "employers", "declares_no_employment"],
  safety: [
    "accidents",
    "declares_no_accidents",
    "violations",
    "declares_no_violations",
    "licence_ever_denied",
    "licence_denial_detail",
  ],
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
