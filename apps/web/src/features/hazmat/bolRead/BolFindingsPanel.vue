<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import type { BolFindings } from "./bolFindings";

/**
 * "Is this BOL written correctly?" — the paper audit of the read BOL (§5, §7A N6 part 3), above the
 * calculator form as plan §6 places it. What is wrong first, with who acts and how to fix it; then what the
 * audit could not answer; the passed checks folded away behind their count.
 */
defineProps<{ findings: BolFindings; /** A check is being recorded: the choices wait for its answer. */ busy?: boolean }>();
/** A person says what the page prints in a field a check waits on (Q-RC5); the form records it and re-checks. */
const emit = defineEmits<{ check: [path: string, value: unknown] }>();
const showPassed = ref(false);

const ACTOR_WORDS = {
  driver_must_not_accept: "Do not accept the BOL until it is corrected",
  shipper_must_correct: "The shipper must correct it",
  information_only: "For information",
} as const;
</script>

<template>
  <BaseCard as="section" data-testid="bol-findings">
    <div>
      <h2 class="text-sm font-semibold text-ink">Is this BOL written correctly?</h2>
      <p class="mt-0.5 text-sm text-ink-muted">
        Checked against the federal hazmat rules for shipping papers. Each check rests on what both readers read.
      </p>
    </div>

    <p v-if="!findings.wrong.length && !findings.check.length" class="mt-4 text-sm text-success-700" data-testid="bol-findings-clean">
      Every check passed.
    </p>

    <div v-if="findings.wrong.length" class="mt-4 space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-danger-700">Wrong or missing ({{ findings.wrong.length }})</h3>
      <ul class="space-y-2">
        <li
          v-for="f in findings.wrong"
          :key="f.key"
          class="rounded-control bg-danger-50 px-3 py-2 text-sm ring-1 ring-inset ring-danger-200"
          data-testid="bol-finding-wrong"
        >
          <p class="font-medium text-ink">{{ f.sentence }}</p>
          <p class="mt-1 text-xs text-ink-secondary">
            <span class="font-semibold">{{ ACTOR_WORDS[f.actor] }}.</span> {{ f.howToFix }}
            <span class="text-ink-muted">({{ f.cite }})</span>
          </p>
        </li>
      </ul>
    </div>

    <div v-if="findings.check.length" class="mt-4 space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-warning-800">Check by eye ({{ findings.check.length }})</h3>
      <ul class="space-y-1.5">
        <li v-for="f in findings.check" :key="f.key" class="text-sm text-ink-secondary" data-testid="bol-finding-check">
          {{ f.sentence }} <span class="text-xs text-ink-muted">({{ f.cite }})</span>
          <div v-for="c in f.choices ?? []" :key="c.path" class="mt-1.5 flex flex-wrap items-center gap-2" data-testid="bol-finding-choice">
            <span class="text-xs text-ink-muted">What does the page show for {{ c.label }}?</span>
            <BaseButton
              v-for="o in c.options"
              :key="o.text"
              variant="secondary"
              size="sm"
              :disabled="busy"
              @click="emit('check', c.path, o.value)"
            >
              {{ o.text }}
            </BaseButton>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="findings.passed.length" class="mt-4 border-t border-edge pt-3">
      <BaseButton variant="link" :aria-expanded="showPassed" @click="showPassed = !showPassed">
        {{ showPassed ? "Hide" : "Show" }} the {{ findings.passed.length }} {{ findings.passed.length === 1 ? "check" : "checks" }} that passed
      </BaseButton>
      <ul v-if="showPassed" class="mt-2 space-y-1" data-testid="bol-findings-passed">
        <li v-for="f in findings.passed" :key="f.key" class="text-xs text-ink-muted">{{ f.sentence }}</li>
      </ul>
    </div>
  </BaseCard>
</template>
