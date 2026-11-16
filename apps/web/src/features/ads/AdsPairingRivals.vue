<script setup lang="ts">
import { computed, ref } from "vue";
import { FINISHED_AD_MAX_TOTAL, PAIRING_TIE_MARGIN, adRivals, type AdPairingsView, type AdRival } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * The pictures and words one ad was chosen from (ADS-PLATFORM-V2-PLAN V3 "make many, show few"; Q-APX7, Q-APX9):
 * every pairing in the order it was ranked, the one that became the ad marked, and the pictures that were made and
 * not used with why. A reviewer who prefers another pairing uses it: the ad is remade on that picture with those
 * words, and no picture is made again (the door replays the one kept).
 *
 * What is said about a score is `adRivals`'s (shared), so this screen states nothing the ranking did not. In
 * particular a pairing within the judge's own movement of the best (`PAIRING_TIE_MARGIN`, measured 2026-11-16) is
 * called "as good", never "second": a one-point gap is not a difference, and a person must not be told it is.
 */
const props = defineProps<{ pairings: AdPairingsView; canChoose: boolean; busy: boolean }>();
const emit = defineEmits<{ pick: [choice: { picture: number; words: number }] }>();

const shown = computed(() => adRivals(props.pairings));
const made = computed(() => props.pairings.pictures.length);
/** The pairing a person is about to use, until they confirm or cancel: using one rejects the ad shown and remakes it. */
const picking = ref<AdRival | null>(null);
/** By picture and words, never by identity: what `picking` holds is Vue's proxy of the rival, which is not `===` to it. */
const isPicked = (r: AdRival) => picking.value?.picture === r.picture && picking.value.words === r.words;
const score = (r: AdRival) => (r.total === null ? "Not scored" : `${r.total} of ${FINISHED_AD_MAX_TOTAL}`);
const margin = `within ${PAIRING_TIE_MARGIN} point of the best score`;
</script>

<template>
  <details class="rounded-detail bg-surface-muted p-3 text-sm" data-test="rivals">
    <summary class="cursor-pointer text-ink" data-test="rivals-summary">
      Chosen from {{ made }} pictures: {{ shown.rivals.length }} pairings of a picture and words.
      <template v-if="shown.judged">Ranked by the finished-ad judge; the first became the ad.</template>
      <template v-else>Not ranked: the finished-ad judge did not run, so the first picture with the first copy became the ad.</template>
    </summary>
    <ul class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="The pairings this ad was chosen from, best first">
      <li v-for="r in shown.rivals" :key="`${r.picture}-${r.words}`" class="space-y-1" :data-test="`rival-${r.rank}`">
        <img v-if="r.url" :src="r.url" :alt="`Picture ${r.picture} with copy ${r.words + 1}`" class="w-full rounded-detail" data-test="rival-image" />
        <p v-else class="text-xs text-ink-muted" data-test="rival-no-image">The image could not be loaded.</p>
        <p class="text-xs text-ink">Picture {{ r.picture }} · copy #{{ r.words + 1 }}</p>
        <p class="text-xs text-ink-muted" data-test="rival-score">{{ score(r) }}</p>
        <span v-if="r.chosen" :class="[BADGE_BASE, toneClass('success')]" data-test="rival-chosen">This is the ad</span>
        <span v-else-if="r.asGood" :class="[BADGE_BASE, toneClass('info')]" :title="`Scored ${margin}.`" data-test="rival-as-good">As good</span>
        <span v-if="isPicked(r)" :class="[BADGE_BASE, toneClass('warning')]" data-test="rival-picked">You picked this one</span>
        <div v-if="canChoose && !r.chosen && picking === null">
          <BaseButton :disabled="busy" :data-test="`rival-use-${r.rank}`" @click="picking = r">Use this one</BaseButton>
        </div>
      </li>
    </ul>
    <p v-if="shown.judged && shown.rivals.some((r) => r.asGood && !r.chosen)" class="mt-2 text-xs text-ink-muted" data-test="rivals-margin">
      "As good" means scored {{ margin }}. The judge moves that much when it is asked about the same ad twice, so among those the copy ranked best comes first.
    </p>
    <p v-for="u in shown.unused" :key="u.picture" class="mt-2 text-xs text-ink-muted" data-test="rival-unused">Picture {{ u.picture }} was made and not used: {{ u.reason }}</p>
    <div v-if="picking" class="mt-3 space-y-2 rounded-detail p-3 ring-1 ring-edge" data-test="rival-confirm">
      <p class="text-sm text-ink">
        The ad shown is replaced by picture {{ picking.picture }} with copy #{{ picking.words + 1 }}. The picture is not made again; the new ad is checked and comes back here for review.
      </p>
      <div class="flex justify-end gap-2">
        <BaseButton :disabled="busy" data-test="rival-cancel" @click="picking = null">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy" data-test="rival-confirm-use" @click="emit('pick', { picture: picking.picture, words: picking.words })">Remake the ad as this one</BaseButton>
      </div>
    </div>
  </details>
</template>
