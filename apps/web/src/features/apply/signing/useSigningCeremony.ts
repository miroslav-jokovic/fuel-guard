import { computed, ref, type Ref } from "vue";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose } from "@fuelguard/shared";
import { signRelease, type ApplyRelease } from "@/features/apply/useApplication";

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
 */

export type CeremonyState = "adopting" | "signing" | "done" | "unavailable";

export function useSigningCeremony(
  token: Ref<string>,
  releases: Ref<ApplyRelease[]>,
  alreadySigned: Ref<AuthorizationPurpose[]>,
) {
  const adoptedName = ref("");
  const adopted = ref(false);
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
   * never required — and it is not collected here at all until A8 gives it somewhere to be stored.
   */
  function adopt(): boolean {
    if (adoptedName.value.trim().length < 2) return false;
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
