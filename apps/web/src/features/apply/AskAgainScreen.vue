<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import type { AskAgainView } from "@silvicom/shared";
import { APPLY_COPY } from "./strings";

/**
 * "Silvicom has a question" — in place of the wait screen while the office waits on the driver
 * (APPLICATION-FIX-PLAN.md F5). The office's own words, the answer they are about, and two acts:
 * open that answer in the application, and — once it has been opened — say it is answered.
 *
 * ⚠ Prints nothing of the application. It stands before the date-of-birth gate in the chain, like the
 * wait screens, so it may show only what the office wrote and which QUESTION it is about (the label a
 * blank form shows too) — never the driver's answer. The gate is met on the way in.
 */
defineProps<{
  carrier: string;
  questions: readonly AskAgainView[];
  /** Each question's answer, in the words its screen prints above it. */
  labels: Readonly<Record<string, string>>;
  /** The ones the driver has opened this visit — only those offer "Send my answer". */
  opened: readonly string[];
  /** The id being sent, or null. */
  sending: string | null;
  failed: string | null;
}>();
const emit = defineEmits<{ answer: [AskAgainView]; send: [AskAgainView] }>();
const copy = APPLY_COPY.askAgain;
</script>

<template>
  <section class="space-y-5" data-ask-again>
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading(carrier, questions.length) }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.intro(carrier) }}</p>
    </div>
    <ul class="space-y-3">
      <li v-for="q in questions" :key="q.id" class="rounded-surface bg-surface-muted p-4" :data-question="q.id">
        <p class="text-xs font-medium text-ink-tertiary">{{ copy.about }}: {{ labels[q.id] }}</p>
        <p class="mt-1 whitespace-pre-line break-words text-base text-ink">{{ q.question }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <BaseButton size="touch" :variant="opened.includes(q.id) ? 'ghost' : 'primary'" :disabled="sending !== null" @click="emit('answer', q)">
            {{ opened.includes(q.id) ? copy.openAgain : copy.open }}
          </BaseButton>
          <BaseButton v-if="opened.includes(q.id)" size="touch" variant="primary" :disabled="sending !== null" @click="emit('send', q)">
            {{ sending === q.id ? copy.sending : copy.send }}
          </BaseButton>
        </div>
      </li>
    </ul>
    <p v-if="failed" class="text-sm text-danger-700" role="alert">{{ failed }}</p>
  </section>
</template>
