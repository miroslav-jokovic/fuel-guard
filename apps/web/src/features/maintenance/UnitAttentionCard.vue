<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, QueryState, useTouchTargets } from "@silvicom/ui";
import { repairClock, type RoadsideRepairDueDto, type UnitAttentionReason } from "@silvicom/shared";
import { attentionAnchor, attentionSentence } from "./attentionWords";

/**
 * The truck's first section: what needs attention on it (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §4.3; D-MX3). Its rows are this unit's rows from the Shop worklist — the same reasons, the same
 * words (`attentionWords.ts`) — each linking down the page to the section that answers it, which is
 * what "no tabs" means in practice: the page is one scroll and the first section is its index.
 *
 * Roadside repairs due come as a separate list because they are matched by the unit the officer wrote
 * (D-IC7), in the browser, exactly as the roadside card beside them does; the page passes this unit's.
 */
const props = defineProps<{
  reasons: UnitAttentionReason[];
  roadside: RoadsideRepairDueDto[];
  today: string;
  loading: boolean;
  error: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();

const rows = computed(() => [
  ...props.roadside.map((r) => {
    const c = repairClock(r.dueOn, props.today);
    const when = c.overdue ? `${c.days} day${c.days === 1 ? "" : "s"} overdue` : c.days === 0 ? "due today" : `${c.days} day${c.days === 1 ? "" : "s"} left`;
    return { key: `roadside:${r.unitId}`, text: `Roadside violations to repair and certify — ${when}`, anchor: "section-roadside", urgent: c.overdue };
  }),
  ...props.reasons.map((r, i) => ({
    key: `${r.kind}:${i}`,
    text: attentionSentence(r),
    anchor: attentionAnchor(r),
    urgent: (r.kind === "annual" && r.daysRemaining < 0) || (r.kind === "pm" && r.verdict === "overdue"),
  })),
]);
/** A link standing on its own is a target, not a word: 48 px tall under the touch floor (contract §9 rule 1). */
const touch = useTouchTargets();
</script>

<template>
  <BaseCard id="section-attention" class="scroll-mt-6" data-test="unit-attention">
    <h2 class="text-sm font-semibold text-ink">Needs attention</h2>
    <div class="mt-3">
      <QueryState
        compact
        :loading="loading"
        :error="error"
        loading-text="Checking the worklist…"
        error-text="Could not load what needs attention."
        @retry="emit('retry')"
      >
        <ul v-if="rows.length" class="divide-y divide-edge-subtle text-sm">
          <li v-for="r in rows" :key="r.key" class="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <span :class="r.urgent ? 'font-medium text-danger-700' : 'text-ink'">{{ r.text }}</span>
            <a :href="`#${r.anchor}`" class="shrink-0 text-sm font-medium text-link hover:text-link-hover" :class="touch && 'inline-flex min-h-12 items-center'">See below</a>
          </li>
        </ul>
        <p v-else class="text-sm text-ink-secondary" data-test="unit-attention-none">Nothing needs attention on this unit today.</p>
      </QueryState>
    </div>
  </BaseCard>
</template>
