import { computed } from "vue";
import { detectionEpochOrFilter } from "@silvicom/shared";
import { useOrgSettingsQuery } from "@/composables/useOrgSettings";

/**
 * The org's fill-detection start date (0439, D-CF9), for every browser list of cases: the Alerts page
 * and the driver and vehicle pages. The rule itself is `packages/shared/src/detectionEpoch.ts`; this
 * only reads the date and applies it, so the three lists cannot drift apart.
 *
 * `ready` is false until the org row answers. A list waits for it rather than first showing the cases
 * the reset closed and then removing them.
 */
export function useDetectionEpoch() {
  const org = useOrgSettingsQuery();
  const epoch = computed(() => org.data.value?.detection_epoch ?? null);
  const ready = computed(() => org.data.value !== undefined || org.isError.value);
  return { epoch, ready };
}

/** Narrow a PostgREST query of `anomalies` to cases after the reset (or being investigated). */
export function afterReset<Q extends { or(filter: string): Q }>(q: Q, epoch: string | null): Q {
  const filter = detectionEpochOrFilter(epoch);
  return filter ? q.or(filter) : q;
}
