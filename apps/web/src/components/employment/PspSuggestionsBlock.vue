<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDisplayDate, type PspEmploymentSuggestions, type UnlistedCarrier } from "@silvicom/shared";
import { PSP_SUGGESTION_COPY as copy } from "./pspSuggestions";

/**
 * HW6b — the carriers the driver's PSP record names that the job list does not
 * (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.6), under the timeline on both surfaces that draw one.
 *
 * SHOW-ONLY (PSP-PLAN Q10 is open): nothing here is stored and nothing is added on its own. "Add as a
 * job" opens the one employer form with the carrier filled in; the job exists when a person saves it.
 * There is no Dismiss — recording that somebody looked would be the first PSP-derived row, and Q10
 * decides whether there may be one (the plan's open questions, Q-HW6b1).
 *
 * Renders nothing without a machine-readable report: an imported PDF has been read by nobody, and
 * "PSP found nothing" is a claim about the driver that an absent report does not make (D-PSP5).
 */
defineProps<{ suggestions: PspEmploymentSuggestions | null | undefined; editable: boolean }>();
const emit = defineEmits<{ add: [carrier: UnlistedCarrier] }>();
</script>

<template>
  <section
    v-if="suggestions?.report"
    class="space-y-2 rounded-surface border border-dashed border-edge p-3"
    data-testid="psp-suggestions"
  >
    <h3 class="text-sm font-semibold text-ink">{{ copy.heading }}</h3>
    <p class="text-xs text-ink-muted">
      {{ copy.pulled(formatDisplayDate(suggestions.report.pulledOn)) }} {{ copy.limit }}
    </p>
    <p v-if="suggestions.unlisted.length === 0" class="text-sm text-ink-secondary">{{ copy.allListed }}</p>
    <ul v-else class="space-y-2">
      <li
        v-for="u in suggestions.unlisted"
        :key="u.usdotNumber"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-surface bg-surface-muted p-3"
        :data-psp-carrier="u.usdotNumber"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <p class="break-words text-sm text-ink">
            {{ copy.unlisted(u, formatDisplayDate(u.firstSeen), formatDisplayDate(u.lastSeen)) }}
          </p>
          <p class="text-xs text-ink-muted">{{ copy.owedTo[u.owedTo] }}</p>
        </div>
        <BaseButton v-if="editable" variant="secondary" size="sm" @click="emit('add', u)">{{ copy.add }}</BaseButton>
      </li>
    </ul>
    <p v-if="editable && suggestions.unlisted.length" class="text-xs text-ink-muted">{{ copy.confirmDates }}</p>
  </section>
</template>
