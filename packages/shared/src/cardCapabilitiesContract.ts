import { z } from "zod";

/**
 * What the client may do, decided by the SERVER. The client never infers this from a role: the answer
 * depends on the org's write entitlement, the deploy kill switch and the approver list, none of which
 * the browser can see.
 */
export const cardCapabilitiesSchema = z.object({
  canLock: z.boolean(),
  canUnlock: z.boolean(),
  canOverride: z.boolean(),
  canSetPrompts: z.boolean(),
  writeEntitlement: z.enum(["unknown", "confirmed", "denied"]),
  blockedBy: z
    .enum([
      "kill_switch",
      "not_enabled",
      "not_entitled",
      "role",
      "not_approver",
      "no_credentials",
      "endpoint_changed",
      /**
       * Step 4.2. The org may write, and this particular capability has not been promoted here.
       *
       * Distinct from `not_entitled` on purpose: that one means EFS has not confirmed the ACCOUNT
       * may write at all, and sends an admin to run the write check. This one means our own
       * promotion record says nobody has approved this capability for this org yet, and sends them
       * to a proof run. Same 403, two different next actions — which is why every reason in this
       * enum has its own sentence.
       */
      "not_promoted",
      /** Promoted once and switched off since. Reversible by a person, and never by a backfill. */
      "capability_suspended",
    ])
    .nullable(),
});
export type CardCapabilities = z.infer<typeof cardCapabilitiesSchema>;
