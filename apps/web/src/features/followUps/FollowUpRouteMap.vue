<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { formatDisplayDateTime, offRouteSentence, type OffRouteView } from "@silvicom/shared";
import { AppButton, AppCallout } from "@silvicom/ui";
import { useFollowUpRouteView } from "./useFollowUps";

/**
 * "Show on map" for one Out of route warning (OUT-OF-ROUTE-MAP-ANALYSIS option A, D-ORM1–7; owner ruling
 * 2026-11-27). The sentence says what happened — where the truck left our planned route, how far it went,
 * whether it came back — and the map draws it; on a phone the sentence alone answers (D-ORM3).
 *
 * Asked for on the click, like the video beside it: one Samsara GPS read and up to two HERE routes, so a
 * drawer that is only glanced at costs nothing. The map is loaded only then, too — maplibre is the
 * heaviest thing a drawer could pull in.
 */
const OffRouteMap = defineAsyncComponent(() => import("@/components/maps/OffRouteMap.vue"));

const props = defineProps<{ followUpId: string; warningId: string }>();

const ask = useFollowUpRouteView();
const view = ref<OffRouteView | null>(null);
const failure = ref<string | null>(null);
watch(
  () => props.warningId,
  () => {
    view.value = null;
    failure.value = null;
  },
);

const sentence = computed(() => (view.value ? offRouteSentence(view.value, (iso) => formatDisplayDateTime(iso)) : ""));
const drawable = computed(() => !!view.value && (view.value.path.length > 1 || (view.value.planned?.stops.length ?? 0) > 0));

async function show() {
  failure.value = null;
  try {
    view.value = await ask.mutateAsync({ id: props.followUpId, warningId: props.warningId });
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not draw this on the map.";
  }
}
</script>

<template>
  <div class="space-y-2" data-test="route-map">
    <AppButton v-if="!view" variant="secondary" size="sm" :disabled="ask.isPending.value" @click="show">
      {{ ask.isPending.value ? "Drawing the map…" : "Show on map" }}
    </AppButton>
    <AppCallout v-if="failure" tone="caution" data-test="route-map-failed">{{ failure }}</AppCallout>
    <template v-if="view">
      <p class="text-sm text-ink" data-test="route-sentence">{{ sentence }}</p>
      <p v-if="view.planned?.loadRef" class="text-xs text-ink-tertiary">
        Load {{ view.planned.loadRef }}<template v-if="view.planned.relation === 'to_pickup'"> — on the way to its pickup</template>
        · judged against Samsara's {{ Math.round(view.thresholdMiles) }} miles
      </p>
      <ul v-if="view.notes.length" class="list-disc pl-5 text-xs text-ink-secondary" data-test="route-notes">
        <li v-for="n in view.notes" :key="n">{{ n }}</li>
      </ul>
      <OffRouteMap v-if="drawable" :view="view" :label="sentence" />
    </template>
  </div>
</template>
