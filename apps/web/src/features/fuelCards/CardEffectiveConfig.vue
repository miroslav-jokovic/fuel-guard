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
import { AppButton as BaseButton } from "@fuelguard/ui";
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
  /** Absent on a card nobody may change, which is how the Edit link stays off that page. */
  cardId?: string;
  canEditPrompts?: boolean;
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
    /**
     * Step 6.3. Section-level, not per row, and that is the shape of the operation rather than a
     * shortcut: `prompts_set` is a full `replaceAll` over the card's records, so "edit this one row"
     * would name a granularity the write does not have. Prompts only — a limit or a time
     * restriction has no capability behind it yet, and a policy-level row is not editable here at
     * all (card level always trumps policy, guide p37, but the policy is changed in the WEX portal).
     */
    editAction: props.canEditPrompts && props.cardId ? `/fuel-cards/${props.cardId}?action=prompts` : null,
  },
  {
    id: "limits",
    title: "Product limits",
    sentence: sourceSentence("Limits", props.effective.sources.limitSource, props.policyNumber),
    rows: limitRows(props.effective.limits),
    empty: "No product limits. Spending is bounded only by the account.",
    editAction: null,
  },
  {
    id: "times",
    title: "Time restrictions",
    sentence: sourceSentence("Time restrictions", props.effective.sources.timeSource, props.policyNumber),
    rows: timeRows(props.effective.timeRestrictions),
    empty: "No time restrictions. The card works at any hour.",
    editAction: null,
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
        <BaseButton v-if="section.editAction" variant="soft" size="sm" :to="section.editAction">
          Edit…
        </BaseButton>
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
