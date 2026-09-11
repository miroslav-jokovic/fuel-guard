<script setup lang="ts">
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * What is stopping the driver, and a way to get to it (D-AX3).
 *
 * ── THE DEFECT THIS REPLACED, KEPT BECAUSE IT IS THE POINT OF THE FILE ────────────────────────
 * ⚠ This list used to render `issue.key` — the Zod path, which is the contract key — so a driver on a
 * phone read **`equipment_experience`** beside *"Too small: expected string to have >=1 characters"*.
 * `label` is the field in the words printed above the box, and `say` is a sentence addressed to the
 * person reading it. Both come from `fieldLabels.ts`, which is the only place either is written.
 *
 * Each entry is a CONTROL rather than a line of text, because on the employment screen the field it
 * names can be two thousand pixels below the fold. It is `BaseButton variant="link"` and not a bare
 * `<button>`: a raw button in a page or a feature fails `lint:ui-adoption`.
 *
 * Split out of `ApplyPage.vue` on 2026-09-11 (the 500-line budget).
 */
defineProps<{
  issues: readonly SectionIssue[];
  /** A failure from sending, which belongs in the same list — it stops the driver the same way. */
  sendError: string | null;
  /** The last screen says "before you can send this" rather than "before you can go on". */
  final: boolean;
}>();
const emit = defineEmits<{ show: [issue: SectionIssue] }>();
</script>

<template>
  <BaseCard v-if="issues.length || sendError">
    <h2 class="text-sm font-semibold text-ink">
      {{ final ? APPLY_COPY.issues.headingFinal : APPLY_COPY.issues.heading }}
    </h2>
    <ul class="mt-2 space-y-1 text-sm text-ink-secondary">
      <li v-if="sendError">{{ sendError }}</li>
      <li v-for="issue in issues" :key="issue.fieldId + issue.message">
        <BaseButton variant="link" @click="emit('show', issue)">
          <span class="font-medium text-ink">{{ issue.label }}</span>
        </BaseButton>
        — {{ issue.say }}
      </li>
    </ul>
  </BaseCard>
</template>
