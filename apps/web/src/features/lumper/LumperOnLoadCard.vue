<script setup lang="ts">
import { computed, toRef } from "vue";
import { LUMPER_CASE_STATE_LABELS } from "@silvicom/shared";
import { AppBadge, AppCard as BaseCard } from "@silvicom/ui";
import { useOpens } from "@/composables/useOpens";
import { LUMPER_STATE_TONE, lumperAmount } from "./lumperRows";
import { useLumperCaseForOrder } from "./useLumperCases";

/**
 * The lumper case on the load page (LUMPER-REVISED-RC-PLAN LRC3): when we paid a lumper on this McLeod
 * order, the load says so — what was paid, whether the revised RC is on file, the case's status — and
 * opens the case on Lumper fees, where it is worked. Nothing is filed or closed from here: one place to
 * act on a case.
 *
 * Drawn only for a McLeod load (its `ref` IS the McLeod order number, the case's key) and only for
 * somebody who can open Lumper fees (`useOpens`, the guard's own answer). For anybody else, or a load
 * with no lumper, it draws nothing — no empty card on the 95% of loads without one.
 */
const props = defineProps<{ orderId: string; fromMcleod: boolean }>();
const opens = useOpens();
const enabled = computed(() => props.fromMcleod && opens("/lumper-fees"));
const { lumperCase } = useLumperCaseForOrder(toRef(props, "orderId"), enabled);
const link = computed(() => (lumperCase.value ? `/lumper-fees?show=all&case=${encodeURIComponent(lumperCase.value.id)}` : "/lumper-fees"));
</script>

<template>
  <BaseCard v-if="enabled && lumperCase" data-testid="lumper-on-load">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h2 class="text-sm font-semibold text-ink">Lumper</h2>
        <p class="text-sm text-ink-secondary">
          {{ lumperAmount(lumperCase).text }}{{ lumperAmount(lumperCase).note ? " keyed" : " paid" }} ·
          revised RC {{ lumperCase.rcOnFile ? "on file" : "missing" }}
        </p>
      </div>
      <AppBadge :tone="LUMPER_STATE_TONE[lumperCase.state]">{{ LUMPER_CASE_STATE_LABELS[lumperCase.state] }}</AppBadge>
    </div>
    <RouterLink :to="link" class="mt-3 inline-block text-sm font-medium text-link hover:text-link-hover">Open the case on Lumper fees</RouterLink>
  </BaseCard>
</template>
