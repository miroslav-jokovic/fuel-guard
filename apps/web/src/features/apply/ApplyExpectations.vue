<script setup lang="ts">
import { APPLICATION_CAPTURE_REQUESTED, APPLICATION_STAGES, APPLICATION_STAGE_MINUTES } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { APPLY_CAPTURE_TITLES, APPLY_COPY } from "@/features/apply/strings";

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
 * ── THREE STAGES, NOT EIGHT SCREENS (U1, owner's walk of 2026-11-09) ──────────────────────────
 * It listed the middle visit's eight tasks and their thirty minutes, to a driver whose first visit is
 * the license and the permissions, and whose application then arrives days later. So it now says what
 * the driver will live: three stages on one link, how long each takes, and what each waits for. The
 * stages and their estimates are shared's (`APPLICATION_STAGES`, `APPLICATION_STAGE_MINUTES`), the same
 * three the bar on every screen draws (`ApplyStages`); the documents are `APPLICATION_CAPTURE_REQUESTED`,
 * the list the capture screen renders.
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
const names = APPLY_COPY.stages.names;
const when = (text: string | ((carrier: string) => string), carrier: string): string =>
  (typeof text === "function" ? text(carrier) : text);
// §9 P9: every paper on the documents list, less "Anything else" — a thing to have to hand is named.
const photographs = APPLICATION_CAPTURE_REQUESTED.filter((slot) => slot !== "other").map((slot) => APPLY_CAPTURE_TITLES[slot]);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.lead(carrier) }}</p>
    </div>

    <!-- The one sentence this screen exists for, so it is the thing that is read if nothing else is. -->
    <p class="text-base font-semibold text-ink">{{ copy.howLong }}</p>

    <!-- Not buttons: there is nowhere to go from here except forward, and a row that looks tappable and
         is not is worse than a row that does not. -->
    <ol class="divide-y divide-edge rounded-surface ring-1 ring-inset ring-edge" data-stages>
      <li v-for="(stage, i) in APPLICATION_STAGES" :key="stage" class="space-y-1 px-3 py-3">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm font-semibold text-ink">{{ i + 1 }}. {{ names[stage] }}</span>
          <span class="shrink-0 text-xs tabular-nums text-ink-muted">{{ copy.minutes(APPLICATION_STAGE_MINUTES[stage]) }}</span>
        </div>
        <p class="text-sm text-ink-secondary">{{ copy.stage[stage].what }}</p>
        <p class="text-xs text-ink-muted">{{ when(copy.stage[stage].when, carrier) }}</p>
      </li>
    </ol>

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
      <p>{{ copy.savesItself }}</p>
    </div>

    <div class="flex justify-end">
      <BaseButton variant="primary" @click="emit('start')">{{ copy.start }}</BaseButton>
    </div>
  </section>
</template>
