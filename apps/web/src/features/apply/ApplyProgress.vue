<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { CheckIcon, ChevronDownIcon } from "@silvicom/ui/icons";
import {
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_LABELS,
  type ApplicationSection,
} from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Where the driver is, what is behind them, and what is left (APPLY-EXPERIENCE-PLAN, X4).
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────────────────────────
 * A one-pixel bar and the words "Step 4 of 9". (Eight since F4 — the certification moved to a
 * second visit, after the office has read what was sent and corrected anything it corrected.) On a phone that bar was the entire map of a nine-screen
 * federal application, and it answered only one of the three questions somebody part-way through a
 * long form actually has: how far in am I, how much is left, and can I go back and change something.
 *
 * ── WHY THE BAR IS NOT THE NAVIGATION (Q-AX1) ─────────────────────────────────────────────────
 * The obvious design makes each of the nine segments tappable. At 320px a segment is about 30px wide
 * and 6px tall, which is a third of the smallest comfortable touch target and would put nine of them
 * in a row — a driver aiming for step 3 in a moving truck hits step 4. So the bar INDICATES and the
 * list NAVIGATES: one control opens a list of full-height rows, each naming its screen and its state.
 *
 * That also settles the accessibility question rather than working around it. The bar is
 * `aria-hidden` — it repeats what the heading and the counter already say in words — and every
 * navigable thing is a real button with a real label.
 *
 * ── AND WHY FORWARD IS FENCED AT THE HIGH-WATER MARK ──────────────────────────────────────────
 * `next()` validates the screen it is leaving; jumping does not. Letting the list reach a screen the
 * driver has never been to would be a way around the validation, and they would meet the whole list
 * of what they skipped at the Send button instead of one screen at a time. Everything up to the
 * furthest screen reached is open, because they have already passed it.
 */
const props = defineProps<{
  /** Where the driver is now. */
  index: number;
  /** The furthest screen reached — the fence, not the current position. */
  furthest: number;
  /** "Saved", "Saving…", or null when there is nothing to say yet. */
  saveStatus: string | null;
}>();
const emit = defineEmits<{ goTo: [ApplicationSection] }>();

const copy = APPLY_COPY.progress;
const open = ref(false);

const steps = computed(() =>
  APPLICATION_FILLING_SECTIONS.map((section, at) => ({
    section,
    at,
    label: APPLICATION_SECTION_LABELS[section],
    state: at < props.index ? "done" : at === props.index ? "here" : "later",
    reachable: at <= props.furthest,
  })),
);

const current = computed(() => APPLICATION_SECTION_LABELS[APPLICATION_FILLING_SECTIONS[props.index]!]);
const total = APPLICATION_FILLING_SECTIONS.length;

function jump(section: ApplicationSection, reachable: boolean): void {
  if (!reachable) return;
  open.value = false;
  emit("goTo", section);
}
</script>

<template>
  <div class="space-y-3 rounded-surface bg-surface p-4 shadow-card ring-1 ring-inset ring-edge">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-base font-semibold text-ink">{{ current }}</h2>
      <BaseButton
        variant="link"
        :aria-expanded="open"
        aria-controls="apply-step-list"
        @click="open = !open"
      >
        {{ APPLY_COPY.page.stepOf(index + 1, total) }}
        <AppIcon :icon="ChevronDownIcon" :class="['ml-1 size-3 transition-transform', open && 'rotate-180']" />
      </BaseButton>
    </div>

    <!-- Decoration. The heading above and the list below carry the same facts in words, so a screen
         reader is told once rather than twice. -->
    <div class="flex gap-1" aria-hidden="true">
      <div
        v-for="step in steps"
        :key="step.section"
        class="h-1.5 flex-1 rounded-detail transition-colors"
        :class="step.state === 'later' ? 'bg-surface-muted' : 'bg-brand-500'"
      />
    </div>

    <ul v-if="open" id="apply-step-list" class="space-y-0.5 pt-1">
      <li v-for="step in steps" :key="step.section">
        <BaseButton
          variant="ghost"
          class="w-full"
          :disabled="!step.reachable"
          :aria-current="step.state === 'here' ? 'step' : undefined"
          @click="jump(step.section, step.reachable)"
        >
          <span class="flex w-full items-center gap-2 text-left">
            <!-- One 16px slot either way, so the labels line up whether or not a tick is there. -->
            <span class="flex size-4 shrink-0 items-center justify-center">
              <AppIcon v-if="step.state === 'done'" :icon="CheckIcon" class="size-4 text-brand-600" />
              <span v-else-if="step.state === 'here'" class="size-2 rounded-full bg-brand-500" />
            </span>
            <!-- ⚠ Coloured by REACHABLE, not by state. A step ahead of the driver that they have
                 already been to is an ordinary destination, not a greyed one — and a step they have
                 not reached is disabled, where `AppButton` already applies `text-ink-disabled` and
                 60% opacity. Painting `text-ink-tertiary` on the label as well stacked a mute on a
                 mute and took the contrast under the floor `lint:ui-contrast` defends. -->
            <span :class="['flex-1', step.reachable ? 'text-ink' : '']">
              {{ step.label }}
            </span>
            <!-- Hidden on a narrow screen, where it collides with a two-line label. The filled dot
                 says the same thing to a sighted reader and `aria-current="step"` to every other. -->
            <span v-if="step.state === 'here'" class="hidden text-2xs text-ink-muted sm:inline">
              {{ copy.here }}
            </span>
          </span>
        </BaseButton>
      </li>
    </ul>

    <!-- ⚠ Promoted out of 11px grey, and paired with the sentence that makes it useful. This is the
         most reassuring thing on the page for somebody filling in a federal application on cellular
         in a truck-stop car park, and it was the quietest. `aria-live` because the text changes on
         its own, with nothing the driver did to cause it. -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-edge pt-3 text-xs">
      <span class="flex items-center gap-1.5 text-ink-secondary" aria-live="polite">
        <span v-if="saveStatus" class="size-1.5 rounded-full bg-success-600" />
        {{ saveStatus ?? copy.savesItself }}
      </span>
      <span class="text-ink-tertiary">{{ copy.comeBack }}</span>
    </div>
  </div>
</template>
