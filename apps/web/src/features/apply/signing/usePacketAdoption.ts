import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { PacketMarkKind } from "@silvicom/shared";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";

/**
 * The marks the driver adopts, and the moment each one stops being changeable (D-PKT6, D-PKT13, A4).
 *
 * ── WHY THIS IS ITS OWN FILE (Q-PKT11) ────────────────────────────────────────────────────────
 * `usePacketCeremony.ts` reached 481 of 500 lines. It was 248 before A3, and everything added since
 * is the long-form WHY this repo asks for and is load-bearing — the cursor post-mortem below is the
 * only place the `refetchOnWindowFocus` hazard is written down. The candidates were to trim those
 * comments, to waive the file, or to split it; Q-PKT11 ruled the split, because the other two retire
 * the only pressure keeping readable the file that produced four defects in two days.
 *
 * ⚠ **Nothing here changes behaviour, and that is the whole value of the diff.** The composable
 * moved, its comments came with it, and `usePacketCeremony` composes it and passes its surface
 * straight through — so the component and its 829-line suite cannot tell the difference. That is why
 * this is its own PR: a refactor bundled into a feature step is a diff in which nobody can see which
 * lines were the feature. The `useApplicationSending` lift is the worked example (PR 883 — written
 * without its hash on purpose: `lint:tokens` reads a hash plus three hex digits as a colour, so the
 * usual PR shorthand fails the build here).
 *
 * ── THE SEAM, AND WHY IT FALLS HERE ───────────────────────────────────────────────────────────
 * The WALK is about places on paper — which stop is next, what is outstanding, what the server has
 * counted. ADOPTION is about the two marks themselves — what they say, how they are made, and which
 * of them the server has already fixed. They meet at exactly two points, and both stayed on the walk
 * side: `markFor` (which of the two marks a stop takes) is called by `sign`, and
 * `currentShowsDrawing` needs the stop the driver is standing on.
 *
 * ⚠ **`stops`, `outstanding` and `filedHere` are PASSED IN, never recomputed here.** The walk owns
 * them. Recomputing `outstanding` from `stops` in this file would be a second computation of a fact
 * the first one already owns — which is exactly the defect `placesWithMark` below was written to fix,
 * and it would be reintroduced by the very change meant to tidy the file.
 *
 * ⚠ **"One mark" is TWO marks, and that was a defect here until 2026-09-14 (Q-PKT8).** `p05`, `p06`
 * and `p09` ask for initials, and D-PKT6 has always been explicit that initials are *"a SECOND
 * adopted mark and not an abbreviation of the first… a ceremony that derived them from the typed name
 * would be inventing a mark the signer never made"*. The ceremony sent the full name to all twenty-two
 * stops — onto the three narrowest lines in the packet, at 89–141pt — and the server would have
 * refused a client that got it right, because `record_packet_mark` pinned one name per link until
 * migration 0340 made the pin per kind. The initials are typed, like the name; they are not derived
 * from it anywhere, and there is no keystroke in this file that turns one into the other.
 */

/** How the driver chose to make their mark (D-PKT13). Decided once, before the first stop. */
export type AdoptedMarkStyle = "typed" | "drawn";

export interface PacketAdoptionInput {
  token: Ref<string>;
  /** Every stop on the carrier's paper, and what this walk has filed — the two evidence sources. */
  stops: Ref<ApplyPacketStop[]>;
  filedHere: Ref<Set<string>>;
  /** What is still to be collected. The WALK owns this; see the header on why it is not recomputed. */
  outstanding: ComputedRef<ApplyPacketStop[]>;
  /**
   * The walk's busy flag, shared rather than duplicated.
   *
   * ⚠ One screen, one button: staging a drawing and filing a mark can never both be in flight, and
   * `sign` refuses to start while this is true. A second flag here would let the walk start while the
   * drawing was still uploading, which is a behaviour change dressed as a tidy-up.
   */
  working: Ref<boolean>;
  /**
   * What this link has already adopted, served by `GET /:token` (Q-PKT9).
   *
   * ⚠ **A resumed walk must not ask for these again.** `record_packet_mark` pinned them at the first
   * stop, so a second spelling is refused at the next one with advice the driver cannot act on. Given
   * them, the adoption screen shows the mark rather than an empty field.
   */
  served?: Ref<{ signature: string | null; initials: string | null } | null | undefined>;
  stage?: typeof stageCapture;
  io?: CaptureIo;
}

export function usePacketAdoption(input: PacketAdoptionInput) {
  const { token, stops, filedHere, outstanding, working, served } = input;
  const stage = input.stage ?? stageCapture;

  const adoptedName = ref(served?.value?.signature ?? "");
  /**
   * The second adopted mark (D-PKT6, Q-PKT8). Typed, always — never derived from `adoptedName`.
   *
   * ⚠ Typed even when the driver DRAWS their signature, and for the same reason the name is: the
   * drawn blob is a staged decoration and `signed_name` is the record on every row (D-APP8), so what
   * the overlay puts on `p05` is this string. A second drawing pad would collect an image nothing
   * reads.
   */
  const adoptedInitials = ref(served?.value?.initials ?? "");
  const style = ref<AdoptedMarkStyle>("typed");
  /** The drawn mark, when the driver chose to draw one. */
  const markBlob = ref<Blob | null>(null);
  const adopted = ref(false);
  /**
   * Whether the driver has SEEN the confirm screen and said yes (A4).
   *
   * ⚠ Separate from `adopted`, which only means the marks have been collected and the drawing staged.
   * Collapsing the two is what made the old flow go straight from the last keystroke to the first
   * signature with nothing in between.
   */
  const confirmed = ref(false);
  /**
   * Whether the drawing the driver made did NOT survive being staged (A3).
   *
   * ⚠ **The swallow below stays; what was wrong with it was the silence.** A8b's rule is right — a
   * PNG that will not upload must not stand between a driver and twenty-two signatures — so the walk
   * carries on with the typed name, which is the signature of record anyway (D-APP8). But the driver
   * chose to draw, and until this flag existed they were never told it had not worked: they went on
   * to sign twenty-two places believing their drawing was going on the paper, and the filed document
   * came out typed. The product looked like it had ignored them, which is what the owner reported as
   * *"custom signature cannot be applied"*.
   *
   * ⚠ A flag rather than an error, because this is not a failure of the ceremony — nothing is lost
   * and there is nothing to retry. It changes what the screen PROMISES, and that is all.
   */
  const drawnMarkFailed = ref(false);

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
  const needsInitials = computed(() => outstanding.value.some((s) => s.mark === "initials"));

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

  /**
   * Adopt the mark, once.
   *
   * ⚠ The typed name is required even when the driver draws, and that is D-APP8 rather than an
   * oversight: `application_packet_marks.signed_name` is the signature of RECORD on every row, and
   * the packet itself asks for a printed name beside the mark on page 22 (`Driver name Print`). What
   * D-PKT13 adds is which of the two appears on the paper.
   *
   * ⚠ The drawn mark is awaited and its failure does not stop the walk — A8b's rule, and the reason
   * is the same one: a PNG that will not upload must not stand between a driver and twenty-two
   * signatures on a document their job depends on. If it fails they have still signed, with their
   * typed name. ⚠ **But it is RECORDED now** (`drawnMarkFailed`, A3): it was swallowed in silence
   * until 2026-09-18, so the screen went on promising a drawing the filed packet would not carry.
   */
  async function adopt(): Promise<boolean> {
    if (adoptedName.value.trim().length < 2) return false;
    // ⚠ One character, not two. A signature has a first name and a surname behind it; a single
    // initial is what somebody with one legal name has, and `applicationPacketMarkSchema` accepts
    // `min(1)`. Refusing it here would be this client inventing a rule the contract does not have.
    if (needsInitials.value && adoptedInitials.value.trim().length < 1) return false;
    if (style.value === "drawn" && !markBlob.value) return false;
    const blob = markBlob.value;
    if (blob) {
      working.value = true;
      try {
        await stage(token.value, "signature_mark", blob, "image/png", input.io);
        drawnMarkFailed.value = false;
      } catch {
        // ⚠ Still swallowed, still not rethrown — and now SAID. See `drawnMarkFailed`.
        drawnMarkFailed.value = true;
      } finally {
        working.value = false;
      }
    }
    adopted.value = true;
    /**
     * ⚠ **A resumed link skips the confirm step, and only a resumed link does** (A4). `alreadyAdopted`
     * is true when the SERVER has already pinned both marks, which means there is nothing on that
     * screen the driver could change — `record_packet_mark` would refuse a different spelling with
     * `DR035`. Showing it anyway would be asking somebody to approve a decision that is already
     * final, which is the shape of consent theatre rather than consent.
     */
    confirmed.value = alreadyAdopted.value;
    return true;
  }

  /**
   * The driver has read the confirm screen and is happy (A4). Nothing is filed by this — the first
   * mark is still the thing that fixes anything — so it is a screen change and nothing more.
   */
  function confirm(): void {
    if (!adopted.value) return;
    confirmed.value = true;
  }

  /**
   * Go back and change a mark that is not yet fixed (A4).
   *
   * ⚠ **Refuses when BOTH kinds are pinned**, because at that point there is nothing to go back for
   * and a form whose every field is disabled is worse than no form. When only one is pinned it opens:
   * the other is still genuinely editable, and `canChange` tells the screen which is which so the
   * disabled one can say WHY rather than vanishing.
   *
   * ⚠ Returns to `adopting`, not to a special edit mode. The adoption screen is already the place
   * these marks are made, and a second screen for changing them would be a second place the rules
   * about what a mark may be would have to live.
   */
  function reopen(): boolean {
    if (!canChange("signature") && !canChange("initials")) return false;
    adopted.value = false;
    confirmed.value = false;
    return true;
  }

  /**
   * Which of the two adopted marks a stop takes.
   *
   * ⚠ **The STOP's own kind decides, and it comes off the carrier's paper.** `mark` is
   * `PacketPlacement`'s, measured from the packet and served by the API; nothing here classifies a
   * page. A ceremony that guessed — from the page number, from the anchor text — would be a second
   * opinion about a document the inventory already describes.
   */
  function markFor(stop: ApplyPacketStop): string {
    return stop.mark === "initials" ? adoptedInitials.value.trim() : adoptedName.value.trim();
  }

  return {
    adoptedName,
    adoptedInitials,
    needsInitials,
    alreadyAdopted,
    markFor,
    style,
    markBlob,
    pinnedKinds,
    canChange,
    placesWithMark,
    confirm,
    reopen,
    confirmed: computed(() => confirmed.value),
    drawnMarkFailed: computed(() => drawnMarkFailed.value),
    adopted: computed(() => adopted.value),
    adopt,
  };
}
