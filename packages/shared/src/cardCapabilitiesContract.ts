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
    ])
    .nullable(),
});
export type CardCapabilities = z.infer<typeof cardCapabilitiesSchema>;
