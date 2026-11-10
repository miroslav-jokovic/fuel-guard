<script setup lang="ts">
import { computed } from "vue";
import { finishedAdOpinion } from "@silvicom/shared";

/**
 * The finished-ad judge's second opinion on one creative (P1-7; Q-AD76). Shown BESIDE the three checks and worded
 * as an opinion, never as one of them: it has no floor, so it never stops an ad, and the person approving decides.
 * A creative composed before the judge existed carries none and shows nothing; one where it did not run says why.
 */
const props = defineProps<{ checks: unknown }>();
const opinion = computed(() => finishedAdOpinion(props.checks && typeof props.checks === "object" ? (props.checks as Record<string, unknown>).finished_ad : undefined));
</script>

<template>
  <section v-if="opinion" class="space-y-1 rounded-detail bg-surface-muted p-2 text-sm" aria-label="A second opinion on the finished ad" data-test="finished-ad-opinion">
    <h3 class="text-sm font-semibold text-ink">A second opinion on the finished ad</h3>
    <p class="text-xs text-ink-muted">An AI's view of the picture and words together. It is not a check and never stops an ad; you decide.</p>
    <p v-if="!opinion.ran" class="text-xs text-ink-muted" data-test="finished-ad-not-run">It did not run: {{ opinion.why }}.</p>
    <template v-else>
      <div v-for="f in opinion.formats" :key="f.format" :data-test="`finished-ad-${f.format}`">
        <p class="text-xs font-semibold text-ink">{{ f.format }} · EN</p>
        <ul class="space-y-0.5">
          <li v-for="i in f.items" :key="i.criterion" class="text-xs text-ink" data-test="finished-ad-item">
            <span class="font-semibold">{{ i.score }}/5</span> · {{ i.label }}<span class="text-ink-muted"> — {{ i.reason }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
