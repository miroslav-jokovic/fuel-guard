import { computed, ref, type Ref } from "vue";
import type { PacketMarkKind } from "@silvicom/shared";
import { applyPacketMark, type ApplyPacketStop } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";

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
 * ⚠ **"One mark" is TWO marks, and that was a defect here until 2026-09-14 (Q-PKT8).** `p05`, `p06`
 * and `p09` ask for initials, and D-PKT6 has always been explicit that initials are *"a SECOND
 * adopted mark and not an abbreviation of the first… a ceremony that derived them from the typed name
 * would be inventing a mark the signer never made"*. This file sent the full name to all twenty-two
 * stops — onto the three narrowest lines in the packet, at 89–141pt — and the server would have
 * refused a client that got it right, because `record_packet_mark` pinned one name per link until
 * migration 0340 made the pin per kind. The initials are typed, like the name; they are not derived
 * from it anywhere, and there is no keystroke in this file that turns one into the other.
 *
 * ── WHY THIS IS NOT `useSigningCeremony` WITH A DIFFERENT LIST ────────────────────────────────
 * That one walks four INSTRUMENTS, each its own document with its own served text and its own
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

/** How the driver chose to make their mark (D-PKT13). Decided once, before the first stop. */
export type AdoptedMarkStyle = "typed" | "drawn";

export function usePacketCeremony(
  token: Ref<string>,
  stops: Ref<ApplyPacketStop[]>,
  options: {
    stage?: typeof stageCapture;
    io?: CaptureIo;
    /**
     * What this link has already adopted, served by `GET /:token` (Q-PKT9).
     *
     * ⚠ **A resumed walk must not ask for these again.** `record_packet_mark` pinned them at the
     * first stop, so a second spelling is refused at the next one with advice the driver cannot act
     * on. Given them, the adoption screen shows the mark rather than an empty field.
     */
    adopted?: Ref<{ signature: string | null; initials: string | null } | null | undefined>;
  } = {},
) {
  const adoptedName = ref(options.adopted?.value?.signature ?? "");
  /**
   * The second adopted mark (D-PKT6, Q-PKT8). Typed, always — never derived from `adoptedName`.
   *
   * ⚠ Typed even when the driver DRAWS their signature, and for the same reason the name is: the
   * drawn blob is a staged decoration and `signed_name` is the record on every row (D-APP8), so what
   * the overlay puts on `p05` is this string. A second drawing pad would collect an image nothing
   * reads.
   */
  const adoptedInitials = ref(options.adopted?.value?.initials ?? "");
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
  const stage = options.stage ?? stageCapture;
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
   * them evidence: what the server served as pinned (`options.adopted`), any stop it served as
   * already collected, and anything this walk has filed. That is the same principle 0340's header
   * gives for reading the pin off the marks rather than off a summary of them — a summary can drift
   * from the rows, and here the cost of drifting is offering the driver a correction the server will
   * refuse, or withholding one it would have taken.
   */
  const pinnedKinds = computed<ReadonlySet<PacketMarkKind>>(() => {
    const pinned = new Set<PacketMarkKind>();
    const served = options.adopted?.value;
    if (served?.signature?.trim()) pinned.add("signature");
    if (served?.initials?.trim()) pinned.add("initials");
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
   * ⚠ **`confirming` sits between adopting and signing, and it is A4** — the step at which the
   * driver sees what they typed, in the face it will be printed in, before any of it is fixed.
   *
   * A resumed link SKIPS it: `alreadyAdopted` means the server pinned both marks on a previous
   * visit, so there is nothing on that screen the driver could change and showing it would be
   * offering a decision that has already been made.
   */
  const state = computed<PacketCeremonyState>(() =>
    complete.value ? "done" : confirmed.value ? "signing" : adopted.value ? "confirming" : "adopting",
  );

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
    const pinned = options.adopted?.value;
    if (!pinned) return false;
    return (
      Boolean(pinned.signature?.trim())
      && (!needsInitials.value || Boolean(pinned.initials?.trim()))
    );
  });

  /** The stops already collected, for a resumed session to show as done rather than hide. */
  const collected = computed(() => stops.value.filter((s) => Boolean(s.signedAt)));

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
        await stage(token.value, "signature_mark", blob, "image/png", options.io);
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
   */
  const currentShowsDrawing = computed(
    () =>
      style.value === "drawn"
      && !drawnMarkFailed.value
      && markBlob.value !== null
      && current.value?.mark === "signature",
  );

  /** Apply the adopted mark at the stop the driver is standing on. */
  async function sign(): Promise<void> {
    const stop = current.value;
    if (!stop || working.value) return;
    working.value = true;
    error.value = null;
    rateLimited.value = false;
    try {
      const result = await applyPacketMark(token.value, stop.id, markFor(stop));
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
    adoptedName,
    adoptedInitials,
    needsInitials,
    alreadyAdopted,
    markFor,
    style,
    markBlob,
    currentShowsDrawing,
    pinnedKinds,
    canChange,
    placesWithMark,
    confirm,
    reopen,
    confirmed: computed(() => confirmed.value),
    drawnMarkFailed: computed(() => drawnMarkFailed.value),
    adopted: computed(() => adopted.value),
    state,
    current,
    total,
    position,
    complete,
    collected,
    filed: computed(() => filed.value),
    working: computed(() => working.value),
    error: computed(() => error.value),
    rateLimited: computed(() => rateLimited.value),
    adopt,
    sign,
  };
}
