<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SWIPE_NOTE_MAX } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, AppTextarea } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useSaveSwipe } from "./useAdsSwipe";

/**
 * Save one thing to the swipe file (V2r, D-AD36): a competitor's job page by its address, or a picture of a
 * competitor's ad. A person chooses every source the Researcher reads — it never searches and never follows a
 * link — so this drawer is the only way a source enters. The API holds the address to https with no user name or
 * password; its refusal names what to change and stays on the form.
 */
const props = defineProps<{ open: boolean; kind: "page" | "picture" }>();
const emit = defineEmits<{ close: [] }>();

const FORM = "ads-swipe-form";
const IMAGES = "image/png,image/jpeg,image/webp";

const toast = useToastStore();
const save = useSaveSwipe();
const url = ref("");
const note = ref("");
const file = ref<File | null>(null);
const refusal = ref<string | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  url.value = "";
  note.value = "";
  file.value = null;
  refusal.value = null;
}, { immediate: true });

const title = computed(() => (props.kind === "page" ? "Save a job page" : "Save an ad picture"));
const noteOrNull = (): string | null => note.value.trim() || null;

/** The form's own refusals, before any call: the same limits the API's schema holds (`adsSwipePageSaveSchema`). */
function localRefusal(): string | null {
  if (note.value.trim().length > SWIPE_NOTE_MAX) return `Keep the note to ${SWIPE_NOTE_MAX} characters.`;
  if (props.kind === "page" && !/^https:\/\/\S+$/i.test(url.value.trim())) return "Give the page's full https address.";
  if (props.kind === "picture" && !file.value) return "Choose the picture to save.";
  return null;
}

async function submit(): Promise<void> {
  refusal.value = localRefusal();
  if (refusal.value) return;
  try {
    await save.mutateAsync(props.kind === "page"
      ? { kind: "page", save: { url: url.value.trim(), note: noteOrNull() } }
      : { kind: "picture", file: file.value!, note: noteOrNull() });
    toast.success("Saved. It is being read now.");
    emit("close");
  } catch (e) {
    refusal.value = e instanceof Error ? e.message : "It was not saved.";
  }
}
</script>

<template>
  <SlideOver :open="open" :title="title" description="The Researcher reads it, and a campaign's plan may cite what it says." @close="emit('close')">
    <form :id="FORM" class="space-y-6" novalidate data-test="swipe-form" @submit.prevent="submit">
      <FormField v-if="kind === 'page'" v-slot="{ id }" label="Page address" hint="The full address, starting with https://" required>
        <BaseInput :id="id" v-model="url" type="url" inputmode="url" autocomplete="off" data-test="swipe-url" />
      </FormField>
      <div v-else class="space-y-2">
        <p v-if="file" class="text-sm text-ink-muted" data-test="swipe-file">
          {{ file.name }}
          <BaseButton @click="file = null">Remove</BaseButton>
        </p>
        <FileDropzone v-else :accept="IMAGES" :busy="save.isPending.value" busy-label="Uploading…" label="Drop the ad picture here" hint="PNG, JPEG or WebP. A screenshot of the ad is fine." @files="(f) => (file = f[0] ?? null)" />
      </div>
      <FormField v-slot="{ id }" label="Note" :hint="`Optional. Where you saw it, or why it is worth reading. Up to ${SWIPE_NOTE_MAX} characters.`">
        <AppTextarea :id="id" v-model="note" :rows="2" data-test="swipe-note" />
      </FormField>
      <AppCallout v-if="refusal" tone="danger" data-test="swipe-refusal">{{ refusal }}</AppCallout>
    </form>
    <template #footer>
      <BaseButton :disabled="save.isPending.value" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" type="submit" :form="FORM" :disabled="save.isPending.value" data-test="save-swipe">Save</BaseButton>
    </template>
  </SlideOver>
</template>
