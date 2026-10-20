<script setup lang="ts">
import { computed } from "vue";
import { fileChip, unitFileChip, type FileChip } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useDriversQuery } from "@/composables/useDrivers";
import { useTrailersOnLoadsQuery } from "@/composables/useTrailerLink";
import { useComplianceOverviewQuery, useUnitFilesQuery } from "@/composables/useCompliance";
import GatedLink from "@/components/GatedLink.vue";
import { BADGE_BASE, fileChipTone, toneClass } from "@/lib/badges";
import type { FileSubject } from "./fileSubject";

/**
 * Who this unit is working with, and how their files stand (UNIT-FILES-PLAN D-UF2): a truck shows its
 * seated driver and the trailer on its current load; a trailer shows the truck on its load and the
 * truck the GPS last paired it with. Each is READ from where the fact already lives — the roster's
 * `assigned_driver_id`, McLeod's load (D-TL1), the GPS pairing — and nothing copies a paper from one
 * subject to another. Each name links to the other file, where its own page opens for this reader.
 *
 * The chips are the same words the lists say: `fileChip` on the driver's rollup row, `unitFileChip`
 * on the unit's. A driver's state needs the roster rollup, which an equipment-only reader is refused;
 * for them the strip shows the name and no chip rather than sending a request to be refused.
 */
const props = defineProps<{ subject: FileSubject }>();

const session = useSessionStore();
const vehicles = useVehiclesQuery();
const trailers = useTrailersQuery();
const drivers = useDriversQuery();
const onLoads = useTrailersOnLoadsQuery();
const canReadDrivers = computed(() => session.canView("roster"));
const overview = useComplianceOverviewQuery(canReadDrivers);
// The OTHER kind's files, for the chip beside the related unit. The subject's type is fixed for the
// life of the page that mounts this strip, so the key is read once.
const otherFiles = useUnitFilesQuery(props.subject.type === "tractor" ? "trailer" : "tractor");
const otherFileById = computed(() => new Map((otherFiles.data.value?.units ?? []).map((u) => [u.subject_id, u])));

interface Relation {
  label: string;
  name: string | null;
  to: string | null;
  chip: FileChip | null;
  /** What an empty relation says — "No driver seated". */
  empty: string;
}

const unitChip = (unitId: string | null | undefined): FileChip | null => {
  const row = unitId ? otherFileById.value.get(unitId) : undefined;
  return row ? unitFileChip(row) : null;
};

const relations = computed<Relation[]>(() => {
  if (props.subject.type === "tractor") {
    const truck = (vehicles.data.value ?? []).find((v) => v.id === props.subject.id);
    const driver = truck?.assigned_driver_id ? (drivers.data.value ?? []).find((d) => d.id === truck.assigned_driver_id) : undefined;
    const driverRow = driver ? (overview.data.value?.drivers ?? []).find((d) => d.driver_id === driver.id) : undefined;
    const onLoad = (onLoads.data.value ?? []).find((t) => t.vehicleId === props.subject.id);
    const trailer = onLoad ? (trailers.data.value ?? []).find((t) => t.id === onLoad.trailerId) : undefined;
    return [
      {
        label: "Driver",
        name: driver?.full_name ?? null,
        to: driver ? `/drivers/${driver.id}?section=qualification` : null,
        chip: driverRow ? fileChip({ state: driverRow.state, counts: driverRow.counts }) : null,
        empty: "No driver seated",
      },
      {
        label: "Trailer on load",
        name: trailer ? `Trailer ${trailer.unit_number}` : null,
        to: trailer ? `/trailers/${trailer.id}?section=file` : null,
        chip: unitChip(trailer?.id),
        empty: "No trailer on a load",
      },
    ];
  }
  const trailer = (trailers.data.value ?? []).find((t) => t.id === props.subject.id);
  const onLoad = onLoads.byTrailerId.value.get(props.subject.id);
  const loadTruck = onLoad ? (vehicles.data.value ?? []).find((v) => v.id === onLoad.vehicleId) : undefined;
  const gpsTruck = trailer?.assigned_vehicle_id ? (vehicles.data.value ?? []).find((v) => v.id === trailer.assigned_vehicle_id) : undefined;
  // Two sources, two lines (TRAILER-LINK-PLAN D-TL1): they disagree often, so neither stands in for the other.
  return [
    {
      label: "Truck on load",
      name: loadTruck ? `Unit ${loadTruck.unit_number}` : null,
      to: loadTruck ? `/vehicles/${loadTruck.id}?section=file` : null,
      chip: unitChip(loadTruck?.id),
      empty: "Not on a load",
    },
    {
      label: "GPS pairing",
      name: gpsTruck ? `Unit ${gpsTruck.unit_number}` : null,
      to: gpsTruck ? `/vehicles/${gpsTruck.id}?section=file` : null,
      chip: unitChip(gpsTruck?.id),
      empty: "No GPS pairing",
    },
  ];
});
</script>

<template>
  <ul class="flex flex-wrap gap-x-6 gap-y-2 text-sm" data-test="unit-relations">
    <li v-for="r in relations" :key="r.label" class="inline-flex items-center gap-2">
      <span class="text-ink-muted">{{ r.label }}</span>
      <template v-if="r.name && r.to">
        <GatedLink :to="r.to" class="font-medium text-link hover:text-link-hover" plain-class="font-medium text-ink">{{ r.name }}</GatedLink>
        <span v-if="r.chip" :class="[BADGE_BASE, toneClass(fileChipTone(r.chip.kind))]">{{ r.chip.label }}</span>
      </template>
      <span v-else class="text-ink-tertiary">{{ r.empty }}</span>
    </li>
  </ul>
</template>
