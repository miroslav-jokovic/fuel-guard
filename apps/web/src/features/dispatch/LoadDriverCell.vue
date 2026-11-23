<script setup lang="ts">
import { computed } from "vue";
import type { HomeTimePeriod } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import HomeTimeBadge from "@/components/homeTime/HomeTimeBadge.vue";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * The Loads list's Driver cell: who drives it, the team's second seat, the truck and trailer — and,
 * since HOME-TIME-VISIBILITY-PLAN D-HT24, each seat that is on home time. A load assigned to a driver
 * who is home is a planning mistake worth seeing on the list, not after he fails to pick it up. Out of
 * `DispatchLoadsPage.vue`, which stood at 499 of its 500 lines.
 */
const props = defineProps<{
  row: Pick<DispatchLoad, "driver_id" | "driver_name" | "co_driver_id" | "co_driver_name" | "vehicle_unit" | "trailer_unit">;
  /** Each driver's live home time, for a reader who may read it; absent for anybody else. */
  homeTimes?: ReadonlyMap<string, HomeTimePeriod>;
  zone: string;
}>();

const homes = computed(() =>
  [props.row.driver_id, props.row.co_driver_id !== props.row.driver_id ? props.row.co_driver_id : null]
    .map((id) => (id ? (props.homeTimes?.get(id) ?? null) : null))
    .filter((p): p is HomeTimePeriod => p !== null),
);
</script>

<template>
  <p :class="row.driver_name ? 'text-ink' : 'text-ink-tertiary'">{{ row.driver_name ?? "No driver" }}</p>
  <!-- D-LA2: a team's second seat, as McLeod names it. -->
  <p v-if="row.co_driver_name" class="text-xs text-ink-secondary" title="Team driver">+ {{ row.co_driver_name }}</p>
  <p v-for="h in homes" :key="h.id" class="mt-0.5"><HomeTimeBadge :period="h" :zone="zone" /></p>
  <p class="text-xs tabular-nums text-ink-muted" title="Truck / trailer">
    <!-- D-DB6 point 4: the truck opens on the Dispatch board, its drawer open; HOS and GPS live there. -->
    <BaseButton
      v-if="row.vehicle_unit"
      variant="link"
      :to="{ name: 'assignments', query: { truck: row.vehicle_unit } }"
      @click.stop
    >{{ row.vehicle_unit }}</BaseButton><template v-else>No truck</template> / {{ row.trailer_unit ?? "no trailer" }}
  </p>
</template>
