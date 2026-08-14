import type { z } from "zod";
import { CARD_OVERRIDE_STEP_UP_ABOVE_USES } from "../../cardWriteLimits.js";
import { EFS_OVERRIDE_MAX_USES, EFS_OVERRIDE_MIN_USES } from "../../efsCardCatalog.js";
import { grantOverrideSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * Let a card fuel outside its normal limits, a bounded number of times (plan Step 3.6).
 *
 * The only capability here that hands out fuel, which is why its budget is tighter than a status
 * change in both dimensions and why its bucket fails CLOSED when the counter cannot be reached: an
 * unmetered override is unmetered free fuel.
 */
export const overrideGrantContract = defineContract({
  key: "override_grant",
  intent: "override_grant",
  scope: "override",
  route: { method: "POST", path: "/:id/override" },
  writeBucket: "card_override",
  auditAction: "card.override_granted",
  schema: grantOverrideSchema,
  /**
   * Required, per the 2026-08-13 decision. This is the discretionary end of the range: nobody is
   * stranded at a pump at 2am because a dispatcher had to type why they were granting free fuel, and
   * "Why" is the first column an auditor reads on this intent.
   */
  reason: "required",
  carriesSecret: false,
  /**
   * `overrideAllLocations` is the field the p194 recipe turns on, and the one whose spelling the
   * config scanner most needs to confirm — `boolOrNull` collapses `false` and `0` in the typed view,
   * so only the raw wire text can say which this account actually sends.
   */
  vocabularyFields: ["overrideAllLocations"],
  emittableValues: { overrideAllLocations: ["true", "false"] },
  ui: {
    title: "Grant a fuel exception",
    verb: "Grant exception",
    tone: "warning",
    inputs: [
      { name: "uses", control: "stepper", label: "How many purchases", min: EFS_OVERRIDE_MIN_USES, max: EFS_OVERRIDE_MAX_USES },
      { name: "scope", control: "radio", label: "Where", options: ["all", "location"] },
    ],
    /**
     * Three rows, because three fields move together and reading `override` as a boolean is the bug
     * audit W1 caught: `<override>` carries the USE COUNT, `<locationOverride>` the location id, and
     * `<overrideAllLocations>` says which of the two scopes is armed.
     */
    diffRows: ["override", "locationOverride", "overrideAllLocations"],
  },
});

export type OverrideGrantBody = z.infer<typeof grantOverrideSchema>;

/** Vendor-capped at 9; we demand a fresh sign-in above three. Exported so the gate and its test agree. */
export const overrideStepUpMessage = `Confirm your password to grant more than ${CARD_OVERRIDE_STEP_UP_ABOVE_USES} uses.`;
