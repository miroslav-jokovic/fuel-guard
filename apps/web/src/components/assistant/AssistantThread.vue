<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ArrowPathIcon, ChevronRightIcon, CopyIcon } from "@silvicom/ui/icons";
import { useAssistantStore } from "@/stores/assistant";
import { useToastStore } from "@/stores/toast";
import AssistantAnswer from "./AssistantAnswer.vue";
import AssistantComposer from "./AssistantComposer.vue";
import AssistantMark from "./AssistantMark.vue";

/**
 * The conversation itself — empty state, turns, composer — shared by the floating dock and `/ask`
 * (D-AI9), so both read one store and look the same. `size` only changes how much room it takes.
 */
const props = withDefaults(defineProps<{ suggestions: string[]; size?: "dock" | "page" }>(), { size: "dock" });

const store = useAssistantStore();
const toast = useToastStore();
const scroller = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof AssistantComposer> | null>(null);

/** Follow the newest turn, and the answer as it lands. */
watch(
  () => store.turns.map((t) => t.status).join(),
  () => nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" })),
);

async function copy(answer: string) {
  try {
    await navigator.clipboard.writeText(answer);
    toast.success("Answer copied");
  } catch {
    toast.error("Could not copy the answer");
  }
}

defineExpose({ focus: () => composer.value?.focus() });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" :class="props.size === 'page' ? 'px-6 py-6' : 'px-4 py-4'">
      <!-- Empty: what this assistant can answer, as questions to start from. -->
      <div v-if="store.turns.length === 0" class="flex h-full flex-col justify-end gap-5" :class="props.size === 'page' && 'mx-auto max-w-2xl justify-center'">
        <div class="space-y-3">
          <AssistantMark size="lg" />
          <div>
            <p class="text-base font-semibold text-ink">What do you want to know?</p>
            <p class="mt-1 text-sm text-ink-muted">
              Ask about fuel spend, MPG, idling, theft alerts and driver scores. Answers come from your own fleet data.
            </p>
          </div>
        </div>
        <ul class="space-y-2" aria-label="Suggested questions">
          <li v-for="q in suggestions" :key="q">
            <button
              type="button"
              class="group flex w-full items-center gap-3 rounded-control bg-surface px-3 py-2.5 text-left text-sm text-ink-secondary ring-1 ring-edge-subtle transition hover:bg-surface-subtle hover:text-ink hover:ring-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              @click="store.ask(q)"
            >
              <span class="flex-1">{{ q }}</span>
              <AppIcon :icon="ChevronRightIcon" class="size-4 shrink-0 text-ink-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>

      <ol v-else class="space-y-6" :class="props.size === 'page' && 'mx-auto max-w-3xl'" aria-live="polite">
        <li v-for="t in store.turns" :key="t.id" class="space-y-3">
          <div class="flex justify-end">
            <p class="max-w-[85%] whitespace-pre-wrap rounded-surface bg-surface-muted px-3.5 py-2 text-sm text-ink">{{ t.question }}</p>
          </div>
          <div class="flex gap-3">
            <AssistantMark size="sm" class="mt-0.5" />
            <div class="min-w-0 flex-1">
              <p v-if="t.status === 'pending'" class="flex items-center gap-2 py-1 text-sm text-ink-muted">
                <span class="flex gap-1" aria-hidden="true">
                  <span class="size-1.5 animate-pulse rounded-full bg-brand-500"></span>
                  <span class="size-1.5 animate-pulse rounded-full bg-brand-500 [animation-delay:150ms]"></span>
                  <span class="size-1.5 animate-pulse rounded-full bg-brand-500 [animation-delay:300ms]"></span>
                </span>
                Reading your data…
              </p>
              <template v-else-if="t.status === 'error'">
                <p class="text-sm text-danger-text">{{ t.answer }}</p>
                <button
                  type="button"
                  class="mt-2 inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-ink-secondary ring-1 ring-edge-control transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="store.busy()"
                  @click="store.retry(t.id)"
                >
                  <AppIcon :icon="ArrowPathIcon" class="size-3.5" aria-hidden="true" /> Try again
                </button>
              </template>
              <template v-else-if="t.answer">
                <AssistantAnswer :text="t.answer" />
                <button
                  type="button"
                  class="mt-2 -ml-1.5 inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-xs text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
                  @click="copy(t.answer)"
                >
                  <AppIcon :icon="CopyIcon" class="size-3.5" aria-hidden="true" /> Copy
                </button>
              </template>
            </div>
          </div>
        </li>
      </ol>
    </div>

    <div class="border-t border-edge-subtle bg-surface" :class="props.size === 'page' ? 'px-6 py-4' : 'px-3 py-3'">
      <AssistantComposer ref="composer" :busy="store.busy()" :class="props.size === 'page' && 'mx-auto max-w-3xl'" @send="store.ask" />
    </div>
  </div>
</template>
