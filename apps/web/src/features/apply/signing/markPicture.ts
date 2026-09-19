import { computed, ref, type Ref } from "vue";
import type { ApplicationCaptureSlot } from "@silvicom/shared";

/**
 * One adopted mark's PICTURE — how it is made, held, sent, and reported on (Q-HUI14, D-HUI14).
 *
 * ── ⚠ WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────────────────────
 * `usePacketAdoption.ts` reached 618 of the 500-line budget when the initials got a picture of their
 * own, which is the second time this area has hit it — Q-PKT11 split the walk from the marks for
 * exactly the same reason, and ruled the split over trimming the comments or taking a waiver,
 * because the other two retire the only pressure keeping a file that produced four defects in two
 * days readable. So the same ruling applies again, one level down.
 *
 * ── THE SEAM ──────────────────────────────────────────────────────────────────────────────────
 * This file knows about ONE mark at a time and nothing else: no stops, no pins, no walk, no idea
 * that there are two of them. `usePacketAdoption` owns the two adopted STRINGS, which of them the
 * server has fixed, and what the screen may still change; this owns what a picture of a mark is.
 * That is why `stageMarkPictures` takes a `send` closure rather than the token — sending is the
 * adoption's business, and the ORDER and the failure rule are this file's.
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


/**
 * Everything about ONE adopted mark's picture — the bytes in hand, whether they failed, and the two
 * questions every screen asks about them (Q-HUI14).
 *
 * ── ⚠ WHY A FACTORY AND NOT A SECOND SET OF REFS ──────────────────────────────────────────────
 * Q-HUI14 gave the initials a picture, which doubled every one of these: two blobs, two failure
 * flags, two *"is it carried over"* and two *"will it print"*. Writing the second set out by hand
 * would have been four more copies of four rules — and `markCarriedOver`'s and `markWillPrint`'s
 * bodies are subtle enough that C2 got one of them wrong by a single term (`markStaged` missing from
 * the `adopt()` guard, found only by walking the browser). A copy is a workaround with a delay fuse;
 * this is the rule stated once and instantiated twice, so a correction to either question reaches
 * both marks or neither.
 *
 * ⚠ The `staged` ref is handed in rather than read from a shared object: the signature's comes from
 * `markStaged` and the initials' from `initialsStaged`, and they are genuinely different facts.
 */
export function makeMarkPicture(staged: Ref<boolean> | undefined) {
  /**
   * The picture, whichever tab made it — styled, drawn or uploaded.
   *
   * ⚠ **One ref per MARK for all three tabs, because the packet cannot tell the tabs apart.** They
   * converge on a single capture row (`application_captures` holds one row per slot) and a single
   * `embedPng`, so three refs would be three states for one fact and the screen would need a rule
   * for what to show when two of them were set.
   */
  const blob = ref<Blob | null>(null);
  /**
   * Whether the mark the driver made did NOT survive being made or staged (A3).
   *
   * ⚠ **The swallow stays; what was wrong with it was the silence.** A8b's rule is right — a PNG
   * that will not upload must not stand between a driver and twenty-two signatures — so the walk
   * carries on with the typed text, which is the mark of record anyway (D-APP8). But the driver chose
   * how to sign, and until this flag existed they were never told it had not worked: they went on to
   * sign twenty-two places believing their picture was going on the paper, and the filed document
   * came out typed. The product looked like it had ignored them, which is what the owner reported as
   * *"custom signature cannot be applied"*.
   *
   * ⚠ **Per MARK and not per tab.** A styled mark whose canvas would not rasterise, a pad that would
   * not encode and an upload that could not be read all end here, because all three stage the same
   * PNG into the same slot and the consequence is identical: that mark's lines print typed text. A
   * flag per tab would be three ways to say one thing. ⚠ But per mark it IS two things — the
   * signature landing and the initials failing is a real outcome, and it prints differently on
   * nineteen lines from on three.
   *
   * ⚠ A flag rather than an error, because this is not a failure of the ceremony — nothing is lost
   * and there is nothing to retry. It changes what the screen PROMISES, and that is all.
   */
  const failed = ref(false);
  /**
   * Whether the picture going on the paper is one this browser cannot show — staged on a previous
   * visit. See `markStaged`.
   *
   * ⚠ **`blob` wins when it is set**, and the order matters: a driver who resumed and then made a new
   * mark has replaced the staged row (one row per slot), so what the packet will carry is the blob in
   * hand and the screen can show it. This is only true in the gap between arriving on a resumed link
   * and making a new mark.
   *
   * ⚠ And `failed` clears it, for `currentShowsDrawing`'s reason: if this session's staging failed,
   * the typed text is what lands, and a sentence saying a picture is saved would be promising the
   * document that lost.
   */
  const carriedOver = computed(
    () => Boolean(staged?.value) && blob.value === null && !failed.value,
  );
  /**
   * Whether a picture of this mark will be printed, whatever this browser happens to be holding.
   *
   * ⚠ The union of "made here" and "already on the server", because the packet cannot tell those
   * apart either — `signatureMarkBytes` reads one row per kind and the overlay embeds whatever it
   * finds. Anything on screen describing what the paper will carry reads this rather than `blob`.
   */
  const willPrint = computed(
    () => !failed.value && (blob.value !== null || Boolean(staged?.value)),
  );
  /**
   * Whether the server already holds a picture of this mark, flattened to a plain boolean.
   *
   * ⚠ Exposed only so `adopt()` can ask the question in the same words the old single-mark code asked
   * it in — *"is there nothing to stage AND nothing on the server"*. `carriedOver` would give the same
   * answer at that point in `adopt()` and only by a chain of reasoning about which of its three terms
   * are already known; a guard on a federal record should not need one.
   */
  const stagedAlready = computed(() => Boolean(staged?.value));
  return { blob, failed, carriedOver, willPrint, stagedAlready };
}

/** One mark's picture state, so the stager can take either of the two without naming which. */
export type MarkPicture = ReturnType<typeof makeMarkPicture>;

/** One mark queued for staging, and whether the packet is asking for it at all. */
export interface MarkStaging {
  picture: MarkPicture;
  slot: ApplicationCaptureSlot;
  /**
   * ⚠ Nothing on the paper takes this kind of mark, so there is nothing to stage AND nothing to
   * report a failure about. Without it a resumed link with all three initials stops collected would
   * raise `initialsMarkFailed` about a mark the packet will never ask for.
   */
  skip: boolean;
}

/**
 * Send each picture that has bytes, and record the ones that have none (A8b, A3, Q-HUI14).
 *
 * ⚠ **One loop over the marks rather than a block each**, so the rule — *stage it; on failure carry
 * on and say so; with nothing to stage and nothing on the server, say so too* — exists once. C2
 * shipped this rule as one block and the staged-already clause in it was wrong for a whole day (see
 * below); a second hand-written copy for the initials would have been a second chance to get the same
 * subtlety wrong, on the mark nobody walks as often.
 *
 * ⚠ **Sequential, and it never touches the busy flag.** The flag belongs to the WALK and is raised
 * once around this whole call by `adopt()` — see its note on why raising and clearing it per picture
 * leaves a window a driver's tap can land in. Sequential because two uploads in flight on a phone is
 * not a kindness to either.
 *
 * ⚠ `send` is a closure rather than a token plus an io bundle: this file's business is the ORDER and
 * the failure rule, and how bytes reach the server is `stageCapture`'s.
 */
export async function stageMarkPictures(
  staging: readonly MarkStaging[],
  send: (slot: ApplicationCaptureSlot, blob: Blob) => Promise<unknown>,
): Promise<void> {
  for (const { picture, slot, skip } of staging) {
    if (skip) continue;
    const blob = picture.blob.value;
    if (blob) {
      try {
        await send(slot, blob);
        picture.failed.value = false;
      } catch {
        // ⚠ Still swallowed, still not rethrown — and now SAID. See `makeMarkPicture`'s `failed`.
        picture.failed.value = true;
      }
    } else if (!picture.stagedAlready.value) {
      // ⚠ A STYLED mark with nothing to stage, which `markRequiredFor` lets through on purpose. The
      // rasteriser handed back null — no 2D context, or `toBlob` refused — so the packet will print
      // the typed text, and this is the one place that can still say so before the driver is shown a
      // preview. Setting the flag here rather than in the component keeps the promise and the bytes
      // decided in the same place: a screen cannot be told a picture exists that this function knows
      // it never staged.
      //
      // ⚠ **The staged-already guard is a defect found by RENDERING and by nothing else.** A resumed
      // link whose marks the server has already pinned reaches `adopt()` through *Carry on signing*
      // with an empty blob — correctly, because the picture was staged on the previous visit and
      // there is nothing to send. Without this clause that reads as a failure: the flag went up,
      // `willPrint` went down, and every one of the remaining stops previewed the typed name under
      // *"We will put this on the page"* while the packet carried the driver's own signature. The
      // suite was green for it, because a composable cannot tell that two refs it set are describing
      // different links. Walked in the browser on 2026-09-19, which is the only way it surfaced.
      picture.failed.value = true;
    }
  }
}
