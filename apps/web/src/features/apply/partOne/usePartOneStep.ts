import { computed, ref, type Ref } from "vue";
import type { useApplyInvitationQuery, ApplyInvitation } from "@/features/apply/useApplication";
import type { PartOneInputs } from "./usePartOne";

/**
 * Is Part 1 the screen this link is on, and what does it need? — the page's half of Part 1 (C3a), the
 * way `useEsignConsentStep` is the consent's. `ApplyPage.vue` reads the answers; `ApplyPhaseRouter.vue`
 * places the screen, after the consent and before the permissions.
 *
 * ── WHICH LINKS WALK IT ───────────────────────────────────────────────────────────────────────
 * A v2 link — one the server serves a `partOne` for, which is every link created since C3a (plan §7:
 * the row is minted with the invitation). A legacy link gets `null`, and an API from before C3a sends
 * nothing; both keep the identity screen they always had, so the eight links already in production
 * walk exactly what they walked before.
 */
export function usePartOneStep(
  invitation: ReturnType<typeof useApplyInvitationQuery>,
  consentNeeded: Ref<boolean>,
) {
  /** Finished in this tab — the refetch that would say so is in flight. */
  const finished = ref(false);
  const partOne = computed(() => invitation.data.value?.partOne ?? null);
  const isPartOneLink = computed(() => partOne.value !== null);

  const partOneNeeded = computed(
    () => isPartOneLink.value && !partOne.value!.completedAt && !finished.value && !consentNeeded.value,
  );

  const toInputs = (data: ApplyInvitation): PartOneInputs | null =>
    data.partOne
      ? {
          status: data.partOne,
          identityComplete: Boolean(data.identityComplete),
          captures: data.captures ?? [],
          summary: data.fcraSummary ?? null,
        }
      : null;

  const partOneInputs = computed(() => (invitation.data.value ? toInputs(invitation.data.value) : null));

  /** The bundle again — a photograph is recorded there, not in the walk. */
  async function refreshPartOne(): Promise<PartOneInputs | null> {
    const result = await invitation.refetch();
    return result.data ? toInputs(result.data) : null;
  }

  function partOneFinished(): void {
    finished.value = true;
    void invitation.refetch();
  }

  return { isPartOneLink, partOneNeeded, partOneInputs, refreshPartOne, partOneFinished };
}
