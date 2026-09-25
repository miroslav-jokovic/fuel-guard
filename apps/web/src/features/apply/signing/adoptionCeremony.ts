import type { ComputedRef } from "vue";
import type { APPLY_COPY } from "@/features/apply/strings";
import type { PacketCeremonyState, usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";

/**
 * What the adoption screens (`PacketAdoption.vue`) need from a ceremony, and nothing more (AF6).
 *
 * ── WHY THIS IS NOT `ReturnType<typeof usePacketCeremony>` ANY MORE ──────────────────────────
 * Two ceremonies adopt a signature now. The packet's walks places on the carrier's paper; AF6's walks
 * the six permissions, each its own PDF (D-AF2). Both adopt through `usePacketAdoption`, so the
 * applicant makes their mark once, in the same Type/Draw/Upload tabs with the same confirm step, and
 * the packet later offers that same picture as carried over. The component takes the ceremony WHOLE
 * for Q-PKT11's reason (the state machine stays in one instance). What changes is that "whole" is now
 * stated as the members it reads, so a second ceremony can supply them without posing as the packet.
 *
 * ⚠ `collected` is narrowed to "a list" because the screen reads only its length. A permission is not
 * a packet stop, and the type should not claim otherwise.
 */
type PacketCeremony = ReturnType<typeof usePacketCeremony>;

export type AdoptionCeremony = Pick<
  PacketCeremony,
  | "adopt" | "adoptedName" | "adoptedInitials" | "alreadyAdopted" | "canChange" | "confirm"
  | "complete" | "drawnMarkFailed" | "initialsBlob" | "initialsCarriedOver" | "initialsMarkFailed"
  | "markBlob" | "markCarriedOver" | "needsInitials" | "pinnedKinds" | "placesWithMark" | "reopen"
  | "style" | "styleId" | "total" | "working"
> & {
  state: ComputedRef<PacketCeremonyState>;
  collected: ComputedRef<readonly unknown[]>;
};

/** Every literal in a copy set widened to its kind, so a second set of words fits the same shape. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

/**
 * The words the adoption screens say. The packet's by default; the permissions pass their own
 * (`APPLY_COPY.permissions.adoption`), because "your signature in 20 places on their form" is false
 * on a screen about six documents.
 */
export type AdoptionCopy = Widen<typeof APPLY_COPY.packet>;
