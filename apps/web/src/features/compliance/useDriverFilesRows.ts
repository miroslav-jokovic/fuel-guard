import { computed } from "vue";
import { FILE_FILTER_LABELS, fileChip, matchesFileFilter, type FileFilterKind } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";

/**
 * The rows of "Driver files", out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`.
 *
 * They count DRIVERS, asked of the File chip (`matchesFileFilter` over `fileChip`) — the Drivers page's
 * own predicate — because each door lists drivers (D-FM7); the long form is on the card.
 */
export function useDriverFilesRows() {
  const { data: overview } = useComplianceOverviewQuery();
  const drivers = computed(() => overview.value?.drivers ?? null);

  const count = (f: FileFilterKind) => (drivers.value ? drivers.value.filter((d) => matchesFileFilter(fileChip(d), f)).length : null);
  const row = (f: FileFilterKind, caption: string, alarm = false): CountRow => ({
    key: f,
    label: FILE_FILTER_LABELS[f],
    value: count(f),
    caption,
    to: `/drivers?file=${f}`,
    door: "Drivers",
    alarm,
  });

  const rows = computed<CountRow[]>(() => [
    row("expired", "drivers with something lapsed", true),
    row("expiring", "drivers with something due soon, nothing lapsed"),
    row("not_started", "drivers whose file is empty"),
  ]);
  const complete = computed(() => count("complete"));
  return { drivers, complete, rows };
}
