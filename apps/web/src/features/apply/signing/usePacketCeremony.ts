import { computed, ref, type Ref } from "vue";
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
 * Skip, and finish early. The index only advances on a 201, so a stop that did not land cannot be
 * walked past — and `complete` comes from the SERVER's count rather than from this file reaching the
 * end of its own array, because the array is what the client happens to be holding and the count is
 * what the document actually carries.
 */

export type PacketCeremonyState = "adopting" | "signing" | "done";

/** How the driver chose to make their mark (D-PKT13). Decided once, before the first stop. */
export type AdoptedMarkStyle = "typed" | "drawn";

export function usePacketCeremony(
  token: Ref<string>,
  stops: Ref<ApplyPacketStop[]>,
  options: { stage?: typeof stageCapture; io?: CaptureIo } = {},
) {
  const adoptedName = ref("");
  /**
   * The second adopted mark (D-PKT6, Q-PKT8). Typed, always — never derived from `adoptedName`.
   *
   * ⚠ Typed even when the driver DRAWS their signature, and for the same reason the name is: the
   * drawn blob is a staged decoration and `signed_name` is the record on every row (D-APP8), so what
   * the overlay puts on `p05` is this string. A second drawing pad would collect an image nothing
   * reads.
   */
  const adoptedInitials = ref("");
  const style = ref<AdoptedMarkStyle>("typed");
  /** The drawn mark, when the driver chose to draw one. */
  const markBlob = ref<Blob | null>(null);
  const adopted = ref(false);
  const stage = options.stage ?? stageCapture;
  const index = ref(0);
  const working = ref(false);
  const error = ref<string | null>(null);
  /** The server's own count, which is what "signed through" means. */
  const filed = ref(0);
  const finished = ref(false);

  /**
   * ⚠ Everything this link has NOT already collected, in the packet's own page order.
   *
   * Computed once per load rather than re-derived after each mark: a list that re-filtered as the
   * driver went would renumber the stops under them — "3 of 22" becoming "3 of 19" — and the count
   * a driver is watching must not move while they are watching it.
   */
  const outstanding = computed(() => stops.value.filter((s) => !s.signedAt));

  const current = computed<ApplyPacketStop | null>(() => outstanding.value[index.value] ?? null);

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
  const position = computed(() => alreadySigned.value + index.value + 1);
  const complete = computed(() => finished.value || outstanding.value.length === 0);

  const state = computed<PacketCeremonyState>(() =>
    complete.value ? "done" : adopted.value ? "signing" : "adopting",
  );

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
   * ⚠ The drawn mark is awaited and its failure is swallowed — A8b's rule, and the reason is the same
   * one: a PNG that will not upload must not stand between a driver and twenty-two signatures on a
   * document their job depends on. If it fails they have still signed, with their typed name.
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
      } catch {
        /* decoration; see above */
      } finally {
        working.value = false;
      }
    }
    adopted.value = true;
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

  /** Apply the adopted mark at the stop the driver is standing on. */
  async function sign(): Promise<void> {
    const stop = current.value;
    if (!stop || working.value) return;
    working.value = true;
    error.value = null;
    try {
      const result = await applyPacketMark(token.value, stop.id, markFor(stop));
      filed.value = result.signedCount;
      // ⚠ The SERVER decides this, not the end of our array. A resumed link, a second tab or a stop
      // collected elsewhere all mean the client's list is not the document's.
      if (result.complete) finished.value = true;
      index.value += 1;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "packet_mark_already_made") {
        // A double-tap, or the same link open twice. The mark exists — move on rather than telling
        // the driver off for something the server handled correctly.
        index.value += 1;
      } else {
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
    markFor,
    style,
    markBlob,
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
    adopt,
    sign,
  };
}
