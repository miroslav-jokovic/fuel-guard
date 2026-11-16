import { z } from "zod";
import { applicationRowKeySchema } from "./applicationRowKey.js";

/**
 * §391.21(b)(6)'s equipment, as the regulation and the government's own form both structure it.
 *
 * ── WHY THIS IS A REGULATED FIELD AND NOT A CARRIER QUESTION ──────────────────────────────────
 * (b)(6) reads, verbatim: "The nature and extent of the applicant's experience in the operation of
 * motor vehicles, INCLUDING THE TYPE OF EQUIPMENT (such as buses, trucks, truck tractors,
 * semitrailers, full trailers, and pole trailers) WHICH HE/SHE HAS OPERATED". The paragraph asks for
 * two things in one sentence — a narrative extent, and an enumeration of equipment — and `experience`
 * alone answers only the first half.
 *
 * FMCSA's own sample driver employment application (csa.fmcsa.dot.gov, read 2026-08-21) lays the
 * second half out as exactly this grid: class of equipment × type × date from × date to × approximate
 * total miles. A9 first shipped it as carrier material because the owner's packet is where it was
 * found; the packet turns out to be a near-verbatim copy of the government's form, and the grid is
 * the regulation's, not the carrier's. A (b)(6) answer sitting in `questionnaire_answers` — which
 * D-APP12 projects nowhere — is not what §391.51 wants to find in a qualification file.
 *
 * ⚠ The class list is FMCSA's form's, plus `bus`, which (b)(6)'s own parenthetical names first and
 * that form omits. `other` carries its own free-text type, which is what the "(VAN, TANK, FLAT, ETC.)"
 * column is for.
 */
export const EQUIPMENT_CLASSES = [
  "straight_truck",
  "tractor_semi_trailer",
  "tractor_two_trailers",
  "tractor_tanker",
  "bus",
  "other",
] as const;
export type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

export const EQUIPMENT_CLASS_LABELS: Record<EquipmentClass, string> = {
  straight_truck: "Straight truck",
  tractor_semi_trailer: "Tractor and semi-trailer",
  tractor_two_trailers: "Tractor and two trailers",
  tractor_tanker: "Tractor and tanker",
  bus: "Bus",
  other: "Other",
};

export const applicationEquipmentSchema = z.object({
  equipment_class: z.enum(EQUIPMENT_CLASSES),
  /** The "(VAN, TANK, FLAT, ETC.)" column on FMCSA's form — free text, because that list is open. */
  equipment_type: z.string().max(120).nullish(),
  // Months, not days. A driver recalls the year and the season they drove a tanker; asking for the
  // day invites an invented one, and (b)(6) asks for extent rather than for dates to the day — which
  // is the same reason the address history (b)(3) is months.
  from: z.string().regex(/^\d{4}-\d{2}$/, "Expected a month as YYYY-MM"),
  to: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().regex(/^\d{4}-\d{2}$/, "Expected a month as YYYY-MM").nullish(),
  ),
  /** "APPROX # OF MILES (TOTAL)". Approximate by the form's own word, so it is never required. */
  approx_miles: z.coerce.number().int().min(0).max(100_000_000).nullish(),
  key: applicationRowKeySchema,
}).strict();
export type ApplicationEquipment = z.infer<typeof applicationEquipmentSchema>;
