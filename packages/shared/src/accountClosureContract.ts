import { z } from "zod";

/**
 * Account closure — the contract shared by the driver app, the API and the fleet's queue in web
 * (DIRECTION-B-PLAN §6 P4, D-PR8; table in migration 0330).
 *
 * ── WHY THE WORD IS "CLOSURE" AND NOT "DELETION", EVERYWHERE ───────────────────────────────────
 * A driver's login is issued by their carrier, and 49 CFR §391.51 obliges that carrier to keep the
 * qualification file for three years after the driver leaves. So the thing the app can offer is not
 * deletion — it is closing the login at once and asking the fleet to delete what may lawfully be
 * deleted. Naming it `delete` anywhere would put a promise in the type system that the law does not
 * let us keep, and the driver would read it on the button.
 *
 * The vocabulary is fixed here rather than in three places for the usual reason, and one specific
 * one: `status` is rendered as a badge in web, decides a filter in the API, and is checked by a
 * CHECK constraint in 0330. Three copies of a three-value list is how the fourth value arrives in
 * only two of them.
 */

/** Where a request has got to. Mirrors 0330's CHECK constraint exactly. */
export const closureRequestStatusSchema = z.enum(["open", "completed", "declined"]);
export type ClosureRequestStatus = z.infer<typeof closureRequestStatusSchema>;

/**
 * One request as the fleet's queue sees it. The driver never reads a request back — their login
 * stops working the moment they confirm, so there is no signed-in surface left to show it on.
 */
export const closureRequestSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  /** Denormalised for the queue: a list of ids is not a queue anybody can action. */
  driver_name: z.string().nullable(),
  requested_at: z.string(),
  status: closureRequestStatusSchema,
  resolved_at: z.string().nullable(),
  /** The member who resolved it, already resolved to a display name by the API (D-PERM). */
  resolved_by_name: z.string().nullable(),
  note: z.string().nullable(),
});
export type ClosureRequest = z.infer<typeof closureRequestSchema>;

export const closureRequestListResponseSchema = z.object({
  requests: z.array(closureRequestSchema),
});
export type ClosureRequestListResponse = z.infer<typeof closureRequestListResponseSchema>;

/**
 * Resolving one. `note` is optional on `complete` and expected on `decline` — expected rather than
 * required, because a fleet that must type a reason to refuse will type "n/a", and a blank note is
 * more honest than a coerced one. The web form asks for it; the contract does not pretend it was
 * compulsory.
 */
export const resolveClosureRequestSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type ResolveClosureRequest = z.infer<typeof resolveClosureRequestSchema>;

/**
 * The driver's own request carries NO body. Deliberate: there is nothing for a driver to fill in,
 * and every field one might add — a reason, a forwarding address — would be personal data collected
 * at the exact moment somebody asked us to hold less of it.
 *
 * ⚠ It is nonetheless a POST with an idempotent server, because it rides the offline outbox and is
 * therefore retried. 0330's partial unique index turns the retry into a conflict the endpoint reads
 * as "already asked" and answers `{ ok: true, already: true }` to.
 */
export const closureRequestResponseSchema = z.object({
  ok: z.literal(true),
  /** True when this call found an open request already standing — a retry, not a second ask. */
  already: z.boolean(),
});
export type ClosureRequestResponse = z.infer<typeof closureRequestResponseSchema>;
