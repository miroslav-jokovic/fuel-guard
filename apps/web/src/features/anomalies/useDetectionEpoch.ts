import { computed, type Ref } from "vue";
import { detectionEpochOrFilter } from "@silvicom/shared";
import { useOrgSettingsQuery } from "@/composables/useOrgSettings";

/**
 * The org's fill-detection start date (0439, D-CF9), for every browser list of cases: the Alerts page
 * and the driver and vehicle pages. The rule itself is `packages/shared/src/detectionEpoch.ts`; this
 * only reads the date and applies it, so the three lists cannot drift apart.
 *
 * `ready` is false until the org row answers. A list waits for it rather than first showing the cases
 * the reset closed and then removing them.
 *
 * `failed` is the org row's read having failed with nothing to show for it, and it does NOT make the
 * gate `ready` (small-screens audit, 2026-11-15). It used to: a failed org read opened the gate with
 * no date, so the list was only then asked for — and with every read failing, that was two chains of
 * three retries end to end, fourteen seconds of skeleton on Fuel alerts where every other page says
 * "Could not load … Retry" after seven. When the org read alone failed it was worse than slow: the
 * list answered without the date and showed, as the queue, the cases the reset had closed. A list
 * that cannot know the date has not been read; `epochGated` says so and retries the read that failed.
 */
export function useDetectionEpoch() {
  const org = useOrgSettingsQuery();
  const epoch = computed(() => org.data.value?.detection_epoch ?? null);
  const ready = computed(() => org.data.value !== undefined);
  const failed = computed(() => org.data.value === undefined && org.isError.value);
  return { epoch, ready, failed, isFetching: org.isFetching, retry: (): void => void org.refetch() };
}

type EpochGate = Pick<ReturnType<typeof useDetectionEpoch>, "failed" | "isFetching" | "retry">;
interface GatedRead {
  isPending: Ref<boolean>;
  isError: Ref<boolean>;
  isFetching: Ref<boolean>;
  refetch: () => unknown;
}

/**
 * What a page draws for a list that waits on the detection date: the list's own read and the date's
 * read as ONE read. The date failing is the list failing (it is no longer loading), and Retry asks
 * again for whichever of the two failed — the list's own `refetch` would do nothing while it is
 * still disabled.
 */
export function epochGated(query: GatedRead, gate: EpochGate) {
  return {
    isPending: computed(() => query.isPending.value && !gate.failed.value),
    isError: computed(() => query.isError.value || gate.failed.value),
    isFetching: computed(() => query.isFetching.value || gate.isFetching.value),
    refetch: (): void => {
      if (gate.failed.value) gate.retry();
      else void query.refetch();
    },
  };
}

/** Narrow a PostgREST query of `anomalies` to cases after the reset (or being investigated). */
export function afterReset<Q extends { or(filter: string): Q }>(q: Q, epoch: string | null): Q {
  const filter = detectionEpochOrFilter(epoch);
  return filter ? q.or(filter) : q;
}
