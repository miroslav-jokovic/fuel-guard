<script setup lang="ts">
import { computed } from "vue";
import { AppCallout } from "@silvicom/ui";
import FamilyBridge from "./FamilyBridge.vue";
import FleetMilesCard from "./FleetMilesCard.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The overview (G5, R4) — where the period's money went and how far the fleet ran to earn it.
 *
 * Since R3 the four headlines above this component carry earned, spent and kept with their
 * neighbours; since R4 the company/contractor split lives on the Contractors tab (D-FRUI6). What
 * is left here is the shape of the period: one bar of the ten families plus what was kept, and
 * the driven-against-billed miles with the empty share between them (plan §1.5.4).
 *
 * Nothing is computed here. Every figure comes from `computeFleetReport`, which is the only place
 * the arithmetic lives, and a rate that arrives as `null` prints as a dash with the reason beside
 * it — never as $0.00, which is a plausible number and a wrong one.
 */

const props = defineProps<{ report: FleetReportResponse; loading?: boolean }>();

/**
 * A period whose ledger months were all withheld has no figures — not zero ones (G11).
 *
 * Measured 2026-09-03: the page opened on the last full calendar month, which that morning was
 * August, and August's ledger held eleven lines swept four days before the month ended. Every card
 * would have read $0 earned, $8,430 spent, −$8,430 kept: arithmetically correct over the rows that
 * were there, and not a fact about August. A zero in a money column is a claim.
 */
const noReportableMonth = computed(
  () => props.report.monthsCovered.length === 0 && props.report.ledgerReason !== null,
);
</script>

<template>
  <div class="space-y-4">
    <!-- The withheld state as one callout (D-FRUI5): the fact, the reason in the API's words,
         and the next action. -->
    <AppCallout v-if="noReportableMonth" tone="warning">
      There are no figures for this period yet. {{ report.ledgerReason }} Pick a period that ends
      in a finished month, or run the McLeod financial sweep again now that this one has closed.
    </AppCallout>

    <template v-else>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <FamilyBridge
          class="lg:col-span-7"
          :families="report.families"
          :revenue="report.total.revenue"
          :net="report.total.net"
          :loading="loading"
        />
        <FleetMilesCard class="lg:col-span-5" :report="report" :loading="loading" />
      </div>

      <p class="text-xs text-ink-tertiary">
        Money comes from McLeod's ledger and miles from Samsara. Nothing here is estimated or shared
        out.
        <template v-if="report.monthsCovered.length">
          Covering {{ report.monthsCovered.join(", ") }}.
        </template>
        <template v-if="report.monthsMissing.length">
          The McLeod sweep has not reached {{ report.monthsMissing.join(", ") }} yet.
        </template>
        <template v-if="report.ledgerReason">{{ report.ledgerReason }}</template>
      </p>
    </template>
  </div>
</template>
