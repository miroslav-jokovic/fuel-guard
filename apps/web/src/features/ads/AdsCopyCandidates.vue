<script setup lang="ts">
import { computed } from "vue";
import { CRAFT_CRITERIA, CRAFT_CRITERION_LABEL, CRAFT_MAX_TOTAL, type AdCandidates } from "@silvicom/shared";
import { AppButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { copyLines } from "./adsCampaignFlow";

/**
 * The copies the writer offered for one ad, ranked by the craft judge (CQ4; D-AD19, D-AD21): the first became the ad,
 * the others are shown so a reviewer sees why — and can disagree, which is how the judge gets calibrated (R7). When
 * no judge ranked them (switched off, or before it existed) the order is the writer's and the heading says so.
 */
const props = defineProps<{ candidates: AdCandidates; language: string; canChoose?: boolean }>();
const emit = defineEmits<{ use: [index: number] }>();

const ranked = computed(() => props.candidates.ranked.map((c, i) => ({ ...c, rank: i + 1, chosen: i === props.candidates.chosen })));
const judged = computed(() => props.candidates.judge !== null);
const dropped = computed(() => props.candidates.offered - props.candidates.passed);
/** Why a better-ranked copy is not the ad (AG1): the overlay could not draw it, in the overlay's own word. */
const passedOver = computed(() => new Map((props.candidates.passed_over ?? []).map((p) => [p.index, p.reason])));
const which = computed(() => (props.candidates.chosen === 0 ? "the first became the ad" : `#${props.candidates.chosen + 1} became the ad, because the ones above it do not fit on the image`));
</script>

<template>
  <details class="rounded-detail bg-surface-muted p-3 text-sm" data-test="copy-candidates">
    <summary class="cursor-pointer text-ink">
      {{ candidates.passed }} of {{ candidates.offered }} copies offered passed the checks<template v-if="dropped > 0">; {{ dropped }} stated something the opening does not</template>.
      <template v-if="candidates.chosen_by_person">{{ candidates.chosen_by_person.name }} chose the words<template v-if="candidates.chosen_by_person.edited_slots.length">, starting from #{{ candidates.chosen + 1 }} and changing {{ candidates.chosen_by_person.edited_slots.join(", ") }}</template><template v-else>: #{{ candidates.chosen + 1 }}, as offered</template>.</template>
      <template v-else-if="judged">Ranked by the craft judge; {{ which }}.</template>
      <template v-else>Not ranked — in the writer's order; {{ which }}.</template>
    </summary>
    <ol class="mt-3 space-y-3">
      <li v-for="c in ranked" :key="c.offered_as" class="space-y-1" :data-test="`candidate-${c.rank}`">
        <p class="font-semibold text-ink">
          #{{ c.rank }}<span v-if="c.chosen" :class="[BADGE_BASE, toneClass('success'), 'ml-2']" data-test="chosen">this one</span>
          <span v-if="c.total !== null" class="ml-2 text-xs text-ink-muted" data-test="total">{{ c.total }} of {{ CRAFT_MAX_TOTAL }}</span>
        </p>
        <p v-if="passedOver.has(c.rank - 1)" class="text-xs text-warning-700" data-test="passed-over">Not used: it does not fit on the image ({{ passedOver.get(c.rank - 1) }}).</p>
        <p v-for="l in copyLines(c.copy, language)" :key="l.slot" class="text-ink"><span class="text-ink-muted">{{ l.slot }}: </span>{{ l.text }}</p>
        <AppButton v-if="canChoose && !c.chosen" size="sm" :data-test="`use-${c.rank}`" @click="emit('use', c.rank - 1)">Use these words</AppButton>
        <template v-if="c.judged">
          <p class="text-xs text-ink-muted" data-test="reason">{{ c.judged.reason }}</p>
          <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            <li v-for="k in CRAFT_CRITERIA" :key="k" :title="CRAFT_CRITERION_LABEL[k]">{{ k.replace("_", " ") }} {{ c.judged.scores[k] }}</li>
          </ul>
        </template>
      </li>
    </ol>
  </details>
</template>
