/**
 * McLeod drivers the roster sweep could not settle, and why (ROSTER-LIFECYCLE-PLAN RL3).
 *
 * The sweep already decides each of these on purpose. It holds an applicant out of matching, refuses to
 * merge onto a fuel-card row by name, refuses to guess between two rows, and leaves an unproven rehire
 * for a person (rosterMatch, D-MR16, D-MR7a). Until RL3 the decision reached only the VM's log and the
 * API's response, which nobody reads. On 2026-10-30 that left Curtis Hairston, hired in McLeod on 10/28,
 * out of the driver list with nothing on any screen saying why. A refusal nobody can see is
 * indistinguishable from a broken sync.
 */

export const ROSTER_HELD_REASONS = [
  /** A Hiring applicant answers to this McLeod driver. The hire is finished in Hiring, then linked. */
  "applicant",
  /** A fuel-card row answers by name only. Linked when a licence arrives (Samsara) or by hand. */
  "fuel_card",
  /** Two or more rows answer to the same key. Never guessed between: a person merges them. */
  "ambiguous",
  /** A former driver's row answers, but McLeod's dates do not prove the rehire (D-MR7a). */
  "rehire_review",
  /** Nothing answers and the sweep did not create a row (link or identity mode, or no name). */
  "not_created",
] as const;
export type RosterHeldReason = (typeof ROSTER_HELD_REASONS)[number];

export interface RosterHeldDriver {
  /** McLeod's driver code, e.g. CHAIRSTO. */
  externalId: string;
  /** As McLeod spells it, composed from its parts. Null when McLeod holds no name. */
  name: string | null;
  hireDate: string | null;
  reason: RosterHeldReason;
  /** When the sweep first held this driver for this reason, so a list can say how long it has waited. */
  since: string;
}

/** `GET /api/integrations/mcleod/roster-held`. `at` is the last sweep that changed the list; null = never. */
export interface RosterHeld {
  at: string | null;
  drivers: RosterHeldDriver[];
}
