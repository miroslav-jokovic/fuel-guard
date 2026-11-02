<script setup lang="ts">
import { ref } from "vue";
import { AppIconButton } from "@silvicom/ui";
import type { Icon } from "@silvicom/ui/icons";

/**
 * An icon button that opens the browser's file picker (office chat's paperclip, CH7, 2026-11-01).
 *
 * `FileDropzone` is the drop TARGET a page gives a whole panel to; a composer needs only the button. The
 * <input type="file"> lives here, in a shared component, because `lint:ui-adoption` refuses raw inputs in
 * pages and features — and the input is hidden: a native file input cannot be styled, so the visible
 * control is `AppIconButton` and the input is clicked through it. The value is cleared after each pick,
 * so picking the same file again (after removing it) still fires.
 */
withDefaults(defineProps<{ icon: Icon; label: string; accept?: string; multiple?: boolean; disabled?: boolean }>(), {
  accept: undefined,
  multiple: true,
  disabled: false,
});
const emit = defineEmits<{ files: [files: File[]] }>();
const input = ref<HTMLInputElement | null>(null);

function picked(e: Event) {
  const el = e.target as HTMLInputElement;
  const files = [...(el.files ?? [])];
  el.value = "";
  if (files.length) emit("files", files);
}
</script>

<template>
  <span class="inline-flex">
    <input ref="input" type="file" class="sr-only" tabindex="-1" aria-hidden="true" :accept="accept" :multiple="multiple" @change="picked" />
    <AppIconButton :icon="icon" :label="label" size="sm" :disabled="disabled" @click="input?.click()" />
  </span>
</template>
