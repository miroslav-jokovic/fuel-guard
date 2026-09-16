<script setup lang="ts">
import { computed } from "vue";
import type { LiveMapVehicle } from "@silvicom/shared";
import { BADGE_BASE, vehicleStateTone } from "@/lib/badges";
import { STATE_LABEL, formatAge } from "./liveMapLayer";

/**
 * What one truck is doing right now — the body of both readings of a selection (D-DR5).
 *
 * ── ONE SET OF FACTS, TWO CONTAINERS ─────────────────────────────────────────────────────────────
 * The document form opens a `SlideOver` (`LiveMapVehicleDrawer`); the workspace floats a panel in
 * the bottom-left corner, where comp (7) draws it. The CONTAINER differs because the surfaces do;
 * the facts do not, and copying them would leave two versions of "which speed source is this" to
 * drift apart.
 *
 * ── IT LINKS RATHER THAN RESTATES ────────────────────────────────────────────────────────────────
 * Everything a dispatcher might do next about a truck, a driver or a load already has a page that
 * does it properly. Reproducing any of that here would be a second, thinner copy of a surface that
 * exists, so this answers "what is this one doing right now" and hands off for the rest.
 *
 * ── NO MONEY, AND THAT IS THE LM-F RULING APPLIED ────────────────────────────────────────────────
 * No rate, no cost, no margin. `dispatch` and `accounting` are different sections and a dispatcher
 * holds one of them; a figure hidden behind a component's own `v-if` is a permission decision in the
 * wrong place, so the endpoint does not send them and this cannot leak them.
 *
 * ⚠ There are no Destination / ETA / Next-stop ROWS here, which comp (7) draws and §4.2 of the
 * design-refresh plan rules out on purpose: `loads` holds 0 rows until LM12, and an ETA field that
 * is always blank reads as broken rather than as pending. The load block below appears only when
 * there IS a load, and says what it is waiting for when there is not.
 */
const props = defineProps<{
  vehicle: LiveMapVehicle;
  /** `compact` drops the section rules and tightens the grid, for the floating panel. */
  density?: "comfortable" | "compact";
}>();

const compact = computed(() => props.density === "compact");

const speed = computed(() => {
  const mph = props.vehicle.position.speedMph;
  if (mph == null) return "—";
  // The vendor's own flag, said out loud: an ECU speed comes off the engine and a GPS-derived one is
  // inferred from successive fixes. A dispatcher querying a speeding conversation needs to know which.
  const source = props.vehicle.position.isEcuSpeed === true ? "engine" : "GPS";
  return `${Math.round(mph)} mph (${source})`;
});

const heading = computed(() => {
  const deg = props.vehicle.position.headingDegrees;
  // Null is not north. A bearing-less ping draws a dot rather than an arrow for the same reason.
  return deg == null ? "Not reported" : `${Math.round(deg)}°`;
});
</script>

<template>
  <div :class="compact ? 'space-y-3' : 'space-y-6'">
    <div class="flex items-center gap-2">
      <span :class="[BADGE_BASE, vehicleStateTone(vehicle.state)]">{{ STATE_LABEL[vehicle.state] }}</span>
      <span class="text-xs text-ink-muted">Fix {{ formatAge(vehicle.ageSeconds) }}</span>
    </div>

    <dl class="grid grid-cols-2 gap-x-4 text-sm" :class="compact ? 'gap-y-2' : 'gap-y-3'">
      <div>
        <dt class="text-xs text-ink-muted">Speed</dt>
        <dd class="text-ink">{{ speed }}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Heading</dt>
        <dd class="text-ink">{{ heading }}</dd>
      </div>
      <div class="col-span-2">
        <dt class="text-xs text-ink-muted">Location</dt>
        <!-- The vendor's own reverse-geocoded place name, verbatim. No second geocoder is in the path. -->
        <dd class="text-ink">{{ vehicle.position.formattedLocation ?? "—" }}</dd>
      </div>
    </dl>

    <div class="space-y-2 border-t border-edge" :class="compact ? 'pt-3' : 'pt-4'">
      <p class="text-xs font-semibold text-ink-secondary">Load</p>
      <p v-if="!vehicle.load" class="text-sm text-ink-muted">
        No load on this truck. Loads arrive with the dispatch feed.
      </p>
      <RouterLink v-else :to="`/loads/${vehicle.load.id}`" class="block text-sm text-link hover:text-link-hover">
        {{ vehicle.load.ref ?? "Load" }} · {{ vehicle.load.status }}
      </RouterLink>
      <p v-if="vehicle.load?.nextStop" class="text-xs text-ink-muted">
        Next stop: {{ vehicle.load.nextStop.name ?? vehicle.load.nextStop.kind }}
        <template v-if="vehicle.load.nextStop.city">
          — {{ vehicle.load.nextStop.city
          }}<template v-if="vehicle.load.nextStop.state">, {{ vehicle.load.nextStop.state }}</template>
        </template>
      </p>
    </div>

    <div class="flex gap-4" :class="compact ? 'border-t border-edge pt-3' : 'hidden'">
      <RouterLink :to="`/vehicles/${vehicle.vehicleId}`" class="text-sm text-link hover:text-link-hover">
        Open truck
      </RouterLink>
      <RouterLink
        v-if="vehicle.driver"
        :to="`/drivers/${vehicle.driver.id}`"
        class="text-sm text-link hover:text-link-hover"
      >
        Open driver
      </RouterLink>
    </div>
  </div>
</template>
