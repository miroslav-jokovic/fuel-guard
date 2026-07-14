<script setup lang="ts">
import { ref } from "vue";
import { ArrowUpTrayIcon } from "@heroicons/vue/24/outline";

/**
 * Drag-and-drop upload area (click / Enter / Space to browse). Emits the
 * chosen File list; the parent owns parsing and validation. `accept` is a
 * comma list of extensions used for both the picker and a drop-time filter.
 */
const props = withDefaults(
  defineProps<{
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    /** Headline, e.g. "Drag & drop your EFS reports here" */
    label?: string;
    hint?: string;
    busy?: boolean;
    busyLabel?: string;
  }>(),
  {
    accept: undefined,
    multiple: false,
    disabled: false,
    label: "Drag & drop files here",
    hint: undefined,
    busy: false,
    busyLabel: "Reading…",
  },
);
const emit = defineEmits<{ files: [files: File[]] }>();

const inputRef = ref<HTMLInputElement | null>(null);
const dragging = ref(0); // counter — dragenter/leave fire for every child

const exts = () =>
  (props.accept ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.startsWith("."));

function acceptFile(f: File): boolean {
  const allowed = exts();
  if (!allowed.length) return true;
  return allowed.some((e) => f.name.toLowerCase().endsWith(e));
}

function handle(list: FileList | null | undefined) {
  if (!list || props.disabled || props.busy) return;
  const files = Array.from(list).filter(acceptFile);
  const rejected = list.length - files.length;
  if (files.length) emit("files", props.multiple ? files : files.slice(0, 1));
  if (rejected > 0 && files.length === 0) {
    // Nothing usable — nudge via the hint line; parent toasts handle deeper validation.
    shake.value = true;
    setTimeout(() => (shake.value = false), 400);
  }
}
const shake = ref(false);

function onDrop(e: DragEvent) {
  dragging.value = 0;
  handle(e.dataTransfer?.files);
}
function onChange(e: Event) {
  const input = e.target as HTMLInputElement;
  handle(input.files);
  input.value = "";
}
function browse() {
  if (!props.disabled && !props.busy) inputRef.value?.click();
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    :class="[
      dragging > 0
        ? 'border-brand-400 bg-brand-50/50'
        : 'border-edge-strong bg-surface hover:border-ink-subtle',
      disabled || busy ? 'pointer-events-none opacity-60' : 'cursor-pointer',
      shake ? 'border-danger-400' : '',
    ]"
    :aria-disabled="disabled || busy"
    @click="browse"
    @keydown.enter.prevent="browse"
    @keydown.space.prevent="browse"
    @dragenter.prevent="dragging++"
    @dragover.prevent
    @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
    @drop.prevent="onDrop"
  >
    <ArrowUpTrayIcon
      class="mx-auto size-10 transition-colors"
      :class="dragging > 0 ? 'text-brand-500' : 'text-ink-subtle'"
      aria-hidden="true"
    />
    <p class="mt-4 text-sm font-medium text-ink">
      {{ busy ? busyLabel : label }}
    </p>
    <p class="mt-1 text-sm text-ink-muted">
      or <span class="font-semibold text-brand-600">browse files</span>
    </p>
    <p v-if="hint" class="mt-2 text-xs text-ink-subtle">{{ hint }}</p>
    <input
      ref="inputRef"
      type="file"
      class="sr-only"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled || busy"
      tabindex="-1"
      @change="onChange"
    />
  </div>
</template>
