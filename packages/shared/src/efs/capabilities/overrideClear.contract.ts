import type { z } from "zod";
import { clearOverrideSchema } from "../../cardControlContract.js";
import { defineContract } from "../types.js";

/**
 * Cancelling a fuel exception — ONE intent with TWO mechanisms, and therefore two contracts.
 *
 * ── Why two, rather than one capability that branches ────────────────────────────────────────────
 * `EFS_CARD_DELETE_OVERRIDE_ENABLED` chooses between the vendor's dedicated `deleteOverride` op and
 * the proven three-edit echo, per request. A behaviour's `mutation` is static data and cannot be
 * both, and a capability that branched internally would be a second place where "which write are we
 * about to make" is decided — the answer already lives in exactly one place, and this keeps it there.
 *
 * `docs/27` §7.2 anticipates this: intents map many-to-one, and `override_clear` is named as the
 * example. Both contracts declare `intent: "override_clear"`, so the ledger's coarse audit key still
 * answers "who cleared this card's override" across both, while `capability_key` records which
 * mechanism actually ran.
 *
 * Exactly one is mounted at a time — see `mountedCapabilities(env)` — because two routers declaring
 * `DELETE /:id/override` is a coin toss decided by registration order. **Step 4.2 replaces the env
 * read with a promotion lookup**, which is the whole reason the choice was made a property of the
 * registry rather than an `if` inside a handler.
 */

const shared = {
  intent: "override_clear",
  scope: "override",
  route: { method: "DELETE", path: "/:id/override" },
  /**
   * Same bucket as the grant. Clearing is cheap and safe, but a grant/clear/grant loop would
   * otherwise get twice the budget by alternating.
   */
  writeBucket: "card_override",
  auditAction: "card.override_cleared",
  /**
   * Optional — and the 2026-08-13 `reason` decision does not name this capability either way, so
   * this is the call: clearing is the SAFE direction, it takes fuel away rather than handing it out,
   * and "cancel that exception now" should not stop for prose. The grant it reverses is `required`,
   * which is where the audit trail actually needs the sentence.
   */
  reason: "optional",
  carriesSecret: false,
} as const;

/** The echo mechanism: three fields set back to their cleared values, as a full-document write. */
export const overrideClearContract = defineContract({
  ...shared,
  key: "override_clear",
  schema: clearOverrideSchema,
  vocabularyFields: ["overrideAllLocations"],
  emittableValues: { overrideAllLocations: ["true", "false"] },
  ui: {
    title: "Remove the exception",
    verb: "Remove exception",
    tone: "warning",
    inputs: [],
    diffRows: ["override", "locationOverride", "overrideAllLocations"],
  },
});

/**
 * The dedicated vendor op (guide p27), which earns its place by SHRINKING blast radius: the echo
 * clear is a full-document write where a serializer bug can delete a fleet's driver assignments,
 * while this op names one card and can only touch its override.
 *
 * `vocabularyFields` is empty on purpose — this request carries `clientId` and `cardNumber` and no
 * vendor vocabulary at all, so there is nothing for the config scanner to compare and claiming
 * otherwise would produce a permanent `unobserved`.
 */
export const deleteOverrideContract = defineContract({
  ...shared,
  key: "delete_override",
  schema: clearOverrideSchema,
  vocabularyFields: [],
  emittableValues: {},
  ui: {
    title: "Remove the exception",
    verb: "Remove exception",
    tone: "warning",
    inputs: [],
    diffRows: ["override", "locationOverride", "overrideAllLocations"],
  },
});

export type OverrideClearBody = z.infer<typeof clearOverrideSchema>;
