import { z } from "zod";

/**
 * The §391.31 road test, as the carrier's form records it — D2 (`ROAD-TEST-PLAN.md`, D-HM7).
 *
 * ── WHERE THE WORDS COME FROM ─────────────────────────────────────────────────────────────────
 * The carrier's own form (`docs/Kowlage-Base/Road Test Examination.docx`, given 2026-09-25) lists six
 * items. §391.31(c) requires at least eight, and three of them were missing: the pretrip inspection,
 * coupling and uncoupling, and placing the vehicle in operation. The owner ruled Q-RT1 (a): add the
 * three and keep the six. So the three added items are in the REGULATION'S words, and the carrier's
 * six are verbatim — `breaking` included, for D-PKT11's reason: the carrier's paper is the text
 * authority, and a form that silently corrected it would no longer be their form.
 *
 * ⚠ The order is the regulation's for the three it adds (they come before the vehicle moves), then
 * the carrier's own order. `key` is what is stored; the text is only ever printed, so re-wording a
 * line never changes what a filed test recorded.
 */
export const ROAD_TEST_ITEMS = [
  { key: "pretrip_inspection", text: "The pretrip inspection required by § 392.7.", source: "added" },
  { key: "placing_in_operation", text: "Placing the vehicle in operation.", source: "added" },
  { key: "coupling_uncoupling", text: "Coupling and uncoupling of combination units.", source: "added" },
  { key: "street_traffic", text: "Operating the vehicle in street traffic and while passing other vehicles.", source: "carrier" },
  { key: "highway_traffic", text: "Operating the vehicle in HWY traffic and while passing other vehicles.", source: "carrier" },
  { key: "controls_emergency", text: "Use of vehicle’s controls and emergency equipment.", source: "carrier" },
  { key: "turning", text: "Turning the vehicle.", source: "carrier" },
  { key: "braking_slowing", text: "Braking and slowing the vehicle by means other than breaking.", source: "carrier" },
  { key: "backing_parking", text: "Backing and parking the vehicles.", source: "carrier" },
] as const;

export type RoadTestItemKey = (typeof ROAD_TEST_ITEMS)[number]["key"];
export const ROAD_TEST_ITEM_KEYS = ROAD_TEST_ITEMS.map((i) => i.key) as [RoadTestItemKey, ...RoadTestItemKey[]];

/** §391.31(d) asks for a RATING per item. These are the carrier's own words, from its Evaluation. */
export const ROAD_TEST_RATINGS = ["satisfactory", "needs_training", "unsatisfactory"] as const;
export type RoadTestRating = (typeof ROAD_TEST_RATINGS)[number];
export const ROAD_TEST_RATING_LABELS: Record<RoadTestRating, string> = {
  satisfactory: "Satisfactory",
  needs_training: "Needs Training",
  unsatisfactory: "Unsatisfactory",
};

/** Q-RT4 (owner, 2026-09-25): *"Dry Van and reefer are used for testings and what we have in fleet."* */
export const ROAD_TEST_TRAILER_TYPES = ["dry_van", "reefer"] as const;
export type RoadTestTrailerType = (typeof ROAD_TEST_TRAILER_TYPES)[number];
export const ROAD_TEST_TRAILER_LABELS: Record<RoadTestTrailerType, string> = {
  dry_van: "Dry van",
  reefer: "Reefer",
};

/**
 * What the office records. The driver's name and licence are NOT here: the server reads them off the
 * roster (D-APP9's rule — the server composes what the server knows), so a certificate cannot name a
 * licence the file does not hold.
 */
export const roadTestRecordSchema = z.object({
  examiner_id: z.uuid(),
  /** The power unit, from the roster. Its year and make print as "Type of Power Unit". */
  vehicle_id: z.uuid(),
  trailer_type: z.enum(ROAD_TEST_TRAILER_TYPES),
  /** The date the test was given — the date on the certificate. */
  tested_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  /** §391.31(f): "approximately ___ miles of driving". */
  miles: z.number().int().positive().max(1000),
  items: z.record(z.enum(ROAD_TEST_ITEM_KEYS), z.enum(ROAD_TEST_RATINGS)),
  general_performance: z.enum(ROAD_TEST_RATINGS),
  remarks: z.string().max(1000).nullish(),
  qualified_for: z.string().max(200).nullish(),
});
export type RoadTestRecord = z.infer<typeof roadTestRecordSchema>;

export interface RoadTestIssue {
  field: string;
  message: string;
}

/**
 * The rules a record must pass beyond its shape. Pure — `today` is passed in.
 *
 * ⚠ Every item must be rated. §391.31(d) asks the examiner to rate EACH one, and a record missing an
 * item would print a blank on the form that reads as "not tested" — the gap Q-RT1 was about.
 */
export function validateRoadTest(input: RoadTestRecord, today: string): RoadTestIssue[] {
  const issues: RoadTestIssue[] = [];
  for (const item of ROAD_TEST_ITEMS) {
    if (!input.items[item.key]) issues.push({ field: `items.${item.key}`, message: `Rate "${item.text}"` });
  }
  if (input.tested_on > today) issues.push({ field: "tested_on", message: "That date is in the future." });
  if (input.tested_on < "1990-01-01") issues.push({ field: "tested_on", message: "That date looks mistyped — check the year." });
  return issues;
}

/**
 * Did the driver pass — the ONE question the certificate and the checklist ask.
 *
 * ⚠ Derived, never typed (`ROAD-TEST-PLAN.md` §8, 2026-09-25): general performance AND every item
 * Satisfactory. §391.31(e) certifies a driver who "successfully completes" the test, so Needs
 * Training on a required item is not a pass. A failed or incomplete test still files its form
 * (§391.31(g) keeps the form), issues no certificate, and leaves the step open.
 */
export function roadTestPassed(input: Pick<RoadTestRecord, "items" | "general_performance">): boolean {
  return (
    input.general_performance === "satisfactory" &&
    ROAD_TEST_ITEMS.every((i) => input.items[i.key] === "satisfactory")
  );
}

/** `POST /api/recruitment/road-test-examiners` — the office adds an examiner and their signature. */
export const roadTestExaminerCreateSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(80),
  /** A PNG of the examiner's signature, as a data URL. Bounded: a signature is a small picture. */
  signature_png: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "The signature must be a PNG image")
    .max(700_000, "That signature image is too large — keep it under 500 KB"),
});
export type RoadTestExaminerCreate = z.infer<typeof roadTestExaminerCreateSchema>;

/** An examiner as the office's screen sees them — never the storage path. */
export interface RoadTestExaminer {
  id: string;
  full_name: string;
  title: string;
  created_at: string;
}

/** What recording a road test hands back. `certificateDocumentId` is null when it was not passed. */
export interface RoadTestResult {
  passed: boolean;
  formDocumentId: string;
  certificateDocumentId: string | null;
  recordId: string | null;
}
