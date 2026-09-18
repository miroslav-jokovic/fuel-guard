<script setup lang="ts">
import {
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_CAPTURE_SLOT_LABELS,
  APPLICATION_FILLING_MINUTES,
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_LABELS,
  APPLICATION_SECTION_MINUTES,
} from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * What the whole thing involves, before any of it is asked (B7).
 *
 * ── THE PROBLEM THIS IS FOR ───────────────────────────────────────────────────────────────────
 * The length of this application used to be discovered by walking it. Nine in ten are filled in on a
 * phone, often in the minutes somebody has while they are waiting for something else — and a driver
 * who starts with four minutes to spare and meets §391.21(b)(11)'s ten years of driving history
 * abandons it. The answers they did type are then worth nothing to anybody: an application that is
 * 40% filled in is not 40% of a hire. So the first thing on the link is the decision it is asking
 * them to make — start now, or this evening — with the two facts a person needs in order to make it:
 * how long it takes, and what they will have to go and find.
 *
 * ── WHY IT SITS AHEAD OF THE 7001(c) CONSENT, WITHOUT DISTURBING D-APP5 ───────────────────────
 * A4's ruling is that nothing is ASKED and nothing is WRITTEN before the consent, because §390.32(d)
 * makes an electronic §391.21 application conditional on proof of that agreement. This screen asks
 * nothing, writes nothing and has no field on it — pressing the button changes a boolean in this tab
 * and nothing else — so the consent is still the first thing the driver DOES, and the permissions it
 * describes are still the first thing the page collects. Putting it after the consent and the four
 * signatures would set expectations for the form only, and the part that surprises people most is
 * that a carrier's permissions are signed before the form at all.
 *
 * ── AND WHY NOTHING ABOUT IT IS REMEMBERED ────────────────────────────────────────────────────
 * "Has this driver seen the expectations screen?" is not worth a column, a write on an
 * unauthenticated route, or a second source of truth about where somebody is. `ApplyPage` derives it
 * from what the link already returns — a consent, a signed permission, or a saved draft all mean the
 * same thing, that this person has started — so somebody who opens the link twice without doing
 * anything is told the same thing twice, which is the right answer to having done nothing.
 *
 * Every number on this screen is the catalogue's: the screens and their estimates come from
 * `APPLICATION_SECTION_MINUTES`, and the documents from `APPLICATION_CAPTURE_REQUESTED` — the same
 * lists the wizard and the capture screen render, so this cannot promise a screen that is not there
 * or a photograph nobody is asked for.
 */
defineProps<{
  carrier: string;
  /**
   * Are the carrier's permissions actually going to be asked for on this link?
   *
   * Passed in rather than worked out here: `ApplyPage` owns that question already (the ceremony is
   * skipped entirely while any instrument's wording is draft, because the server refuses those
   * signatures), and a screen that promised a step the page then skipped would be a worse lie than
   * saying nothing at all.
   */
  signFirst: boolean;
}>();
const emit = defineEmits<{ start: [] }>();

const copy = APPLY_COPY.expectations;
const minutesOf = APPLY_COPY.progress.minutes;

const steps = APPLICATION_FILLING_SECTIONS.map((section) => ({
  section,
  label: APPLICATION_SECTION_LABELS[section],
  minutes: APPLICATION_SECTION_MINUTES[section],
}));
const photographs = APPLICATION_CAPTURE_REQUESTED.map((slot) => APPLICATION_CAPTURE_SLOT_LABELS[slot]);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.lead(carrier) }}</p>
    </div>

    <!-- The one sentence this screen exists for, so it is the thing that is read if nothing else is. -->
    <p class="text-base font-semibold text-ink">
      {{ copy.howLong(steps.length, APPLICATION_FILLING_MINUTES) }}
    </p>

    <div class="space-y-2">
      <h2 class="text-sm font-semibold text-ink">{{ copy.stepsHeading }}</h2>
      <!-- The same eight rows the progress list shows, with the same estimates, before they mean
           anything to the driver yet. Not buttons: there is nowhere to go from here except forward,
           and a row that looks tappable and is not is worse than a row that does not. -->
      <ul class="divide-y divide-edge rounded-surface ring-1 ring-inset ring-edge">
        <li
          v-for="step in steps"
          :key="step.section"
          class="flex items-baseline justify-between gap-3 px-3 py-2"
        >
          <span class="text-sm text-ink">{{ step.label }}</span>
          <span class="shrink-0 text-2xs tabular-nums text-ink-muted">{{ minutesOf(step.minutes) }}</span>
        </li>
      </ul>
    </div>

    <div class="space-y-2">
      <h2 class="text-sm font-semibold text-ink">{{ copy.needHeading }}</h2>
      <ul class="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
        <li v-for="need in copy.needs" :key="need">{{ need }}</li>
        <li>
          {{ copy.photographHeading }}
          <ul class="mt-1 list-disc space-y-1 pl-5">
            <li v-for="document in photographs" :key="document">{{ document }}</li>
          </ul>
        </li>
      </ul>
    </div>

    <div class="space-y-2 text-sm text-ink-secondary">
      <p v-if="signFirst">{{ copy.signFirst(carrier) }}</p>
      <p>{{ copy.afterwards(carrier) }}</p>
      <p>{{ copy.savesItself }}</p>
    </div>

    <div class="flex justify-end">
      <BaseButton variant="primary" @click="emit('start')">{{ copy.start }}</BaseButton>
    </div>
  </section>
</template>
