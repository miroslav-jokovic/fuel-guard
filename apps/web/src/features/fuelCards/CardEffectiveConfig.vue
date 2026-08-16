<script setup lang="ts">
/**
 * What the pump will actually enforce for this card.
 *
 * Two rules from the EFS guide drive the whole component, and they interact:
 *   • getCardv2 returns CARD-level records ONLY, even when the source says BOTH (p36). The policy half
 *     arrives from a separate getPolicy call, merged server-side.
 *   • "Card level always trumps policy" (p37).
 *
 * A policy rule that loses is still SHOWN, greyed, labelled "Overridden by card" or "Not applied".
 * Dropping it produces the worst kind of support call — the operator can see the rule in the WEX
 * portal, cannot see it here, and has no way to tell which one is real. The layout is the explanation:
 * the enforced row reads normally, the superseded one sits beneath it in muted text.
 */
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import {
  type EffectiveDisplayRow,
  limitRows,
  promptRows,
  sourceSentence,
  timeRows,
} from "./cardControlModel";
import type { EfsCardDetailResponse } from "./useEfsCards";

const props = defineProps<{
  effective: EfsCardDetailResponse["effective"];
  policyNumber: number | null;
}>();

const columns: DataTableColumn[] = [
  { key: "label", label: "Setting", headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "detail", label: "Applies", headerClass: "min-w-[14rem]", cellClass: "text-ink-secondary" },
  { key: "origin", label: "Source", headerClass: "min-w-[9rem]" },
];

const sections = computed(() => [
  {
    id: "prompts",
    title: "Pump prompts",
    sentence: sourceSentence("Prompts", props.effective.sources.infoSource, props.policyNumber),
    rows: promptRows(props.effective.infos),
    empty: "No prompts on this card. Drivers are not asked for anything at the pump.",
  },
  {
    id: "limits",
    title: "Product limits",
    sentence: sourceSentence("Limits", props.effective.sources.limitSource, props.policyNumber),
    rows: limitRows(props.effective.limits),
    empty: "No product limits. Spending is bounded only by the account.",
  },
  {
    id: "times",
    title: "Time restrictions",
    sentence: sourceSentence("Time restrictions", props.effective.sources.timeSource, props.policyNumber),
    rows: timeRows(props.effective.timeRestrictions),
    empty: "No time restrictions. The card works at any hour.",
  },
]);

const rowClass = (row: EffectiveDisplayRow): string => (row.enforced ? "" : "text-ink-tertiary");
</script>

<template>
  <div class="space-y-6">
    <p v-if="effective.policyError" class="text-sm text-ink-muted">
      Card settings are shown below. The policy could not be read, so policy-level rules are missing:
      {{ effective.policyError }}
    </p>

    <BaseCard v-for="section in sections" :key="section.id" padding="none">
      <div class="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div class="space-y-1">
          <h2 class="text-sm font-medium text-ink">{{ section.title }}</h2>
          <p class="text-sm text-ink-muted">{{ section.sentence }}</p>
        </div>
        <!-- The page supplies the section's ⋮; this component knows the data, not the actions. -->
        <slot name="actions" :section="section.id" />
      </div>
      <DataTable
        :columns="columns"
        :rows="section.rows"
        row-key="key"
        dense
        :row-class="rowClass"
        :empty-text="section.empty"
      >
        <template #cell-origin="{ row }">
          <span :class="[BADGE_BASE, toneClass((row as EffectiveDisplayRow).originTone)]">
            {{ (row as EffectiveDisplayRow).originLabel }}
          </span>
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
