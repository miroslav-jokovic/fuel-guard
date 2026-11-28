<script setup lang="ts">
import { computed, toRef } from "vue";
import { formatDisplayDateTime, type TruckFaultCode } from "@silvicom/shared";
import { AppCallout, QueryState } from "@silvicom/ui";
import { useFollowUpTruckCodesQuery } from "./useFollowUps";
import { codeDetail, codeNumbers, codeTitle, lampsSentence, splitCodes } from "./truckCodeRows";

/**
 * Samsara's fault codes on a maintenance follow-up's truck (OUT-OF-ROUTE-MAP-ANALYSIS §7, D-ORM8–10):
 * the codes on the truck now, the cameras' and telematics units' folded beneath (Q-ORM7), and the codes
 * that came and went since the follow-up began. Read when the drawer opens, never stored. When Samsara
 * does not answer, the codes the collector kept with the lamp are shown and say how old they are.
 */
const props = defineProps<{ followUpId: string }>();

const { data, isLoading, isError, error, isFetching, refetch } = useFollowUpTruckCodesQuery(toRef(props, "followUpId"));

const now = computed(() => splitCodes(data.value?.now ?? []));
const cameAndWent = computed(() => (data.value?.source === "samsara" ? data.value.cameAndWent : []));
const lamps = computed(() => (data.value?.source === "samsara" ? lampsSentence(data.value.lamps) : null));
const key = (c: TruckFaultCode) => `${c.module ?? "-"}:${c.spn}:${c.fmi ?? "-"}`;
</script>

<template>
  <section aria-labelledby="fu-codes" class="space-y-3" data-test="truck-codes">
    <h3 id="fu-codes" class="text-sm font-semibold text-ink">Fault codes on this truck</h3>
    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      compact
      loading-text="Asking Samsara for the truck's codes…"
      error-text="Could not read the truck's codes."
      @retry="refetch()"
    >
      <div v-if="data" class="space-y-3">
        <AppCallout v-if="data.source === 'stored'" tone="caution" data-test="codes-stored">
          Samsara did not answer. These are the codes kept when the truck's lamp came on, {{ formatDisplayDateTime(data.asOf) }} — there may be newer ones.
        </AppCallout>
        <p v-else class="text-xs text-ink-tertiary" data-test="codes-as-of">
          <template v-if="data.asOf">Samsara's latest reading: {{ formatDisplayDateTime(data.asOf) }}.</template>
          <template v-else>Samsara has no fault-code reading for this truck.</template>
          <template v-if="lamps"> {{ lamps }}</template>
        </p>

        <ul v-if="now.vehicle.length" class="space-y-2" aria-label="Codes on the truck now">
          <li v-for="c in now.vehicle" :key="key(c)" class="rounded-detail ring-1 ring-edge p-3 space-y-0.5">
            <p class="text-sm font-medium text-ink">{{ codeTitle(c) }}</p>
            <p class="text-xs text-ink-secondary"><span class="font-mono">{{ codeNumbers(c) }}</span><template v-if="codeDetail(c)"> · {{ codeDetail(c) }}</template></p>
          </li>
        </ul>
        <p v-else-if="data.asOf || data.source === 'stored'" class="text-sm text-ink-muted">No codes from the truck's own systems now.</p>

        <details v-if="now.electronics.length" class="rounded-detail bg-surface-muted p-3 text-sm" data-test="codes-electronics">
          <summary class="cursor-pointer text-ink">Cameras, radar and telematics: {{ now.electronics.length }} {{ now.electronics.length === 1 ? "code" : "codes" }}</summary>
          <ul class="mt-2 space-y-2">
            <li v-for="c in now.electronics" :key="key(c)" class="space-y-0.5">
              <p class="text-ink">{{ codeTitle(c) }}</p>
              <p class="text-xs text-ink-secondary"><span class="font-mono">{{ codeNumbers(c) }}</span><template v-if="codeDetail(c)"> · {{ codeDetail(c) }}</template></p>
            </li>
          </ul>
        </details>

        <div v-if="data.source === 'samsara'" class="space-y-2" data-test="codes-came-and-went">
          <h4 class="text-xs font-semibold text-ink-secondary">
            Came and went since {{ formatDisplayDateTime(data.since) }}<template v-if="data.sinceCapped"> (Samsara's history is read 30 days back at most)</template>
          </h4>
          <ul v-if="cameAndWent.length" class="space-y-2">
            <li v-for="c in cameAndWent" :key="key(c)" class="text-sm space-y-0.5">
              <p class="text-ink">{{ codeTitle(c) }}</p>
              <p class="text-xs text-ink-secondary">
                <span class="font-mono">{{ codeNumbers(c) }}</span><template v-if="c.moduleName"> · {{ c.moduleName }}</template>
                · seen {{ formatDisplayDateTime(c.firstSeen) }}<template v-if="c.lastSeen !== c.firstSeen"> – {{ formatDisplayDateTime(c.lastSeen) }}</template>
              </p>
            </li>
          </ul>
          <p v-else class="text-sm text-ink-muted">None.</p>
        </div>
      </div>
    </QueryState>
  </section>
</template>
