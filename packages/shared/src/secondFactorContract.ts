import { z } from "zod";
import { isAdmin } from "./auth.js";
import type { UserRole } from "./constants.js";

/**
 * Two-step sign-in for the office app (INSTALLED-APP-PLAN IA-S1; the owner's rulings of 2026-11-15:
 * Q-IA1 (b), Q-IA12 (b), Q-IA13 as proposed).
 *
 * THE RULE, once, for the API that enforces it and the app that explains it. A second step — a code from an
 * authenticator app — is required of a person when:
 *   · they HAVE a verified second factor. Whoever turned it on means it: if a password alone still opened a
 *     working session, the factor would protect nothing against the one thing it is for, a stolen password; or
 *   · they are an ADMIN of a company whose date has passed (`organizations.second_factor_required_from`, 0617:
 *     14 days after the feature reached that company).
 * "Admin" is `isAdmin` and nothing else — not a list of roles. Every other role's reach is edited per company
 * and per person (Q-IA13's measurements), so a role name says nothing about reach; admin is the one role the
 * matrix cannot edit and the only one that can change anybody's access.
 */
export interface SecondFactorFacts {
  role: UserRole | null;
  hasFactor: boolean;
  /** The company's date, ISO; null when it could not be read — which requires nothing by itself. */
  requiredFrom: string | null;
}

/** Is this person an admin whose company's date has passed? */
export function secondFactorDue(facts: Pick<SecondFactorFacts, "role" | "requiredFrom">, now: Date): boolean {
  if (!isAdmin(facts.role) || !facts.requiredFrom) return false;
  const from = Date.parse(facts.requiredFrom);
  return Number.isFinite(from) && from <= now.getTime();
}

export function secondFactorRequired(facts: SecondFactorFacts, now: Date): boolean {
  return facts.hasFactor || secondFactorDue(facts, now);
}

/** The `aal` claim Supabase puts on a token: `aal2` once a second factor was verified in that session. */
export const SECOND_STEP_DONE = "aal2";

/** The API's refusal of a token that needs the second step and has not taken it. */
export const SECOND_FACTOR_REQUIRED = "second_factor_required";

/**
 * `GET /api/me/second-factor` — the one route a one-step token may call, so the app can say what is needed.
 *   required   the second step is required of this person now
 *   satisfied  this session has taken it
 *   has_factor they have an authenticator set up
 *   due_from   for an ADMIN without one, before the date: when it becomes required (the 14-day notice);
 *              null for everybody else
 *   must_keep  an admin past the date: the app does not offer to turn it off, because the next request
 *              would only demand it be set up again
 */
export const secondFactorStatusSchema = z.object({
  required: z.boolean(),
  satisfied: z.boolean(),
  has_factor: z.boolean(),
  due_from: z.string().nullable(),
  must_keep: z.boolean(),
});
export type SecondFactorStatus = z.infer<typeof secondFactorStatusSchema>;

export function secondFactorStatus(facts: SecondFactorFacts, aal: string | null | undefined, now: Date): SecondFactorStatus {
  const required = secondFactorRequired(facts, now);
  return {
    required,
    satisfied: aal === SECOND_STEP_DONE,
    has_factor: facts.hasFactor,
    due_from: !required && isAdmin(facts.role) && !facts.hasFactor ? facts.requiredFrom : null,
    must_keep: secondFactorDue(facts, now),
  };
}
