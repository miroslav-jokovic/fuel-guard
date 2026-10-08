<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useEventListener } from "@vueuse/core";
import { AppIconButton } from "@silvicom/ui";
import { ArrowsPointingOutIcon, PencilSquareIcon, XMarkIcon } from "@silvicom/ui/icons";
import { useAssistantStore } from "@/stores/assistant";
import AssistantMark from "./AssistantMark.vue";
import AssistantThread from "./AssistantThread.vue";
import { suggestionsFor } from "./suggestions";
import { useAssistantAccess } from "./useAssistantAccess";

/**
 * The assistant on every page: a launcher bottom-right, opening a docked panel (F21 redesign).
 *
 * Why a docked, NON-modal panel rather than a chat bubble or a `SlideOver` (PLAN §2, Q-AI7):
 * enterprise tools retired the always-on chat bubble during 2026 (Microsoft's Office Copilot moved
 * to one collapsible pane), and what holds up beside a data view is an assistant next to it that
 * leaves the page usable. A `SlideOver` has a scrim and traps focus, so the reader could not scroll
 * the table they are asking about — and later, when the assistant filters that table (D-AI5), it
 * would be filtering a page hidden behind its own overlay.
 *
 * Layering: `z-chrome`, the top bar's layer. Above page content and sticky table heads; BELOW every
 * dialog, scrim, popover and toast, so a modal the page opens covers the dock rather than the dock
 * floating over the modal's scrim, and a toast stays readable over it.
 *
 * Shown only where the person may reach `/ask` (`useAssistantAccess`), and not on `/ask` itself —
 * that page is the same thread at full width, and two copies of one conversation side by side
 * would be one too many.
 */
const route = useRoute();
const router = useRouter();
const store = useAssistantStore();
const allowed = useAssistantAccess();

const onAskPage = computed(() => route.name === "ask");
const visible = computed(() => allowed.value && !onAskPage.value);

/**
 * The page's own suggestions. The MATCHED pattern, not the URL: `/drivers/:id` is in the catalogue,
 * `/drivers/8f2c…` is not, and a detail page should ask about its list's subject.
 */
const suggestions = computed(() => suggestionsFor(route.matched.at(-1)?.path ?? route.path));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = isMac ? "⌘K" : "Ctrl K";

const launcher = ref<HTMLButtonElement | null>(null);
const thread = ref<InstanceType<typeof AssistantThread> | null>(null);

function show() {
  store.open = true;
  nextTick(() => thread.value?.focus());
}
function hide() {
  store.open = false;
  nextTick(() => launcher.value?.focus());
}

/** ⌘K / Ctrl K toggles from anywhere; no command palette exists for it to collide with (AUDIT W6). */
useEventListener(window, "keydown", (e: KeyboardEvent) => {
  if (!visible.value) return;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (store.open) hide();
    else show();
  }
});

/**
 * Escape closes the dock only when focus is INSIDE it. It is not a dialog, so it must not claim
 * Escape page-wide: a `SlideOver` or `BaseModal` the page opened owns that key (HeadlessUI picks
 * Escape's owner from the DOM tree, and two owners close both at once).
 */
function onPanelKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    hide();
  }
}

/** Leaving for `/ask` hands the conversation to the page; the store keeps it, the dock just closes. */
watch(onAskPage, (on) => {
  if (on) store.open = false;
});

function expand() {
  void router.push({ name: "ask" });
}
</script>

<template>
  <template v-if="visible">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 scale-95 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-y-2 scale-95 opacity-0"
    >
      <button
        v-if="!store.open"
        ref="launcher"
        type="button"
        class="group fixed right-6 bottom-6 z-chrome flex items-center gap-2.5 rounded-dialog bg-surface-inverse py-2 pr-3 pl-2 text-sm font-medium text-ink-inverse shadow-overlay ring-1 ring-ink-inverse/10 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-dialog focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring max-sm:right-4 max-sm:bottom-4"
        :aria-label="`Ask AI (${shortcut})`"
        aria-haspopup="dialog"
        :aria-expanded="store.open"
        aria-controls="assistant-dock"
        @click="show"
      >
        <AssistantMark size="md" class="transition-transform duration-300 group-hover:rotate-12" />
        <span>Ask AI</span>
        <kbd class="hidden rounded-detail bg-ink-inverse/10 px-1.5 py-0.5 font-sans text-2xs text-ink-inverse/70 sm:inline">{{ shortcut }}</kbd>
      </button>
    </Transition>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-3 scale-[0.97] opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-y-3 scale-[0.97] opacity-0"
    >
      <section
        v-if="store.open"
        id="assistant-dock"
        role="dialog"
        aria-modal="false"
        aria-labelledby="assistant-dock-title"
        class="fixed right-6 bottom-6 z-chrome flex h-[min(40rem,calc(100dvh-7rem))] w-[min(26rem,calc(100vw-3rem))] origin-bottom-right flex-col overflow-hidden rounded-dialog bg-surface shadow-dialog ring-1 ring-edge-subtle max-sm:inset-x-2 max-sm:top-20 max-sm:bottom-2 max-sm:h-auto max-sm:w-auto"
        @keydown="onPanelKeydown"
      >
        <header class="flex items-center gap-3 border-b border-edge-subtle px-4 py-3">
          <AssistantMark size="md" />
          <div class="min-w-0 flex-1">
            <h2 id="assistant-dock-title" class="text-sm font-semibold text-ink">Ask AI</h2>
            <p class="truncate text-xs text-ink-muted">Answers from your fleet data</p>
          </div>
          <AppIconButton v-if="store.turns.length" :icon="PencilSquareIcon" label="New chat" size="sm" @click="store.clear()" />
          <AppIconButton :icon="ArrowsPointingOutIcon" label="Open full page" size="sm" @click="expand" />
          <AppIconButton :icon="XMarkIcon" :label="`Close (${shortcut})`" size="sm" @click="hide" />
        </header>
        <AssistantThread ref="thread" :suggestions="suggestions" size="dock" />
      </section>
    </Transition>
  </template>
</template>
