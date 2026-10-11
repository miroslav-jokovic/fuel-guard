import { computed } from "vue";
import type { PacketMarkKind } from "@silvicom/shared";
import type { PacketAdoptionInput } from "@/features/apply/signing/usePacketAdoption";

/**
 * What the SERVER has already fixed about the two adopted marks, read off the evidence (A4, Q-PKT9).
 *
 * ⚠ **Split out of `usePacketAdoption.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning, and along the seam that file's own header draws one level down: ADOPTION is
 * about the marks the driver is making, and these five are about which of them the link has
 * already pinned. Every one reads only `stops`, `filedHere`, `outstanding` and `served` — never the
 * boxes the driver is typing into, which is exactly the distinction `alreadyAdopted`'s note below
 * was written to defend. `usePacketAdoption` calls this once, in its own setup, and returns the same
 * five members it always did, so no consumer can tell the difference.
 *
 * `import type` only from `usePacketAdoption.ts`: it is erased, so there is no runtime cycle.
 */
export function usePacketAdoptionPins(
  input: Pick<PacketAdoptionInput, "stops" | "filedHere" | "outstanding" | "served" | "initialsWanted">,
) {
  const { stops, filedHere, outstanding, served, initialsWanted } = input;

  /**
   * Whether this link still has a stop that takes initials, and therefore whether to ask for them.
   *
   * ⚠ **Derived from the stops rather than from a constant `3`.** `driverPlacements()` is the
   * inventory of somebody else's paper and it has already gained an entry mid-array once (p17,
   * D-PKT12); a hard-coded count is a second place the packet's shape would live.
   *
   * ⚠ **`outstanding`, not every stop.** A driver resuming a link that already collected `p05`,
   * `p06` and `p09` has nothing left to initial, and asking again would be asking them to reproduce
   * a mark the server has already pinned — which a different keystroke would get refused for
   * (DR035). See Q-PKT9: the same hazard exists for a resumed SIGNATURE and is not solved here.
   */
  // D-AW15: screen 13 asks for the initials with the signature, though no permission takes them.
  const needsInitials = computed(
    () => initialsWanted?.value ?? outstanding.value.some((s) => s.mark === "initials"),
  );

  /**
   * Which of the two adopted marks this LINK has already fixed on the server (A4).
   *
   * ── WHY THIS EXISTS, AND WHY IT IS PER KIND ───────────────────────────────────────────────────
   * `record_packet_mark` (0340) pins per `(invitation_id, mark)`: the FIRST row of a kind fixes
   * `signed_name` for that kind, and any later stop of that kind arriving with a different spelling
   * is refused `DR035`. So the two marks are fixed at two different moments — the signature at the
   * first signature stop (`p03`, place 1), the initials at the first INITIALS stop (`p05`, place 3).
   *
   * ⚠ **That gap is the whole of A4's opportunity and §1.4 does not spell it out.** The moment a
   * driver is most likely to notice a mistyped initial is the moment they first SEE it in place —
   * "We will put your initials on the page: MV", at place 3, immediately before they press. At that
   * moment the initials are not yet pinned and the server would accept a correction. Before this,
   * the screen collected both marks up front and offered no way back, so a stray keystroke was
   * permanent for a federal record and the refusal, when it came, was `DR035` — advice the driver
   * cannot act on.
   *
   * ⚠ **Derived from what has been FILED, never from a flag this file sets.** Three sources, all of
   * them evidence: what the server served as pinned (`served`), any stop it served as already
   * collected, and anything this walk has filed. That is the same principle 0340's header gives for
   * reading the pin off the marks rather than off a summary of them — a summary can drift from the
   * rows, and here the cost of drifting is offering the driver a correction the server will refuse,
   * or withholding one it would have taken.
   */
  const pinnedKinds = computed<ReadonlySet<PacketMarkKind>>(() => {
    const pinned = new Set<PacketMarkKind>();
    const pin = served?.value;
    if (pin?.signature?.trim()) pinned.add("signature");
    if (pin?.initials?.trim()) pinned.add("initials");
    for (const stop of stops.value) {
      if (stop.signedAt || filedHere.value.has(stop.id)) pinned.add(stop.mark);
    }
    return pinned;
  });

  /** Whether a correction to this kind would still be accepted. The server decides; this reads it. */
  const canChange = (kind: PacketMarkKind): boolean => !pinnedKinds.value.has(kind);

  /**
   * How many places already carry a mark of this kind (A4) — the REASON a locked mark gives.
   *
   * ⚠ **It lives here rather than in the component, and that is a defect found by rendering.** The
   * component had its own version counting `stops.filter(s => s.mark === kind && s.signedAt)`, which
   * looked equivalent and was not: a mark filed during THIS walk is in `filedHere` and will not carry
   * `signedAt` until the next refetch. So the screen told a driver *"Your signature is already on 0
   * places of the form, so it cannot be changed now"* — a sentence that refuses and disproves itself
   * in the same breath, on the one screen whose job is to be believed.
   *
   * ⚠ The general form of the mistake is the one this repo keeps meeting: a second computation of a
   * fact the first one already owns. `pinnedKinds` and this count now read the same two sources, so
   * "it is locked" and "here is how many" cannot disagree.
   */
  const placesWithMark = (kind: PacketMarkKind): number =>
    stops.value.filter((s) => s.mark === kind && (s.signedAt || filedHere.value.has(s.id))).length;

  /**
   * Whether the server has already pinned everything this walk still needs (Q-PKT9).
   *
   * ⚠ Read against `needsInitials`, not against "both are set": a driver whose three initials stops
   * are already collected never adopted any initials and never will, and holding them on the
   * adoption screen for a mark the packet no longer asks for would be the opposite of the fix.
   *
   * ⚠ **Read off the SERVER's pin, never off `adoptedName`/`adoptedInitials`** — and that distinction
   * is the whole of a defect found by rendering the screen on 2026-09-18 (A3). Those two refs are what
   * the input boxes are bound to, so computing this from them made the question *"has this link
   * already adopted a mark?"* answer YES the moment a FIRST-TIME applicant finished typing one. The
   * screen then swapped itself for the resumed panel mid-form: the Type/Draw control disappeared, the
   * signature pad was unmounted, the drawing in it was destroyed, `Use this and start` was replaced by
   * `Carry on signing`, and the applicant was told *"You adopted this when you started"* about a mark
   * they were in the middle of making.
   *
   * ⚠ **For a driver who chose to DRAW that was fatal, not cosmetic**, which is why it belongs to A3:
   * the name field sits above the pad, so the natural order is type, type, draw — and the pad was
   * gone before they reached it. There was no error and nothing to press; the mark silently became
   * the typed one. That is the owner's *"custom signature cannot be applied"* seen from the driver's
   * end, and every test in this file was green for it because a composable has no pad to unmount.
   *
   * The two facts were never the same thing. What the server pinned is a fact about the LINK; what is
   * in the boxes is a fact about this minute's keystrokes. `adoptedName` is SEEDED from the pin, and
   * seeding is where the relationship ends.
   */
  const alreadyAdopted = computed(() => {
    const pin = served?.value;
    if (!pin) return false;
    return (
      Boolean(pin.signature?.trim())
      && (!needsInitials.value || Boolean(pin.initials?.trim()))
    );
  });

  return { needsInitials, pinnedKinds, canChange, placesWithMark, alreadyAdopted };
}
