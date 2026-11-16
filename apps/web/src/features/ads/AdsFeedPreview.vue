<script setup lang="ts">
import { computed } from "vue";
import { feedImageOf, feedTextNotes, type AdsCreativeView } from "@silvicom/shared";
import { LANGUAGE_LABEL } from "./adsWordChoice";

/**
 * One ad as a Facebook feed post, in one language (ADS-PLATFORM-V2-PLAN V3 "preview as shown"): the text above the
 * picture, the picture, the headline under it and the button — the four things Meta is handed, and nothing else.
 *
 * ── A DRAWING, AND IT SAYS SO ────────────────────────────────────────────────────────────────────
 * Meta's real preview comes from Meta, for an ad on an ad account; there is none yet. This is our drawing of the
 * order Meta shows the parts in. It invents nothing Meta decides: the whole text is shown (neither of Meta's pages
 * says where it cuts), and what runs past Meta's own recommendation is said in a sentence (`feedTextNotes`). Which
 * texts and which image is shared's (`platformText`, `feedImageOf`), the functions the publisher sends them with.
 *
 * No Instagram story frame: an ad is sent with its feed image only (Q-AD29), and Meta's page does not say how a
 * 4:5 image is shown in Stories, so a story frame would be a guess.
 */
const props = defineProps<{ creative: AdsCreativeView; language: "en" | "es" }>();

const text = computed(() => props.creative.platform_text?.[props.language] ?? null);
const image = computed(() => feedImageOf(props.creative.assets, props.language));
const notes = computed(() => (text.value ? feedTextNotes(text.value) : []));
</script>

<template>
  <section v-if="text" class="space-y-2" :aria-label="`The ad in a Facebook feed, ${LANGUAGE_LABEL[language]}`" :data-test="`feed-preview-${language}`">
    <div class="mx-auto max-w-sm overflow-hidden rounded-detail bg-surface ring-1 ring-edge">
      <div class="flex items-center gap-2 px-3 pt-3">
        <span class="size-8 shrink-0 rounded-full bg-surface-muted" aria-hidden="true" />
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-ink">Your Facebook Page</p>
          <p class="text-xs text-ink-muted">Sponsored</p>
        </div>
      </div>
      <p class="whitespace-pre-line px-3 py-2 text-sm text-ink" data-test="feed-primary">{{ text.primary_text }}</p>
      <img v-if="image?.url" :src="image.url" :alt="`The ad's picture, ${image.format}, ${LANGUAGE_LABEL[language]}`" class="w-full" data-test="feed-image" />
      <p v-else class="px-3 py-6 text-center text-sm text-ink-muted" data-test="feed-no-image">The picture could not be loaded.</p>
      <div class="flex items-center justify-between gap-3 bg-surface-muted px-3 py-2">
        <p class="min-w-0 text-sm font-semibold text-ink" data-test="feed-headline">{{ text.headline }}</p>
        <span class="shrink-0 rounded-control px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-edge-control">Apply now</span>
      </div>
    </div>
    <p v-for="n in notes" :key="n" class="text-xs text-ink-muted" data-test="feed-note">{{ n }}</p>
  </section>
</template>
