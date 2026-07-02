<script setup lang="ts">
import { ref } from "vue";
import { PaperAirplaneIcon, SparklesIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "@/lib/api";

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
      <SparklesIcon class="size-6 text-indigo-600" />
      <h1 class="text-lg font-semibold text-gray-900">Ask AI about your fleet</h1>
    </div>
    <p class="text-sm text-gray-500">
      Ask questions in plain language about theft risk, drivers, vehicles, spend and odometer accuracy.
      Answers come from your own data — the AI can only read pre-defined, org-scoped queries (never raw data access).
    </p>

    <form class="flex items-end gap-2" @submit.prevent="ask()">
      <textarea
        v-model="question"
        rows="2"
        placeholder="e.g. Which drivers had the most location mismatches this month?"
        class="flex-1 rounded-md border-0 px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600"
        @keydown.enter.exact.prevent="ask()"
      ></textarea>
      <button
        type="submit"
        :disabled="loading || !question.trim()"
        class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        <PaperAirplaneIcon class="size-4" /> {{ loading ? "Thinking…" : "Ask" }}
      </button>
    </form>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="ex in examples"
        :key="ex"
        class="rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200 ring-inset hover:bg-gray-100"
        @click="ask(ex)"
      >
        {{ ex }}
      </button>
    </div>

    <div v-if="loading" class="rounded-lg bg-white p-5 text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
      Analyzing your data…
    </div>
    <div
      v-else-if="answer"
      :class="['rounded-lg p-5 text-sm whitespace-pre-wrap shadow-sm ring-1', errored ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-white text-gray-800 ring-gray-200']"
    >
      {{ answer }}
    </div>
  </div>
</template>
