<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useEventListener, useMediaQuery } from "@vueuse/core";
import { AppIcon, AppIconButton } from "@silvicom/ui";
import { ArrowsPointingOutIcon, PencilSquareIcon, SparklesIcon, XMarkIcon } from "@silvicom/ui/icons";
import { useAssistantStore } from "@/stores/assistant";
import AssistantMark from "./AssistantMark.vue";
import AssistantThread from "./AssistantThread.vue";
import { suggestionsFor } from "./suggestions";
import { useAssistantAccess } from "./useAssistantAccess";
import { useLauncherPosition } from "./useLauncherPosition";

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
 *
 * The launcher can be dragged anywhere on screen and stays where it was left (owner, 2026-10-09:
 * it sat over data people needed to read) — `useLauncherPosition` owns that, and the dock opens
 * from whichever corner the launcher is nearest, so it unfolds over the space the person cleared.
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

const panel = ref<HTMLElement | null>(null);
const launcher = ref<HTMLButtonElement | null>(null);
const thread = ref<InstanceType<typeof AssistantThread> | null>(null);

/** 52px, `size-13` — the drag clamp needs the number, the template the class; keep them together. */
const LAUNCHER_SIZE = 52;
const position = useLauncherPosition(launcher, LAUNCHER_SIZE);
const launcherStyle = computed(() => ({ right: `${position.offset.value.right}px`, bottom: `${position.offset.value.bottom}px` }));

/**
 * The dock opens from the launcher's corner (`dockAnchor`). Each offset is capped so the dock's own
 * size — the `w-[…]`/`h-[…]` below, restated here because CSS cannot read a sibling's class — still
 * fits, or a launcher parked high on the left would push the dock off the bottom of the window.
 * Below `sm` the dock is a full-width sheet and ignores all of this.
 */
const wide = useMediaQuery("(min-width: 640px)");
const FIT_X = "calc(100vw - min(26rem, 100vw - 3rem) - 0.5rem)";
const FIT_Y = "calc(100dvh - min(40rem, 100dvh - 7rem) - 0.5rem)";
const dockStyle = computed(() => {
  if (!wide.value) return undefined;
  const { x, y, xPx, yPx } = position.anchor.value;
  return { [x]: `min(${xPx}px, ${FIT_X})`, [y]: `min(${yPx}px, ${FIT_Y})`, transformOrigin: `${y} ${x}` };
});

/** A click that ends a drag is the drag's, not the button's. */
function onLauncherClick() {
  if (position.consumeClick()) return;
  show();
}

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
useEventListener(panel, "keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    hide();
  }
});

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
      <!--
        The orb (owner, 2026-10-09: no label, no icon-in-a-box). The fill is the chip recipe from
        `AppIconChip` — the brand pair, the 28%-white top edge, the brand glow, a white glyph at
        stroke 2.2 — with the accent added as a middle stop. That crosses two hues, which the chip
        refuses on purpose; here it is the assistant's own signature, and accent is the hue D-DS15
        defined as brand's companion, so no new colour relationship is invented. The conic layer
        turns only on hover or drag, and the app-wide reduced-motion rule stills it.
      -->
      <button
        v-if="!store.open"
        ref="launcher"
        type="button"
        class="assistant-orb group fixed z-chrome grid size-13 touch-none place-items-center rounded-full text-chip-glyph shadow-chip-brand select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        :class="position.dragging.value ? 'is-dragging cursor-grabbing' : 'cursor-pointer'"
        :style="launcherStyle"
        :aria-label="`Ask AI (${shortcut})`"
        :title="`Ask AI (${shortcut}) — drag to move`"
        aria-haspopup="dialog"
        :aria-expanded="store.open"
        aria-controls="assistant-dock"
        @click="onLauncherClick"
      >
        <span aria-hidden="true" class="orb-halo absolute -inset-1.5 rounded-full bg-conic from-chip-brand-from via-accent-500 to-chip-brand-from opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-60" />
        <span aria-hidden="true" class="absolute inset-0 overflow-hidden rounded-full">
          <span class="orb-swirl absolute -inset-2 bg-conic from-chip-brand-from via-accent-600 to-chip-brand-from" />
          <span class="orb-sheen absolute inset-0 rounded-full" />
        </span>
        <AppIcon
          :icon="SparklesIcon"
          :stroke-width="2.2"
          class="relative size-6 transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-12"
        />
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
        ref="panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="assistant-dock-title"
        :style="dockStyle"
        class="fixed z-chrome flex h-[min(40rem,calc(100dvh-7rem))] w-[min(26rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-dialog bg-surface shadow-dialog ring-1 ring-edge-subtle max-sm:inset-x-2 max-sm:top-20 max-sm:bottom-2 max-sm:h-auto max-sm:w-auto"
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

<style scoped>
/* The orb's motion and light, which no utility can say: a turning conic layer, and the sheen where
   light catches the top of a solid object — `--chip-top-edge`, the same ingredient the chips use. */
.orb-sheen {
  background:
    radial-gradient(circle at 32% 22%, var(--chip-top-edge), transparent 58%),
    radial-gradient(circle at 50% 120%, color-mix(in oklab, var(--chip-brand-to) 70%, transparent), transparent 62%);
  box-shadow: inset 0 1px 0 0 var(--chip-top-edge);
}

.orb-swirl,
.orb-halo {
  animation: orb-turn 6s linear infinite paused;
}

.assistant-orb:hover .orb-swirl,
.assistant-orb:hover .orb-halo,
.assistant-orb.is-dragging .orb-swirl,
.assistant-orb.is-dragging .orb-halo {
  animation-play-state: running;
}

.assistant-orb {
  transition: transform 200ms ease-out;
}
.assistant-orb:hover {
  transform: translateY(-2px);
}
.assistant-orb:active {
  transform: scale(0.95);
}
.assistant-orb.is-dragging {
  transform: scale(1.08);
}
.assistant-orb.is-dragging .orb-halo {
  opacity: 0.6;
}

@keyframes orb-turn {
  to {
    transform: rotate(1turn);
  }
}
</style>
