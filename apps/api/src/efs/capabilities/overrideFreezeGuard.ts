import {
  OVERRIDE_BLOCKED_CAPABILITIES,
  overrideBlockedMessage,
  overrideBlocksWrite,
} from "@fuelguard/shared";
import { ActionRefusalError } from "../../services/efsCardControlErrors.js";
import type { Snapshot } from "../types.js";

/**
 * Refuse a write an armed override would silently swallow (docs/22 H16).
 *
 * ── Why a precondition and not a better failure message ─────────────────────────────────────────
 * The vendor gives no signal. H16's two writes were byte-identical apart from the card's override
 * count, and both came back `responseShape: empty` with no fault — the ignored one is
 * indistinguishable from the applied one at the response layer. So the only alternative to refusing
 * up front is to dispatch, re-read, notice nothing moved, and tell the operator "EFS accepted the
 * request but the card is unchanged. Check the card in the WEX portal before retrying" — which is
 * what happens today, names neither the cause nor the cure, and has already spent a vendor call and a
 * rate-limit slot by the time it says so.
 *
 * ── `snap.doc`, never the mirror, and the guard is worthless otherwise ──────────────────────────
 * `precondition` runs after the fresh in-operation read, which is the only document that can be right
 * here. A sweep-old `override_uses: 0` from the mirror would wave the write straight through into the
 * silent ignore, and the failure would look exactly like the one this guard exists to prevent — so
 * reading the wrong document does not merely weaken the guard, it makes it invisible.
 *
 * A document we could not read at all does NOT refuse: `plan` has its own handling for a failed read,
 * and refusing here would turn a transient vendor blip into "this card has an exception", which is a
 * claim about the card rather than about the request.
 */
export function assertOverrideDoesNotBlock(capabilityKey: string, snap: Snapshot): void {
  const uses = snap.doc?.card.overrideUses ?? null;
  if (snap.doc === null || !overrideBlocksWrite(uses)) return;

  const what = OVERRIDE_BLOCKED_CAPABILITIES[capabilityKey];
  // A capability not in the map is one nobody decided about. Fail CLOSED with a generic noun rather
  // than waving it through: the whole point of H16 is that being wrong here is SILENT.
  throw new ActionRefusalError(
    overrideBlockedMessage(uses ?? 0, what ?? "this change"),
    "invalid_request",
  );
}
