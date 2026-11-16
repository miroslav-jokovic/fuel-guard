import { z } from "zod";
import { TOLL_PROVIDERS, normaliseTagNumber } from "./tollTags.js";
import { recordId } from "../recordId.js";

/**
 * The toll-tag contract shared by the API (`modules/tolls`) and web (the Vehicles column and the
 * truck's tag card) — TOLLS-PER-TRUCK-PLAN.md TL2. One definition; neither side restates it.
 *
 * Times are ISO instants. The browser turns the office's "date and time in our zone" into one before
 * sending, so the API never guesses a zone.
 */

export const tollProviderSchema = z.enum(TOLL_PROVIDERS);

export const retiredReasonSchema = z.enum(["lost", "returned", "damaged", "replaced"]);
export type TransponderRetiredReason = z.infer<typeof retiredReasonSchema>;

const tagNumberSchema = z
  .string()
  .transform((s, ctx) => {
    const n = normaliseTagNumber(s);
    if (n == null) {
      ctx.addIssue({ code: "custom", message: "A tag number is 4 to 24 letters and digits, as printed on the tag." });
      return z.NEVER;
    }
    return n;
  });

const instantSchema = z.iso.datetime({ offset: true });

/** POST /api/tolls/transponders — register a tag, optionally already on a truck. */
export const transponderCreateSchema = z.object({
  provider: tollProviderSchema,
  tagNumber: tagNumberSchema,
  issuer: z.string().trim().min(1).max(64).nullish(),
  note: z.string().trim().max(500).nullish(),
  vehicleId: recordId("Select a truck").nullish(),
  /** When it went on that truck. Defaults to now on the server when a truck is given without one. */
  at: instantSchema.nullish(),
});
export type TransponderCreate = z.infer<typeof transponderCreateSchema>;

/** POST /api/tolls/transponders/:id/move — onto a truck, or off (`vehicleId: null`). */
export const transponderMoveSchema = z.object({
  vehicleId: recordId("Select a truck").nullable(),
  at: instantSchema,
});
export type TransponderMove = z.infer<typeof transponderMoveSchema>;

/** POST /api/tolls/transponders/:id/retire */
export const transponderRetireSchema = z.object({
  reason: retiredReasonSchema,
  at: instantSchema,
});
export type TransponderRetire = z.infer<typeof transponderRetireSchema>;

/** POST /api/tolls/assignments/:id/void — a wrong entry, with why. */
export const assignmentVoidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type AssignmentVoid = z.infer<typeof assignmentVoidSchema>;

export interface TransponderAssignmentDto {
  id: string;
  vehicleId: string;
  unitNumber: string | null;
  validFrom: string;
  validTo: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface TransponderDto {
  id: string;
  provider: z.infer<typeof tollProviderSchema>;
  tagNumber: string;
  issuer: string | null;
  note: string | null;
  retiredAt: string | null;
  retiredReason: TransponderRetiredReason | null;
  /** The open assignment's truck, null when the tag is in the drawer or retired. */
  currentVehicleId: string | null;
  /** Newest first, voided rows included so a correction stays visible. */
  history: TransponderAssignmentDto[];
}

export interface TransponderListDto {
  transponders: TransponderDto[];
}
