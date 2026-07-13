<script setup lang="ts">
import { ref } from "vue";
import { PaperAirplaneIcon, SparklesIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "@/lib/api";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import PageHeader from "@/components/ui/PageHeader.vue";

const question = ref("");
const answer = ref<string | null>(null);
const loading = ref(false);
const errored = ref(false);

const examples = [
  "How many high or critical theft alerts in the last 30 days?",
  "Which drivers had the most flagged fills this month?",
  "How many open cases involve tank_space_exceeded?",
  "Show odometer accuracy — worst drivers.",
  "How much did we spend on fuel in the last week?",
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
      <SparklesIcon class="size-6 text-brand-600" />
      <h1 class="text-lg font-semibold text-ink">Ask AI about your fleet</h1>
    </div>
    <PageHeader>
      Ask questions in plain language about theft risk, drivers, vehicles, spend and odometer accuracy.
      Answers come from your own data — the AI can only read pre-defined, org-scoped queries (never raw data access).
    </PageHeader>

    <form class="flex items-end gap-2" @submit.prevent="ask()">
      <textarea
        v-model="question"
        rows="2"
        placeholder="e.g. Which drivers had the most location mismatches this month?"
        class="block flex-1 rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-edge-strong ring-inset placeholder:text-ink-subtle focus:ring-2 focus:ring-brand-600"
        @keydown.enter.exact.prevent="ask()"
      ></textarea>
      <BaseButton variant="primary" type="submit" :disabled="loading || !question.trim()">
        <PaperAirplaneIcon class="size-4" /> {{ loading ? "Thinking…" : "Ask" }}
      </BaseButton>
    </form>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="ex in examples"
        :key="ex"
        class="rounded-full bg-surface-subtle px-3 py-1 text-xs text-ink-secondary ring-1 ring-edge ring-inset hover:bg-surface-muted"
        @click="ask(ex)"
      >
        {{ ex }}
      </button>
    </div>

    <BaseCard v-if="loading" class="text-sm text-ink-muted">
      Analyzing your data…
    </BaseCard>
    <div
      v-else-if="answer"
      :class="['rounded-lg p-5 text-sm whitespace-pre-wrap shadow-sm ring-1', errored ? 'bg-danger-50 text-danger-700 ring-danger-200' : 'bg-surface text-ink-secondary ring-edge']"
    >
      {{ answer }}
    </div>
  </div>
</template>
