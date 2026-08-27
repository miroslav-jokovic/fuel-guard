<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  PaperAirplaneIcon,
  SparklesIcon,
} from "@silvicom/ui/icons";
import { ref } from "vue";
import { apiFetch } from "@/lib/api";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppTextarea } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

const question = ref("");
const answer = ref<string | null>(null);
const loading = ref(false);
const errored = ref(false);

const examples = [
  "How much did we spend on fuel last month, and what's our fleet MPG?",
  "Which drivers have the worst MPG this quarter?",
  "Top 5 fuel stations by spend in the last 30 days.",
  "Idle hours and cost this month — who are the worst idlers?",
  "What % of our fills are corroborated by telematics?",
  "Best and worst drivers by safety score.",
  "How many high or critical theft alerts in the last 30 days?",
];

async function ask(q?: string) {
  const text = (q ?? question.value).trim();
  if (!text || loading.value) return;
  question.value = text;
  loading.value = true;
  errored.value = false;
  answer.value = null;
  const res = await apiFetch<{ answer: string }>("/api/ai/ask", { method: "POST", body: { question: text } });
  loading.value = false;
  if (res.ok && res.data) answer.value = res.data.answer;
  else {
    errored.value = true;
    answer.value = res.error?.message ?? "Something went wrong.";
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <div class="flex items-center gap-2">
      <AppIcon :icon="SparklesIcon" class="size-6 text-brand-600" />
      <h1 class="text-lg font-semibold text-ink">Ask AI about your fleet</h1>
    </div>
    <PageHeader>
      Ask questions in plain language about fuel spend and MPG, drivers and idling, theft alerts,
      telematics coverage, imports and your fleet. Answers come from your own data — the AI can only read pre-defined, org-scoped queries (never raw data access).
    </PageHeader>

    <form class="flex items-end gap-2" @submit.prevent="ask()">
      <AppTextarea
        v-model="question"
        rows="2"
        placeholder="e.g. Which drivers had the most location mismatches this month?"
        class="flex-1"
        @keydown.enter.exact.prevent="ask()"
      />
      <BaseButton variant="primary" type="submit" :disabled="loading || !question.trim()">
        <AppIcon :icon="PaperAirplaneIcon" class="size-4" /> {{ loading ? "Thinking…" : "Ask" }}
      </BaseButton>
    </form>

    <div class="flex flex-wrap gap-2">
      <BaseButton
        v-for="ex in examples"
        :key="ex"
        class="rounded-full bg-surface-subtle px-3 py-1 text-xs text-ink-secondary ring-1 ring-edge ring-inset hover:bg-surface-muted"
        @click="ask(ex)"
      >
        {{ ex }}
      </BaseButton>
    </div>

    <BaseCard v-if="loading" class="text-sm text-ink-muted">
      Analyzing your data…
    </BaseCard>
    <div
      v-else-if="answer"
      :class="['rounded-surface p-5 text-sm whitespace-pre-wrap ring-1', errored ? 'bg-danger-50 text-danger-700 ring-danger-200' : 'bg-surface text-ink-secondary ring-edge']"
    >
      {{ answer }}
    </div>
  </div>
</template>
