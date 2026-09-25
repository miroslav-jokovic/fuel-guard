import { z } from "zod";

/**
 * The carrier's DRIVER HANDBOOK, signed on screen — HANDBOOK-SIGNING-PLAN.md (D-HB1..D-HB5).
 *
 * ── WHAT LIVES HERE AND WHAT DOES NOT ─────────────────────────────────────────────────────────
 * The PLACES the handbook is signed, and the shapes the office and the link exchange about them.
 * Those are read by the API (to refuse a mark at a place that is not the driver's), the office screen
 * (to say how many are left) and the applicant's page (to walk them). The handbook's TEXT is not here:
 * only the API draws it, so it lives beside its renderer (`applicationPdf/handbook/`), and the page
 * reads the handbook as the PDF the API renders, as AF6's permissions are read.
 *
 * ── THE PLACES ────────────────────────────────────────────────────────────────────────────────
 * The carrier's .docx has five signature blocks for the driver and one for the carrier. `h1`..`h5`
 * are the driver's, in the document's order. `h4c` is block 4's `Silvicom Inc` line: the Agreed
 * countersignature, applied by the office from a Representative (D-HB3). `what` is the sentence the
 * signer affirms there, stored on the mark: the carrier's own words where the block has them (h3, h4,
 * h5), and otherwise a plain statement of what that page is.
 */
export const HANDBOOK_PLACEMENTS = [
  {
    id: "h1",
    party: "driver",
    what: "The memo to all drivers and owner operators: truck upkeep, the fuel rules, receipts and paperwork",
  },
  {
    id: "h2",
    party: "driver",
    what: "The driver policy and rules, the hours-of-service policy and the safety fines",
  },
  { id: "h3", party: "driver", what: "By signing this, I agree to safety penalty policy." },
  {
    id: "h4",
    party: "driver",
    what: "I, Driver, have read the following rules and policies of Silvicom Inc and understand them.",
  },
  {
    id: "h4c",
    party: "carrier",
    what: "Agreed, for Silvicom Inc",
  },
  {
    id: "h5",
    party: "driver",
    what: "I certify that I have passed a safety training at Silvicom Inc and I have read and understood their safety standards and policies.",
  },
] as const;

export type HandbookPlacement = (typeof HANDBOOK_PLACEMENTS)[number];
export type HandbookPlacementId = HandbookPlacement["id"];

export const handbookPlacementById = (id: string): HandbookPlacement | undefined =>
  HANDBOOK_PLACEMENTS.find((p) => p.id === id);

/** The driver's places, in the handbook's order — the walk on the applicant's page. */
export const HANDBOOK_DRIVER_PLACEMENT_IDS: readonly HandbookPlacementId[] = HANDBOOK_PLACEMENTS
  .filter((p) => p.party === "driver")
  .map((p) => p.id);

/** The carrier's one place: block 4's `Silvicom Inc`. */
export const HANDBOOK_CARRIER_PLACEMENT_ID: HandbookPlacementId = "h4c";

/**
 * The SSN as the receipt page prints it (D-HB2, owner 2026-09-25: *"Printing should be •••1234"*).
 *
 * ⚠ The last four and nothing else. D-HIRE6 seals the full number and never prints it; the receipt's
 * `SSN` blank is filled from `driver_applications.ssn_last4`. Anything that is not exactly four
 * digits prints nothing rather than a guess.
 */
export function maskedSsn(last4: string | null | undefined): string {
  return typeof last4 === "string" && /^\d{4}$/.test(last4) ? `•••${last4}` : "";
}

/** `POST /api/public/application/:token/handbook/mark` — one of the driver's places. */
export const handbookMarkSchema = z.object({
  placement_id: z.enum(HANDBOOK_DRIVER_PLACEMENT_IDS as [HandbookPlacementId, ...HandbookPlacementId[]]),
  /** ESIGN intent, affirmed at the place — the packet's rule. */
  esign_consent: z.literal(true),
});
export type HandbookMark = z.infer<typeof handbookMarkSchema>;

/** `POST /api/recruitment/applicants/:driverId/handbook/countersign` — the office signs for the carrier. */
export const handbookCountersignSchema = z.object({
  representative_id: z.uuid(),
});
export type HandbookCountersign = z.infer<typeof handbookCountersignSchema>;

/** `POST /api/recruitment/representatives` — the office adds somebody who may sign for the carrier. */
export const carrierRepresentativeCreateSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(80),
  /** A PNG of their signature, as a data URL — the road-test examiner's bound. */
  signature_png: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "The signature must be a PNG image")
    .max(700_000, "That signature image is too large — keep it under 500 KB"),
});
export type CarrierRepresentativeCreate = z.infer<typeof carrierRepresentativeCreateSchema>;

/** A Representative as the office's screen sees them — never the storage path. */
export interface CarrierRepresentative {
  id: string;
  full_name: string;
  title: string;
  created_at: string;
}

/**
 * Where one applicant's handbook stands, for the office's drawer and the applicant's page.
 *
 * ⚠ Derived from the invitation's two stamps and the marks — never stored as a status (D-HM1).
 */
export interface HandbookStatus {
  /** The application is filed, so the handbook can be opened (D-HB1: it comes after the packet). */
  canOpen: boolean;
  openedAt: string | null;
  /** The driver's places already signed, in the handbook's order. */
  driverSigned: HandbookPlacementId[];
  /** True once every driver place is signed, which is when the office can countersign. */
  driverComplete: boolean;
  filedAt: string | null;
}

/**
 * Where a status stands, from the marks and the stamps — the one fold both screens read.
 *
 * ⚠ `driverComplete` counts the PLACES, not rows: `handbook_marks` is unique per (invitation, place),
 * and a place not in `HANDBOOK_DRIVER_PLACEMENT_IDS` (an old id, a carrier mark) never counts.
 */
export function handbookStatus(input: {
  submittedAt: string | null;
  openedAt: string | null;
  filedAt: string | null;
  signedPlacementIds: readonly string[];
}): HandbookStatus {
  const signed = new Set(input.signedPlacementIds);
  const driverSigned = HANDBOOK_DRIVER_PLACEMENT_IDS.filter((id) => signed.has(id));
  return {
    canOpen: input.submittedAt !== null,
    openedAt: input.openedAt,
    driverSigned,
    driverComplete: driverSigned.length === HANDBOOK_DRIVER_PLACEMENT_IDS.length,
    filedAt: input.filedAt,
  };
}
