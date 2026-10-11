<script setup lang="ts">
import { toRef } from "vue";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "./AnomalyDetail.vue";
import IncidentDetail from "./IncidentDetail.vue";
import { useAnomalyById } from "./useAnomalies";

/**
 * The two case drawers of Fuel problems (8c3), out of the page at 8c4 for its file budget: a fill case
 * opens the Alerts drawer, a card-fraud incident its own, each with its own close (D-FUI7). Before 8c3 a
 * fill case handed the reader to `/anomalies`, a page a dispatcher may not open, so the click did nothing
 * for them; a row is only listed to someone who may see it, so its drawer opens here.
 *
 * Which one is open is the page's (it is in the URL); this only renders it and says when to close.
 */
const props = defineProps<{
  caseId: string | null;
  incidentId: string | null;
  /** The unit of a listed row, which the fill-case drawer shows and the case row does not carry. */
  unitOf: (id: string | null) => string;
}>();
const emit = defineEmits<{ close: [] }>();

const { data: openCase } = useAnomalyById(toRef(props, "caseId"));
</script>

<template>
  <!-- A case or incident moved in its drawer; each drawer's mutation refreshes the queue (`["findings"]`). -->
  <SlideOver :open="!!caseId" title="Possible theft" @close="emit('close')">
    <AnomalyDetail v-if="openCase" :anomaly="openCase" :vehicle-unit="unitOf(caseId)" @changed="emit('close')" />
  </SlideOver>
  <SlideOver :open="!!incidentId" title="Card used away from its truck" @close="emit('close')">
    <IncidentDetail v-if="incidentId" :id="incidentId" @changed="emit('close')" />
  </SlideOver>
</template>
