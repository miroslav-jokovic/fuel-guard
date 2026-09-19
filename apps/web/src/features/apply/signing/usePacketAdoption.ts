import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { PacketMarkKind } from "@silvicom/shared";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";
import { DEFAULT_MARK_STYLE_ID } from "@/features/apply/signing/markStyles";

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

/**
 * How the driver chose to make their mark (D-PKT13, and the three tabs of C2/D-HUI14).
 *
 * ⚠ **`"typed"` is gone, and it is gone rather than renamed because it named a different behaviour.**
 * It meant *put the string on the paper* — `renderPacketOverlay` drew it with `drawText` in
 * `StandardFonts.HelveticaOblique`, which is a form field and not a signature, while the adoption
 * screen previewed it in a brush script under copy promising the two were the same. All three tabs now
 * produce a PNG and the PNG is what the packet prints, so the preview is the print rather than a
 * picture of it. `markRaster.ts` carries the measurement and the full argument.
 *
 * ⚠ **The typed-text branch in the overlay survives, and must**, because `signed_name` is still the
 * signature of record (D-APP8) and A8b's rule still holds: a PNG that will not stage may never stand
 * between a driver and twenty-two signatures. It is now the FALLBACK rather than a choice, reached
 * only through `drawnMarkFailed` — and every preview reads that flag, so nothing promises a picture
 * the filed document will not carry.
 */
export type AdoptedMarkStyle = "styled" | "drawn" | "uploaded";

/**
 * Whether choosing this way of making a mark means the driver has to actually make one.
 *
 * ⚠ The asymmetry is deliberate and it is A8b's rule applied per tab. A driver who opened **Draw** and
 * drew nothing, or opened **Upload** and chose no file, has not done the thing the tab is for, and
 * starting a twenty-two place walk for them would file a packet they did not mean to sign that way.
 * A **styled** mark is generated on their behalf, so its failure is ours — blocking there would strand
 * a driver on a browser with no 2D context, in front of a button that will not light up and gives no
 * reason. They go on with the typed name, and `drawnMarkFailed` makes every screen say so.
 */
export const markRequiredFor = (style: AdoptedMarkStyle): boolean => style !== "styled";

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
  /**
   * Whether this link ALREADY has a `signature_mark` staged, from a previous visit (C2).
   *
   * ── ⚠ WHY THIS HAD TO BE ADDED IN THE SAME STEP AS THE THREE TABS ─────────────────────────────
   * `application_captures` holds one row per slot and it survives the session that made it, so a
   * driver who adopted a mark on Monday and comes back on Tuesday has a PNG on the server and an empty
   * `markBlob` in the browser. Before C2 that produced a rare wrong preview — only a driver who had
   * DRAWN saw the typed name on resume while the paper carried their drawing. C2 gives every driver a
   * PNG, so the same defect would have become the normal experience of every resumed walk.
   *
   * ⚠ **It says a picture EXISTS; it cannot show it.** The apply bundle serves capture slots as dates
   * and never as bytes (`useApplicationCaptures`: *"slots serve dates, not pictures — no re-serving of
   * a URL"*), which is a deliberate rule about a public link and not an oversight to work around here.
   * So the screens say the mark is saved and will keep being used, in a sentence. ⚠ **What they must
   * not do is fall back to previewing the typed name**, because that is a picture of the wrong thing,
   * shown with no caveat, on the screen whose job is to be believed.
   */
  markStaged?: Ref<boolean>;
  stage?: typeof stageCapture;
  io?: CaptureIo;
}

export function usePacketAdoption(input: PacketAdoptionInput) {
  const { token, stops, filedHere, outstanding, working, served, markStaged } = input;
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
  const style = ref<AdoptedMarkStyle>("styled");
  /**
   * Which of the four hands a STYLED mark is drawn in (`markStyles.ts`).
   *
   * ⚠ It is not sent anywhere and nothing stores it. The choice leaves this screen as pixels, which is
   * the whole point of D-HUI14: a face recorded as an id would have to be resolvable by whatever
   * re-renders the packet in ten years, and that is the embedded-font problem `packetOverlay.ts`
   * declined. A PNG has no such dependency.
   */
  const styleId = ref(DEFAULT_MARK_STYLE_ID);
  /**
   * The picture of the mark, whichever tab made it — styled, drawn or uploaded.
   *
   * ⚠ **One ref for all three, because the packet cannot tell them apart.** They converge on a single
   * `signature_mark` capture (`application_captures` holds one row per slot) and a single `embedPng`
   * on the carrier's paper, so three refs would be three states for one fact and the screen would need
   * a rule for what to show when two of them were set.
   */
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
   * Whether the mark the driver made did NOT survive being made or staged (A3).
   *
   * ⚠ **The swallow below stays; what was wrong with it was the silence.** A8b's rule is right — a
   * PNG that will not upload must not stand between a driver and twenty-two signatures — so the walk
   * carries on with the typed name, which is the signature of record anyway (D-APP8). But the driver
   * chose to draw, and until this flag existed they were never told it had not worked: they went on
   * to sign twenty-two places believing their drawing was going on the paper, and the filed document
   * came out typed. The product looked like it had ignored them, which is what the owner reported as
   * *"custom signature cannot be applied"*.
   *
   * ⚠ **C2 gave it two more ways to become true, and that is why it is worded about the MARK rather
   * than about the drawing.** A styled mark whose canvas would not rasterise and an upload that could
   * not be read both end here, because all three tabs stage the same PNG into the same slot and the
   * consequence of not having one is identical whichever tab the driver was on: the packet prints the
   * typed name. A second flag per tab would be three ways to say one thing, and every screen that
   * previews a mark would need to read all three.
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
   * Whether the mark going on the paper is one this browser cannot show — staged on a previous visit
   * (C2). See `markStaged`.
   *
   * ⚠ **`markBlob` wins when it is set**, and the order matters: a driver who resumed and then chose a
   * new style has replaced the staged row (one row per slot), so what the packet will carry is the
   * blob in hand and the screen can show it. This is only true in the gap between arriving on a
   * resumed link and making a new mark.
   *
   * ⚠ And `drawnMarkFailed` clears it, for `currentShowsDrawing`'s reason: if this session's staging
   * failed, the typed name is what lands, and a sentence saying a picture is saved would be promising
   * the document that lost.
   */
  const markCarriedOver = computed(
    () => Boolean(markStaged?.value) && markBlob.value === null && !drawnMarkFailed.value,
  );

  /**
   * Whether a picture of a signature will be printed, whatever this browser happens to be holding.
   *
   * ⚠ The union of "made here" and "already on the server", because the packet cannot tell those apart
   * either — `signatureMarkBytes` reads one row and the overlay embeds whatever it finds. Anything on
   * screen describing what the paper will carry reads this rather than `markBlob`.
   */
  const markWillPrint = computed(
    () => !drawnMarkFailed.value && (markBlob.value !== null || Boolean(markStaged?.value)),
  );

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
   * ⚠ The mark is awaited and its failure does not stop the walk — A8b's rule, and the reason is the
   * same one: a PNG that will not upload must not stand between a driver and twenty-two signatures on
   * a document their job depends on. If it fails they have still signed, with their typed name.
   * ⚠ **But it is RECORDED now** (`drawnMarkFailed`, A3): it was swallowed in silence until
   * 2026-09-18, so the screen went on promising a drawing the filed packet would not carry.
   *
   * ⚠ **This is where the PNG is staged and it is staged ONCE, for all three tabs** (C2). The bytes
   * are produced by the tab — `renderStyledMark`, the pad, or `normaliseUploadedMark` — and arrive
   * here as one `markBlob`, so there is exactly one upload, one slot and one failure path however the
   * driver chose to sign. `application_captures` holds one row per slot, so a second staging call
   * would replace the first rather than adding to it, which is what makes switching tabs safe.
   */
  async function adopt(): Promise<boolean> {
    if (adoptedName.value.trim().length < 2) return false;
    // ⚠ One character, not two. A signature has a first name and a surname behind it; a single
    // initial is what somebody with one legal name has, and `applicationPacketMarkSchema` accepts
    // `min(1)`. Refusing it here would be this client inventing a rule the contract does not have.
    if (needsInitials.value && adoptedInitials.value.trim().length < 1) return false;
    if (markRequiredFor(style.value) && !markBlob.value) return false;
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
    } else if (!markStaged?.value) {
      // ⚠ A STYLED mark with nothing to stage, which `markRequiredFor` lets through on purpose. The
      // rasteriser handed back null — no 2D context, or `toBlob` refused — so the packet will print
      // the typed name, and this is the one place that can still say so before the driver is shown a
      // preview. Setting the flag here rather than in the component keeps the promise and the bytes
      // decided in the same place: a screen cannot be told a picture exists that this function knows
      // it never staged.
      //
      // ⚠ **`markStaged` guards it, and that guard is a defect found by RENDERING and by nothing else.**
      // A resumed link whose marks the server has already pinned reaches `adopt()` through *Carry on
      // signing* with an empty `markBlob` — correctly, because the picture was staged on the previous
      // visit and there is nothing to send. Without this clause that reads as a failure: the flag went
      // up, `markWillPrint` went down, and every one of the remaining stops previewed the typed name
      // under *"We will put this on the page"* while the packet carried the driver's own signature. The
      // suite was green for it, because a composable cannot tell that two refs it set are describing
      // different links. Walked in the browser on 2026-09-19, which is the only way it surfaced.
      drawnMarkFailed.value = true;
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
    styleId,
    markBlob,
    markCarriedOver,
    markWillPrint,
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
