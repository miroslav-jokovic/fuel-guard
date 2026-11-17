<script setup lang="ts">
import { computed } from "vue";
import { feedImageOf, motionOpinion, type AdsCreativeView } from "@silvicom/shared";

/**
 * An ad's video on the review screen (V4; D-AD12: a person approves what they have seen), for one language, beside
 * that language's images. Shown only for an ad its plan asked to move:
 *   · the video was made → a player. Its poster is the ad's own feed still, which is the video's last frame and
 *     the thumbnail the publisher gives Meta (`publisherAds.ts`); nothing loads until a person presses play
 *     (`preload="none"`), so a campaign of twelve ads does not fetch twelve videos to be looked over;
 *   · it was asked for and could not be made → one sentence saying so and why, in compose's words. The ad is then
 *     the still above it, and approving it approves a picture — which the sentence says, so nobody approves a
 *     video they were never shown.
 * A still (no `checks.motion`) shows nothing. The video has a silent sound track (Q-APX15), and says so. It is
 * played `muted` for the same reason: there is no speech to caption — every word of the ad is drawn in the picture —
 * and `muted` is how the accessibility rule (`media-has-caption`) is told that. The day a video carries a voice
 * (the driver clip, Q-APX5), it gets a captions track and loses `muted`.
 */
const props = defineProps<{ creative: AdsCreativeView; language: "en" | "es" }>();
const opinion = computed(() => motionOpinion(props.creative.checks && typeof props.creative.checks === "object" ? (props.creative.checks as Record<string, unknown>).motion : undefined));
const file = computed(() => props.creative.motion?.files.find((f) => f.language === props.language) ?? null);
const poster = computed(() => feedImageOf(props.creative.assets, props.language)?.url ?? undefined);
const seconds = computed(() => (file.value ? (file.value.duration_ms / 1000).toFixed(1) : null));
</script>

<template>
  <section v-if="file || opinion" class="space-y-1" :aria-label="`The ad's video, ${language.toUpperCase()}`" :data-test="`motion-${language}`">
    <template v-if="file">
      <h4 class="text-xs font-semibold text-ink">Video · {{ seconds }} s · no sound</h4>
      <video v-if="file.url" :src="file.url" :poster="poster" controls playsinline muted preload="none" class="w-full max-w-xs rounded-detail" :aria-label="`Ad video, ${language.toUpperCase()}`" data-test="ad-video" />
      <p v-else class="text-sm text-ink-muted" data-test="no-video">The video could not be loaded.</p>
      <p class="text-xs text-ink-muted" data-test="motion-note">This ad is published as this video. The picture above is its last frame and its thumbnail.</p>
    </template>
    <p v-else-if="opinion && !opinion.made" class="text-sm text-ink-muted" data-test="motion-not-made">
      The plan asked for a video here and none was made, so this ad is the picture above: {{ opinion.why }}.
    </p>
    <p v-else class="text-sm text-ink-muted" data-test="no-video">The video for this language could not be found.</p>
  </section>
</template>
