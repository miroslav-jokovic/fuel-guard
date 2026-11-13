<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppTextarea } from "@silvicom/ui";
import { choiceFrom, LANGUAGE_LABEL, lineErrors, overlayErrors, slotLabel, WORD_LANGUAGES, type Words } from "./adsWordChoice";
import type { AdsCopyChoice } from "@silvicom/shared";

/**
 * The ad's words, every line in English and Spanish, to keep as they are or change (Q-ADL7). Saving remakes the ad
 * with them on the same picture; the door refuses words the opening does not support or the picture cannot hold,
 * and those refusals are shown on the line they name (`lineErrors`) or above the lines when they are about room
 * (`overlayErrors`). Nothing here checks the words itself: one rule, the door's.
 */
const props = defineProps<{ start: Words; fromCandidate: number | null; busy: boolean; refusal: unknown }>();
const emit = defineEmits<{ save: [choice: AdsCopyChoice]; cancel: [] }>();

const words = ref<Words>({ en: { ...props.start.en }, es: { ...props.start.es } });
watch(() => props.start, (s) => { words.value = { en: { ...s.en }, es: { ...s.es } }; });
const slots = computed(() => Object.keys(props.start.en));
const errors = computed(() => lineErrors(props.refusal));
const room = computed(() => overlayErrors(props.refusal));
const empty = computed(() => WORD_LANGUAGES.some((l) => slots.value.some((s) => !words.value[l][s]?.trim())));
</script>

<template>
  <section class="space-y-3 rounded-detail bg-surface-muted p-3" aria-label="The ad's words" data-test="words-editor">
    <p class="text-sm text-ink">
      {{ fromCandidate === null ? "Change any line. The ad is remade with your words on the same picture." : `Copy #${fromCandidate + 1}, as offered. Change any line, then use it: the ad is remade with these words on the same picture.` }}
    </p>
    <AppCallout v-if="room.length" tone="danger" data-test="words-room">
      These words do not fit the picture: {{ room.join("; ") }}. Shorten them.
    </AppCallout>
    <div v-for="slot in slots" :key="slot" class="grid gap-2 sm:grid-cols-2">
      <FormField v-for="l in WORD_LANGUAGES" :key="l" v-slot="{ id }" :label="`${slotLabel(slot)} (${LANGUAGE_LABEL[l]})`" :error="errors[`${l}.${slot}`]" required>
        <AppTextarea :id="id" v-model="words[l][slot]" :rows="(words[l][slot]?.length ?? 0) > 70 ? 3 : 1" :invalid="Boolean(errors[`${l}.${slot}`])" :data-test="`word-${l}-${slot}`" />
      </FormField>
    </div>
    <div class="flex justify-end gap-2">
      <BaseButton :disabled="busy" data-test="words-cancel" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="busy || empty" data-test="words-save" @click="emit('save', choiceFrom(words, fromCandidate))">Remake the ad with these words</BaseButton>
    </div>
  </section>
</template>
