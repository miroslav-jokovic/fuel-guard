<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue";
import RouteMapSvg from "./RouteMapSvg.vue";
import { fetchMapConfig, type PlanResult, type PlanStopView } from "./useFuelPlan";

// Interactive HERE tile map is loaded lazily and only when the server reports a key is configured, so the
// maplibre bundle is code-split out for deployments without HERE tiles — which fall back to the SVG preview.
const RouteMapGL = defineAsyncComponent(() => import("./RouteMapGL.vue"));

defineProps<{
  route: NonNullable<PlanResult["route"]>;
  stops: PlanStopView[];
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}>();

const tilesEnabled = ref<boolean | null>(null);
onMounted(async () => {
  try {
    tilesEnabled.value = await fetchMapConfig();
  } catch {
    tilesEnabled.value = false;
  }
});
</script>

<template>
  <RouteMapGL v-if="tilesEnabled" :route="route" :stops="stops" :origin="origin" :destination="destination" />
  <RouteMapSvg v-else :route="route" :stops="stops" :origin="origin" :destination="destination" />
</template>
