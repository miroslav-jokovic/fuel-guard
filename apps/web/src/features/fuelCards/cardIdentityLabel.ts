/**
 * How a card is named to a human, in ONE place (Step 7.7).
 *
 * ── Why this is not "just print the last four" ──────────────────────────────────────────────────
 * On the production fleet **40 last-4 groups hold more than one live card**, covering 144 of 197.
 * `••••7552` is five different cards on five different trucks. So the string this product has always
 * used to identify a card to a person identifies, on most of the fleet, a GROUP of cards.
 *
 * The linker was fixed to stop treating a last-4 as an identity. This is the same correction on the
 * reading side, and it is the half a person actually experiences: a picker offering five rows that
 * all say `••••7552` is unusable however correct the database underneath it is.
 *
 * ── The rule ────────────────────────────────────────────────────────────────────────────────────
 * Unit first, then driver. The unit is what the fleet manager is thinking about — cards are talked
 * about as "the card on 716" — and it is the discriminator the linker itself trusts. The driver name
 * is added when known because two cards can sit on one unit over time. Both are shown when both
 * exist rather than one-or-the-other: `??` picks the first non-null and hides the second, which on a
 * fleet with duplicate last-4s can hide the very field that tells two rows apart.
 *
 * When neither is known the label says so out loud. "••••7552" alone reads like an identity; the
 * point of `unidentified` is that on this fleet it is not one.
 */

export interface CardIdentityFields {
  maskedRef: string;
  unitPrompt?: string | null;
  driverName?: string | null;
}

export interface CardIdentityLabel {
  /** The masked card, always — it is what is printed on the plastic. */
  primary: string;
  /** Unit and driver, in that order, joined for display. Empty when neither is known. */
  qualifier: string;
  /** True when nothing distinguishes this card from another sharing its last four. */
  unidentified: boolean;
}

export function cardIdentityLabel(card: CardIdentityFields): CardIdentityLabel {
  const unit = (card.unitPrompt ?? "").trim();
  const driver = (card.driverName ?? "").trim();
  const parts = [unit ? `Unit ${unit}` : "", driver].filter(Boolean);
  return {
    primary: card.maskedRef,
    qualifier: parts.join(" · "),
    unidentified: parts.length === 0,
  };
}

/** One line, for places that cannot lay out two. */
export function cardIdentityText(card: CardIdentityFields): string {
  const { primary, qualifier, unidentified } = cardIdentityLabel(card);
  if (unidentified) return `${primary} — no unit or driver`;
  return `${primary} — ${qualifier}`;
}

/**
 * Why a card has no `fuel_cards` counterpart, in the words an operator can act on.
 *
 * Each status maps to a DIFFERENT next action, which is the whole reason the linker distinguishes
 * them rather than reporting one "unlinked" state:
 *
 *   ambiguous      → the fleet has to tell the cards apart; a unit prompt does it
 *   unconfirmed    → a likely partner exists but a last-4 is not proof, so a person confirms
 *   no_candidate   → the fuel-card row is genuinely missing; import it
 *   unidentifiable → the mirror row itself carries nothing to match on
 *
 * Returns null for a linked card and for an older API that does not send the field — an absent
 * explanation must not render as "unknown problem".
 */
export function unlinkedReason(card: {
  fuelCardId?: string | null;
  linkStatus?: string | null;
  linkCandidates?: number;
}): string | null {
  if (card.fuelCardId) return null;
  const n = card.linkCandidates ?? 0;
  switch (card.linkStatus) {
    case "ambiguous":
      return `${n} fuel cards share these last four — add a unit to tell them apart`;
    case "unconfirmed":
      return "One likely fuel card, but the last four alone is not proof — confirm it";
    case "no_candidate":
      return "No fuel card with these last four has been imported";
    case "unidentifiable":
      return "This card has no unit and no readable number to match on";
    default:
      return null;
  }
}
