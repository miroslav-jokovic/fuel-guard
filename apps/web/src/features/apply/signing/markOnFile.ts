import {
  APPLICATION_CAPTURE_MARK_SLOT,
  type ApplicationCaptureView,
  type PacketMarkKind,
  type SignatureAdoptionsView,
} from "@silvicom/shared";

/**
 * Whether the link already holds a picture of this kind of mark, for the packet to carry over (C2,
 * Q-HUI14, C3s1).
 *
 * Two places can hold one: the capture slot the packet stages (and, before C3s1, the permissions did),
 * and screen 13's adoption (D-AW15). The renderer draws whichever was made last (`signatureMarkBytes`),
 * so either one means "a picture will print" — and neither is the typed name, which is why this is a
 * question about pictures and never about `adoptedMarks`.
 */
export function markOnFile(
  kind: PacketMarkKind,
  captures: readonly ApplicationCaptureView[],
  adoptions: SignatureAdoptionsView | undefined,
): boolean {
  return captures.some((c) => c.slot === APPLICATION_CAPTURE_MARK_SLOT[kind]) || Boolean(adoptions?.[kind]);
}
