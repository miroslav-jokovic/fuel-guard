import { z } from "zod";
import { recordId } from "./recordId.js";
import { countSessionKindSchema, countSessionStatusSchema } from "./inventoryContract.js";

/**
 * The count session's contract, split out of `inventoryContract.ts` on 2026-11-16 when F13's two
 * fields took that file past the 500-line budget. Nothing in it changed; the vocabularies it reads
 * (`COUNT_SESSION_KINDS`, `COUNT_SESSION_STATUSES`) stay with the rest of the inventory vocabulary.
 */
const optionalText = (max: number) => z.string().trim().max(max).nullable();

// ── count sessions ───────────────────────────────────────────────────────────────────────────────

/**
 * A walk of one place (D-INV19). One session shape serves a shelf count (I5) and a unit kit check
 * (I9), because they are the same activity against different holders — and because two session
 * tables would mean two review screens that drift.
 *
 * Exactly one of the three holder columns is set, which the migration enforces with a CHECK and
 * this schema enforces with a refinement. The header of that migration cites 0092:137 and 0153:1-7:
 * a session is about one place, not a parallel registry of everything being counted anywhere.
 */
export const countSessionDtoSchema = z.object({
  id: recordId(),
  kind: countSessionKindSchema,
  locationId: recordId().nullable(),
  vehicleId: recordId().nullable(),
  trailerId: recordId().nullable(),
  holderLabel: z.string().nullable(),
  startedBy: recordId().nullable(),
  startedByName: z.string().nullable(),
  blind: z.boolean(),
  status: countSessionStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  note: optionalText(2000),
});
export type CountSessionDto = z.infer<typeof countSessionDtoSchema>;

export const countSessionInputSchema = z
  .object({
    kind: countSessionKindSchema,
    locationId: recordId().nullable().optional(),
    vehicleId: recordId().nullable().optional(),
    trailerId: recordId().nullable().optional(),
    blind: z.boolean(),
    note: optionalText(2000).optional(),
  })
  .refine(
    (v) => [v.locationId, v.vehicleId, v.trailerId].filter(Boolean).length === 1,
    { message: "A count is about exactly one place — a location, a truck, or a trailer.", path: ["kind"] },
  )
  .refine((v) => (v.kind === "location" ? Boolean(v.locationId) : !v.locationId), {
    message: "A location count needs a location, and a unit count does not take one.",
    path: ["kind"],
  });
export type CountSessionInput = z.infer<typeof countSessionInputSchema>;
