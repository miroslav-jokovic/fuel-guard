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
  locationRows,
  payrollRows,
  promptRows,
  sourceSentence,
  timeRows,
} from "./cardControlModel";
import type { EfsLimitOption } from "@fuelguard/shared";
import type { EfsCardDetailResponse } from "./useEfsCards";

const props = defineProps<{
  effective: EfsCardDetailResponse["effective"];
  policyNumber: number | null;
  /**
   * The account's limit vocabulary, so a product limit is rendered in the unit THIS account says it
   * has rather than the one our transcribed table guesses. Required, not optional: a default here
   * would silently restore the guess at whichever call site forgot to pass it.
   */
  limitOptions: readonly EfsLimitOption[];
}>();

const columns: DataTableColumn[] = [
  { key: "label", label: "Setting", width: "xl", cellClass: "font-medium text-ink" },
  { key: "detail", label: "Applies", width: "xl", cellClass: "text-ink-secondary" },
  { key: "origin", label: "Source", width: "lg" },
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
    rows: limitRows(props.effective.limits, props.limitOptions),
    empty: "No product limits. Spending is bounded only by the account.",
  },
  {
    id: "times",
    title: "Time restrictions",
    sentence: sourceSentence("Time restrictions", props.effective.sources.timeSource, props.policyNumber),
    rows: timeRows(props.effective.timeRestrictions),
    empty: "No time restrictions. The card works at any hour.",
  },
  /**
   * Step 7.4. Both of these have been parsed since Phase 1 and reached no screen, so an operator
   * could not see that a card was banned from a truck stop, or which group allowed it at one.
   */
  {
    id: "locations",
    title: "Where this card may fuel",
    sentence: sourceSentence("Location rules", props.effective.sources.locationSource ?? null, props.policyNumber),
    rows: locationRows(props.effective.locationGroups ?? [], props.effective.blockedLocations ?? []),
    empty: "No location groups and no blocked locations. EFS reports no location rules on this card.",
  },
  /**
   * Step 7.3 parsed these; this is where they surface. Five ways to take MONEY off a fuel card,
   * none of them fuel — and until now nothing in the product could say whether any were open.
   */
  {
    id: "payroll",
    title: "Cash and payroll",
    sentence: "What this card can do besides buy fuel, as EFS reports it.",
    rows: props.effective.payroll ? payrollRows(props.effective.payroll) : [],
    empty: "EFS reports no payroll or cash capabilities on this card.",
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
