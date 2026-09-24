import { computed, ref, type Ref } from "vue";
import { applyPacketMark, type ApplyPacketStop } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";
import { usePacketAdoption } from "@/features/apply/signing/usePacketAdoption";

export type { AdoptedMarkStyle } from "@/features/apply/signing/usePacketAdoption";

/**
 * The walk through the carrier's packet (P5, D-PKT6, D-PKT13).
 *
 * ── WHAT THE OWNER ASKED FOR ──────────────────────────────────────────────────────────────────
 * *"The driver needs to be navigated precisely from place to place and sign all places. Similar to
 * DocuSign."* And, on how the mark is made: *"Driver can draw or type name once, but he needs to be
 * directed to each spot and apply saved signature form beginning at each place where needed."*
 *
 * So: adopt the mark — drawn or typed, the driver's choice — and then twenty-two stops, each showing
 * what is being agreed at that place, each one tap.
 *
 * ── WHERE THE MARKS THEMSELVES LIVE (Q-PKT11, 2026-09-18) ─────────────────────────────────────
 * ⚠ **The two adopted marks and everything about fixing them are `usePacketAdoption.ts`**, composed
 * below and passed straight back out, so nothing that reads this composable can tell they moved. This
 * file had reached 481 of 500 lines and C2 adds the adoption dialog — squarely in the half that was
 * already full. Q-PKT11 ruled the split over trimming the comments or waiving the file, both of which
 * retire the only pressure keeping this readable. The seam: this file is about PLACES on paper, that
 * one is about the MARKS, and `markFor` and `currentShowsDrawing` are where they meet.
 *
 * ── WHY THIS IS NOT `useSigningCeremony` WITH A DIFFERENT LIST ────────────────────────────────
 * That one walks five INSTRUMENTS, each its own document with its own served text and its own
 * §604(b)(2) obligation to be the only thing on the screen. This one walks PLACES on one document
 * the driver has already been shown in full on the screen before this. The shapes rhyme and the
 * obligations do not: there is no disclosure to serve per stop, no version to record, and the text
 * that matters is the packet's own page — which is why a stop shows a sentence and a page number
 * rather than a block of instrument text.
 *
 * ⚠ **Six of these stops sit on pages whose instrument was already signed on the phone** — page 15's
 * past-employment release, page 20's FCRA disclosure, page 22's urinalysis notification. The driver
 * signs those pages anyway, because the carrier's paper has a line there and a packet with a blank
 * line on page 20 is not the carrier's packet. Nothing here treats them differently; that they are
 * already authorized is a fact about `driver_authorizations`, not about the paper.
 *
 * ── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────────────────────────
 * Skip, and finish early. A stop only stops being outstanding once it is FILED, so one that did not
 * land cannot be walked past — and `complete` comes from the SERVER's count rather than from this
 * file reaching the end of its own array, because the array is what the client happens to be holding
 * and the count is what the document actually carries.
 *
 * ⚠ It also refuses to let a mistyped mark become permanent without being shown (A4): `confirming`
 * sits between the last keystroke and the first signature, and a kind the server has not yet pinned
 * stays changeable — `pinnedKinds` is what decides, because the server is what enforces it.
 */

/**
 * ⚠ **`confirming` is A4's step and it is a STATE, not a modal.** The driver has typed both marks and
 * has not yet fixed either; the screen shows them as they will be printed and offers a way back. It
 * sits here rather than in the component because what may still be changed is a fact about the
 * server's rows (`pinnedKinds`), and a component cannot be the place that decides it.
 */
export type PacketCeremonyState = "adopting" | "confirming" | "signing" | "done";

export function usePacketCeremony(
  token: Ref<string>,
  stops: Ref<ApplyPacketStop[]>,
  options: {
    stage?: typeof stageCapture;
    io?: CaptureIo;
    /**
     * What this link has already adopted, served by `GET /:token` (Q-PKT9). Read by the adoption
     * half, which is where the rule about resumed links lives.
     */
    adopted?: Ref<{ signature: string | null; initials: string | null } | null | undefined>;
    /**
     * Whether a `signature_mark` was already staged on a previous visit (C2). Read by the adoption
     * half, whose `markStaged` carries the whole argument for why a resumed walk needs it.
     */
    markStaged?: Ref<boolean>;
    /**
     * Whether an `initials_mark` was already staged on a previous visit (Q-HUI14). Read by the
     * adoption half; its `initialsStaged` says why the two marks need two flags.
     */
    initialsStaged?: Ref<boolean>;
  } = {},
) {
  const working = ref(false);
  const error = ref<string | null>(null);
  /**
   * Whether the last refusal was the limiter rather than a fault (A0b).
   *
   * ⚠ A separate flag and not a string comparison on `error`: the screen has to pick different
   * words, and matching on a message is a coupling that survives exactly until somebody edits
   * the copy.
   */
  const rateLimited = ref(false);
  /** The server's own count, which is what "signed through" means. */
  const filed = ref(0);
  const finished = ref(false);

  /**
   * ⚠ Everything this link has NOT collected, in the packet's own page order — re-derived, and the
   * placement ids this WALK filed are part of the derivation.
   *
   * ── ⚠ WHY THIS IS NOT A LIST PLUS A COUNTER, WHICH IS WHAT IT WAS ─────────────────────────────
   * It used to be `stops.filter(s => !s.signedAt)` computed against a snapshot, with `current` being
   * `outstanding[index]` and `index` a counter incremented per filed mark. The header said the list
   * was *"computed once per load"*. **It is a `computed`, so it was not**, and `useApplyInvitationQuery`
   * runs under `VueQueryPlugin` with no `defaultOptions` — which means TanStack's
   * `refetchOnWindowFocus: true` is live on the walk.
   *
   * So: a driver five marks in switches apps to read a text and comes back. The refetch re-serves the
   * packet with those five now carrying `signedAt`, `outstanding` drops from 22 entries to 17, and
   * `index` is still 5 — so `current` becomes `outstanding[5]`, the ELEVENTH place, and five places
   * are stepped over silently. At the end `index` runs off the shortened array, `current` goes null
   * with stops still unsigned, and the template falls through to *"That is every place signed"* on a
   * packet that is not. A phone is where this walk happens, so backgrounding the page is not an edge
   * case; it is the normal way a person uses one.
   *
   * ── THE SHAPE THAT CANNOT DO THAT ─────────────────────────────────────────────────────────────
   * There is no cursor. The current stop is **the first one nobody has filed**, asked fresh every
   * time: `signedAt` is the server's answer and `filedHere` is this session's, and a refetch simply
   * moves a stop from the second to the first. The two agree, so it is self-healing rather than
   * merely resilient — there is no state left over to be wrong.
   *
   * ⚠ **And the count still does not renumber**, which was the original comment's real concern. It
   * was right about the hazard and wrong about the cause: the old `position` added `index` to a
   * number derived from the same shrinking list, so a refetch double-counted. `position` below is
   * one subtraction from `total` and moves by exactly one per mark.
   */
  const filedHere = ref<Set<string>>(new Set());

  const outstanding = computed(() =>
    stops.value.filter((s) => !s.signedAt && !filedHere.value.has(s.id)),
  );

  const current = computed<ApplyPacketStop | null>(() => outstanding.value[0] ?? null);

  /** The whole packet, so the driver sees what they are part-way through rather than what is left. */
  const total = computed(() => stops.value.length);
  const alreadySigned = computed(() => stops.value.length - outstanding.value.length);
  /**
   * "Place 7 of 22", counted against the whole document.
   *
   * ⚠ One subtraction and no cursor — see `outstanding`. The version this replaces added a counter to
   * this same figure, so a mid-walk refetch counted every filed mark twice.
   */
  const position = computed(() => alreadySigned.value + 1);
  const complete = computed(() => finished.value || outstanding.value.length === 0);

  /**
   * The two marks, and everything about fixing them (Q-PKT11).
   *
   * ⚠ The walk's own state is handed IN rather than recomputed there — `stops`, `outstanding`,
   * `filedHere` and the busy flag. A second `outstanding` derived from the same `stops` would be the
   * repeat of a defect the adoption half already carries the post-mortem for: two computations of one
   * fact that look equivalent and disagree the moment a mark is filed but not yet refetched.
   */
  const adoption = usePacketAdoption({
    token,
    stops,
    filedHere,
    outstanding,
    working,
    served: options.adopted,
    markStaged: options.markStaged,
    initialsStaged: options.initialsStaged,
    stage: options.stage,
    io: options.io,
  });

  /**
   * ⚠ **`confirming` sits between adopting and signing, and it is A4** — the step at which the
   * driver sees what they typed, in the face it will be printed in, before any of it is fixed.
   *
   * A resumed link SKIPS it: `alreadyAdopted` means the server pinned both marks on a previous
   * visit, so there is nothing on that screen the driver could change and showing it would be
   * offering a decision that has already been made.
   */
  const state = computed<PacketCeremonyState>(() =>
    complete.value
      ? "done"
      : adoption.confirmed.value
        ? "signing"
        : adoption.adopted.value
          ? "confirming"
          : "adopting",
  );

  /** The stops already collected, for a resumed session to show as done rather than hide. */
  const collected = computed(() => stops.value.filter((s) => Boolean(s.signedAt)));

  /**
   * Every stop that is DONE, counting the ones filed in this tab (C1).
   *
   * ⚠ `collected` is not the same question and C1 needs both. `collected` is what the SERVER had
   * when the bundle was fetched — which is exactly what the rendered packet shows, because the two
   * are read from the same rows — while this is what is true NOW. They differ by `filedHere`, and
   * the difference is visible to the driver: the rail must mark a place they just signed as done,
   * and the page underneath it will not have grown a signature, because the PDF is fetched once per
   * ceremony rather than once per mark (`PacketCeremony.vue` has the rate-budget arithmetic).
   *
   * ⚠ Derived, never a second cursor. It is `signedAt` OR `filedHere`, the same two facts
   * `outstanding` is the complement of, so the rail and the walk cannot drift apart.
   */
  const signedHere = computed(
    () =>
      new Set([
        ...stops.value.filter((s) => s.signedAt).map((s) => s.id),
        ...filedHere.value,
      ]),
  );

  /**
   * Whether the stop the driver is standing on will carry the DRAWING rather than typed text (A3).
   *
   * ⚠ **This is the client half of a NAMED PAIR with `renderPacketOverlay`'s mark loop**, and it is a
   * pair rather than a shared function because the two halves read different things: the renderer
   * looks at the PNG it was handed and the placement it is drawing, and this looks at a Blob that has
   * not been filed yet. What they must agree on is the RULE — *a drawing is a signature, and `p05`,
   * `p06` and `p09` do not ask for one* — and both derive the kind from `PacketPlacement.mark` rather
   * than from a page number, so the agreement survives the packet gaining a stop.
   *
   * ⚠ **One boolean, so the label and the preview cannot contradict each other.** That contradiction
   * WAS the defect: the screen said *"We will put your signature on the page"* over a preview of the
   * typed name, because the caption read `style` and the preview read `markFor()`. Anything on this
   * screen that describes the mark now reads this.
   *
   * ⚠ **A failed upload makes it false**, which is the honest answer and not a defensive one: if the
   * PNG did not stage, `signatureMarkBytes` hands the renderer nothing and the typed name is what
   * lands on all twenty-two. Promising a drawing then would be promising something no filed document
   * will ever show.
   *
   * ⚠ It stays on the WALK side of Q-PKT11's seam because it is about the stop the driver is standing
   * on — one of the two places the two halves meet.
   *
   * ⚠ **C2 removed the `style === "drawn"` term, and removing it was the point rather than a tidy-up.**
   * All three tabs now stage a PNG (D-HUI14), so which tab the driver used stopped being evidence
   * about what the paper will carry — the only question left is whether a picture exists and whether
   * this line takes one. Keeping the term would have made a styled mark preview as typed text while
   * the packet printed the picture, which is the same contradiction the comment above records, pointing
   * the other way.
   *
   * ⚠ **And it asks `willPrint`, not the blob** — a resumed link has a staged mark on the server
   * and nothing in the browser, and the blob alone would say *no picture* about a walk whose every
   * remaining page is about to get one. See `markStaged`.
   *
   * ⚠ **Q-HUI14 turned the `mark === "signature"` term into a SELECTOR, and that is the same change
   * `renderPacketOverlay`'s mark loop made** — the named pair above is still a pair, and it still
   * agrees. Before this, an initials stop answered `false` and previewed typed text, which was exactly
   * right while `takesDrawing` excluded those three lines from the drawing. Now that they have a
   * picture of their own, `false` there would be the same contradiction the notes above record,
   * arriving from the third direction: the screen previewing Helvetica while the paper carried the
   * driver's hand. ⚠ It reads the STOP's kind, never its page number, for `markFor`'s reason.
   */
  const currentShowsDrawing = computed(() => {
    const kind = current.value?.mark;
    if (!kind) return false;
    return kind === "initials" ? adoption.initialsWillPrint.value : adoption.markWillPrint.value;
  });

  /**
   * Whether the picture going on THIS stop was staged on a previous visit and cannot be shown here
   * (Q-HUI14, C2).
   *
   * ⚠ Selected by the stop's kind for `currentShowsDrawing`'s reason. A driver resuming a link that
   * staged a signature and no initials stands on `p05` with a picture in hand for one mark and
   * nothing for the other, and the sentence *"the mark you made earlier is saved"* is true of exactly
   * one of them. The stop screen used to read `markCarriedOver` directly, which would have said it
   * about the signature while standing on an initials line.
   */
  const currentMarkCarriedOver = computed(() => {
    const kind = current.value?.mark;
    if (!kind) return false;
    return kind === "initials"
      ? adoption.initialsCarriedOver.value
      : adoption.markCarriedOver.value;
  });

  /** Apply the adopted mark at the stop the driver is standing on. */
  async function sign(): Promise<void> {
    const stop = current.value;
    if (!stop || working.value) return;
    working.value = true;
    error.value = null;
    rateLimited.value = false;
    try {
      const result = await applyPacketMark(token.value, stop.id, adoption.markFor(stop));
      filed.value = result.signedCount;
      // ⚠ The SERVER decides this, not the end of our array. A resumed link, a second tab or a stop
      // collected elsewhere all mean the client's list is not the document's.
      if (result.complete) finished.value = true;
      // ⚠ This stop is filed, so it stops being outstanding and `current` moves on by itself. Adding
      // the ID rather than advancing a cursor is what makes a mid-walk refetch harmless — see
      // `outstanding`. The server re-serving this stop with `signedAt` set says the same thing twice,
      // which is exactly the property we want.
      filedHere.value = new Set(filedHere.value).add(stop.id);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "packet_mark_already_made") {
        // A double-tap, or the same link open twice. The mark exists — move on rather than telling
        // the driver off for something the server handled correctly.
        filedHere.value = new Set(filedHere.value).add(stop.id);
      } else {
        // ⚠ A0b. The refusal that stopped the first real ceremony was a 429, and until now every
        // refusal here read the same on the screen above — which then sent a driver with a perfectly
        // good connection off to check their signal. This one is carried out separately so the
        // screen can say the only thing that is both true and actionable: wait, press again, nothing
        // is lost. ⚠ The stop is NOT added to `filedHere`, so it stays outstanding and pressing again
        // retries the SAME place on the carrier's paper rather than skipping it.
        rateLimited.value = code === "too_many_requests";
        error.value = e instanceof Error ? e.message : "That did not go through.";
      }
    } finally {
      working.value = false;
    }
  }

  return {
    /**
     * ⚠ **A spread, not fourteen aliases**, and that is the point of Q-PKT11's split rather than a
     * shortcut: the adoption half's surface passes through EXACTLY as it was, so the component and
     * its suite cannot tell the marks moved to another file. Re-listing each member here would be a
     * second declaration of the same surface, free to drift from it by one name.
     */
    ...adoption,
    currentShowsDrawing,
    currentMarkCarriedOver,
    state,
    current,
    total,
    position,
    complete,
    collected,
    signedHere,
    filed: computed(() => filed.value),
    working: computed(() => working.value),
    error: computed(() => error.value),
    rateLimited: computed(() => rateLimited.value),
    sign,
  };
}
