import { computed, ref, type Ref } from "vue";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose } from "@fuelguard/shared";
import { signRelease, type ApplyRelease } from "@/features/apply/useApplication";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";

/**
 * The ceremony (A5, D-APP7).
 *
 * ── WHY THE SIGNATURE IS ADOPTED ONCE AND AFFIRMED FOUR TIMES ─────────────────────────────────
 * ESIGN's intent-to-sign attaches to *a record*. One "sign all" control across four separate
 * FCRA-governed instruments is exactly the omnibus consent §604(b)(2) forbids on paper, expressed in
 * a database — and courts read that section's "solely" literally. So each instrument gets its own
 * screen, its own served text, its own intent sentence and its own control.
 *
 * "Easy and fast", which is what the owner asked for, is delivered by the ADOPTION being once: the
 * driver types their name a single time and then each instrument is one tap. It is not delivered by
 * collapsing four documents into one act, because that is the one thing the regulation forbids.
 *
 * ── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────────────────────────
 * Skip. There is no way to reach instrument three without instrument two having landed, because the
 * index only advances on a 201 — a UI that let somebody jump would produce a half-signed set that
 * looked complete.
 *
 * ── AND THE ONE THING IT REFUSES TO LET FAIL (A8b) ────────────────────────────────────────────
 * The drawn mark. It is staged once, at adoption, into A8a's `signature_mark` slot — and if that
 * upload fails, adoption still succeeds and the ceremony carries on. D-APP8 makes the mark
 * decoration: the signature of record is the typed name stored beside the exact disclosure text, and
 * a driver blocked from signing four federally-required authorizations because a PNG would not
 * upload would be a product that had confused the ornament for the thing.
 */

export type CeremonyState = "adopting" | "signing" | "done" | "unavailable";

export function useSigningCeremony(
  token: Ref<string>,
  releases: Ref<ApplyRelease[]>,
  alreadySigned: Ref<AuthorizationPurpose[]>,
  options: { stage?: typeof stageCapture; io?: CaptureIo } = {},
) {
  const adoptedName = ref("");
  const adopted = ref(false);
  /** The drawn mark, if the driver gave one. Null is the normal case and always will be. */
  const markBlob = ref<Blob | null>(null);
  const stage = options.stage ?? stageCapture;
  const index = ref(0);
  const working = ref(false);
  const error = ref<string | null>(null);
  const carrierProblem = ref(false);

  /** In `APPLICATION_RELEASE_ORDER`, and only the ones this link has not already collected. */
  const outstanding = computed(() =>
    APPLICATION_RELEASE_ORDER.map((purpose) => releases.value.find((r) => r.purpose === purpose))
      .filter((r): r is ApplyRelease => Boolean(r))
      .filter((r) => !alreadySigned.value.includes(r.purpose)),
  );

  const current = computed<ApplyRelease | null>(() => outstanding.value[index.value] ?? null);
  const total = computed(() => outstanding.value.length);
  const position = computed(() => index.value + 1);
  const complete = computed(() => index.value >= outstanding.value.length);

  /**
   * The typed name is the signature of record (D-APP8). §390.32(c)(2) accepts "any available
   * technology"; what carries legal weight is the tuple already stored — the intent statement, the
   * exact text, the version, the timestamp, the IP and the user agent. A drawn mark adds no legal
   * weight and adds a failure mode (a driver on a cracked screen who cannot produce one), so it is
   * never required.
   *
   * ⚠ The mark is awaited rather than fired and forgotten, and the failure is swallowed rather than
   * surfaced. Awaited, because the submit transaction promotes whatever is staged AT THAT MOMENT and
   * a driver who signs four instruments quickly could otherwise certify an application whose mark had
   * not landed. Swallowed, because it is decoration: a PNG that would not upload must not stand
   * between a driver and four federally-required signatures.
   */
  async function adopt(): Promise<boolean> {
    if (adoptedName.value.trim().length < 2) return false;
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

  async function sign(): Promise<void> {
    const release = current.value;
    if (!release || working.value) return;
    working.value = true;
    error.value = null;
    carrierProblem.value = false;
    try {
      await signRelease(token.value, release.purpose, adoptedName.value.trim());
      // Only ever on a 201: the next instrument is unreachable until this one is filed.
      index.value += 1;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "release_already_signed") {
        // A double-tap, or the same link open twice. The signature exists — move on rather than
        // telling the driver off for something the server handled correctly.
        index.value += 1;
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
    adoptedName,
    markBlob,
    adopted: computed(() => adopted.value),
    current,
    total,
    position,
    complete,
    working: computed(() => working.value),
    error: computed(() => error.value),
    carrierProblem: computed(() => carrierProblem.value),
    adopt,
    sign,
  };
}
