<script setup lang="ts">
import type { LiveMapVehicle } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import LiveMapVehicleFacts from "./LiveMapVehicleFacts.vue";

/**
 * One truck, opened from its marker or its row (LIVE-MAP-PLAN.md LM8: "click → the load, the truck,
 * the driver").
 *
 * ── THE DRAWER IS THE CONTAINER; THE FACTS ARE NOT ITS (D-DR5) ───────────────────────────────────
 * Everything below the title now lives in `LiveMapVehicleFacts`, because DR5's workspace floats the
 * same facts in a bottom-left panel where comp (7) draws them. This file decides only that the
 * DOCUMENT form of the board opens a `SlideOver` and puts its two hand-offs in the footer, which is
 * the one thing the floating panel does differently.
 *
 * ── IT LINKS RATHER THAN RESTATES ────────────────────────────────────────────────────────────────
 * Everything a dispatcher might do next about a truck, a driver or a load already has a page that
 * does it properly. Reproducing any of that here would be a second, thinner copy of a surface that
 * exists — the shape this repo's register calls a workaround — so the drawer answers "what is this
 * one doing right now" and hands off for the rest.
 *
 * ── NO MONEY, AND THAT IS THE LM-F RULING APPLIED ────────────────────────────────────────────────
 * No rate, no cost, no margin. `dispatch` and `accounting` are different sections and a dispatcher
 * holds one of them; a figure hidden behind a component's own `v-if` is a permission decision in the
 * wrong place, so the endpoint does not send them and this cannot leak them.
 */
defineProps<{ vehicle: LiveMapVehicle | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <SlideOver
    :open="vehicle !== null"
    :title="vehicle ? `Unit ${vehicle.unitNumber}` : ''"
    :description="vehicle?.driver?.name ?? 'No driver assigned'"
    @close="emit('close')"
  >
    <LiveMapVehicleFacts v-if="vehicle" :vehicle="vehicle" />

    <template #footer>
      <RouterLink
        v-if="vehicle"
        :to="`/vehicles/${vehicle.vehicleId}`"
        class="text-sm text-link hover:text-link-hover"
      >
        Open truck
      </RouterLink>
      <RouterLink
        v-if="vehicle?.driver"
        :to="`/drivers/${vehicle.driver.id}`"
        class="text-sm text-link hover:text-link-hover"
      >
        Open driver
      </RouterLink>
    </template>
  </SlideOver>
</template>
