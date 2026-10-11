import { computed, ref, type Ref } from "vue";
import {
  APPLICATION_RELEASE_ORDER,
  type AuthorizationPurpose,
  type PacketMarkKind,
  type SignatureAdoptionsView,
} from "@silvicom/shared";
import { signRelease, type ApplyRelease } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";
import { adoptMark } from "@/features/apply/signing/adoptMark";
import { usePacketAdoption, type AdoptionStop } from "@/features/apply/signing/usePacketAdoption";
import type { PacketCeremonyState } from "@/features/apply/signing/usePacketCeremony";

/**
 * The permissions, each its own PDF, signed DocuSign-style (AF6, D-AF2).
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ────────────────────────────────────────────────────────────
 * Until AF6 each permission was a block of text on the screen and a button (`useSigningCeremony`, A5).
 * The owner's words: *"well designed and professional looking PDF documents that have a signing
 * format as DocuSign has"*. So the applicant now adopts a signature in the packet's own adoption
 * screens (Type/Draw/Upload, then a confirm step), reads each permission as the PDF it is, and signs
 * it on the box the document itself marks.
 *
 * ⚠ **What is signed, and how, is unchanged.** Each document is still its own act and its own request,
 * `POST /:token/release`, with the typed name as the signature of record (D-APP8): FCRA §604(b)(2)
 * makes each disclosure its own document, and "sign all" across five would be the omnibus consent it
 * forbids. The picture is staged once, at adoption, into `signature_mark`, which is why the packet
 * later offers it as carried over.
 *
 * ── THE WALK IS FIXED, AND WHAT "SIGNED" MEANS IN IT ──────────────────────────────────────────
 * All six, in `APPLICATION_RELEASE_ORDER`, always: "Document 3 of 6" counts the set, and never
 * renumbers under an applicant whose link refetched (the stranded-cursor lesson from the packet). A
 * document is signed if the server says so (`alreadySigned`) or this session filed it (`filedHere`).
 *
 * ⚠ **Only THIS session's signatures lock the adopted mark.** The link serves WHICH permissions are
 * signed and not WHEN, so a stop here has no `signedAt` to give, and every one carries `null`. Feeding
 * the earlier signatures to the adoption's pin as well would disable the name field for a resumed
 * applicant with nothing in it (nothing pins a name on releases server-side, and the view serves no
 * earlier name), leaving them no way to sign the rest.
 *
 * ── SCREEN 13: ADOPT ONCE (D-AW15, C3s1) ──────────────────────────────────────────────────────
 * The adoption at the head of this walk is the link's adoption now, not a picture staged for the
 * packet to borrow: it takes the initials as well (`initialsWanted`), and it REGISTERS both marks
 * (`adoptMark` → `record_signature_adoption`) where it used to stage the `signature_mark` capture. Each
 * permission is then signed with the live signature adoption, which the server finds itself — the
 * request still carries only the typed name, and the server refuses one that is not the adopted name.
 *
 * ⚠ **What the link adopted pins the marks only once a permission has been signed with it.** The
 * server allows a new adoption until then (`adoption_in_use`), so a driver who adopted and left before
 * signing meets the form again, with their name in it. Once the walk has begun the adopted text is
 * what the server pins, which is the name this file used to have no way to show a resumed applicant.
 */

export interface PermissionStop extends AdoptionStop {
  purpose: AuthorizationPurpose;
  release: ApplyRelease;
}

export function usePermissionCeremony(
  token: Ref<string>,
  releases: Ref<ApplyRelease[]>,
  alreadySigned: Ref<AuthorizationPurpose[]>,
  options: {
    markStaged?: Ref<boolean>;
    /** What the link has adopted, as the bundle serves it (typed text or null per kind). */
    adoptions?: Ref<SignatureAdoptionsView | undefined>;
    stage?: typeof stageCapture;
    io?: CaptureIo;
    sign?: typeof signRelease;
    adopt?: typeof adoptMark;
  } = {},
) {
  const sign = options.sign ?? signRelease;
  const register = options.adopt ?? adoptMark;
  const adopted = computed(() => options.adoptions?.value ?? { signature: null, initials: null });
  const working = ref(false);
  const error = ref<string | null>(null);
  const carrierProblem = ref(false);
  const filedHere = ref(new Set<string>());

  const stops = computed<PermissionStop[]>(() =>
    APPLICATION_RELEASE_ORDER.flatMap((purpose) => {
      const release = releases.value.find((r) => r.purpose === purpose);
      return release ? [{ id: purpose, purpose, mark: "signature" as const, signedAt: null, release }] : [];
    }),
  );
  const isSigned = (stop: PermissionStop): boolean =>
    alreadySigned.value.includes(stop.purpose) || filedHere.value.has(stop.id);
  const outstanding = computed(() => stops.value.filter((s) => !isSigned(s)));
  /** Signed before this visit, for the adoption screen's "you have already signed N". */
  const collected = computed(() => stops.value.filter((s) => alreadySigned.value.includes(s.purpose)));

  /** Pinned only once in use — see the header. `collected` is what the server says is signed. */
  const served = computed(() => (collected.value.length > 0 ? adopted.value : null));

  const adoption = usePacketAdoption({
    token,
    stops,
    filedHere,
    outstanding,
    working,
    served,
    // A picture exists if the link adopted one — or, on a link that signed before C3s1, staged one.
    markStaged: computed(() => Boolean(options.markStaged?.value) || Boolean(adopted.value.signature)),
    initialsStaged: computed(() => Boolean(adopted.value.initials)),
    initialsWanted: computed(() => true),
    sendMark: (kind: PacketMarkKind, blob: Blob) =>
      register(
        token.value,
        kind,
        (kind === "initials" ? adoption.adoptedInitials : adoption.adoptedName).value.trim(),
        blob,
      ),
    stage: options.stage,
    io: options.io,
  });
  // Seeded when nothing pins it, so a driver who adopted and left meets their own name, not an empty box.
  if (!adoption.adoptedName.value) adoption.adoptedName.value = adopted.value.signature ?? "";
  if (!adoption.adoptedInitials.value) adoption.adoptedInitials.value = adopted.value.initials ?? "";

  const current = computed<PermissionStop | null>(() => outstanding.value[0] ?? null);
  const total = computed(() => stops.value.length);
  /** Its place in the fixed set, so the number an applicant is watching never moves under them. */
  const position = computed(() => (current.value ? stops.value.indexOf(current.value) + 1 : total.value));
  const complete = computed(() => outstanding.value.length === 0);

  const state = computed<PacketCeremonyState>(() =>
    complete.value
      ? "done"
      : adoption.confirmed.value
        ? "signing"
        : adoption.adopted.value
          ? "confirming"
          : "adopting",
  );

  /**
   * Sign the document on screen. Only ever advances on a 201, so there is no way to reach document
   * three without two being filed — a half-signed set that looked complete is the failure A5 refused.
   */
  async function signCurrent(): Promise<void> {
    const stop = current.value;
    if (!stop || working.value) return;
    working.value = true;
    error.value = null;
    carrierProblem.value = false;
    try {
      await sign(token.value, stop.purpose, adoption.adoptedName.value.trim());
      filedHere.value = new Set([...filedHere.value, stop.id]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "adoption_name_mismatch") {
        // The name changed and the new adoption did not save. Back to the adoption, to make it again.
        error.value = e instanceof Error ? e.message : "Make your signature again.";
        adoption.reopen();
      } else if (code === "release_already_signed") {
        // A double-tap, or the link open twice. The signature exists — move on.
        filedHere.value = new Set([...filedHere.value, stop.id]);
      } else if (code === "disclosure_not_final") {
        carrierProblem.value = true;
      } else {
        error.value = e instanceof Error ? e.message : "That did not go through.";
      }
    } finally {
      working.value = false;
    }
  }

  return {
    ...adoption,
    /**
     * How many documents carry the signature — the walk's own count, earlier visits included. The
     * adoption's counts this session's stops only, and once an earlier visit's adoption pins the name
     * it would say *"already on 0 documents"* about a signature on three.
     */
    placesWithMark: (kind: PacketMarkKind): number =>
      kind === "signature" ? stops.value.filter(isSigned).length : 0,
    state,
    stops,
    collected,
    current,
    total,
    position,
    complete,
    working: computed(() => working.value),
    error: computed(() => error.value),
    carrierProblem: computed(() => carrierProblem.value),
    signCurrent,
  };
}
