<script setup lang="ts">
import { ref, computed } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, size } from "@floating-ui/vue";
import { ChevronUpDownIcon, CheckIcon } from "@heroicons/vue/20/solid";

type OptionValue = string | number | undefined | null;

export interface SelectOption {
  value: OptionValue;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: OptionValue;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "Select…", disabled: false },
);

const emit = defineEmits<{ "update:modelValue": [value: OptionValue] }>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-start",
  middleware: [
    offset(4),
    flip(),
    shift({ padding: 8 }),
    size({
      apply({ rects, elements }) {
        Object.assign(elements.floating.style, {
          minWidth: `${rects.reference.width}px`,
        });
      },
    }),
  ],
  whileElementsMounted: autoUpdate,
});

const selectedLabel = computed(() => {
  const match = props.options.find((o) => o.value === props.modelValue);
  return match?.label ?? props.placeholder;
});

const isUnset = computed(() => props.modelValue === undefined || props.modelValue === null || props.modelValue === "");

function select(val: OptionValue) {
  emit("update:modelValue", val);
  open.value = false;
}
</script>

<template>
  <div class="relative min-w-[8rem]">
    <button
      ref="triggerRef"
      type="button"
      :disabled="disabled"
      class="flex w-full items-center justify-between gap-2 rounded-md border-0 bg-surface px-3 py-1.5 text-left text-sm ring-1 ring-inset ring-edge-strong focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      @click="open = !open"
    >
      <span class="truncate" :class="isUnset ? 'text-ink-subtle' : 'text-ink'">
        {{ selectedLabel }}
      </span>
      <ChevronUpDownIcon class="size-4 shrink-0 text-ink-subtle" />
    </button>

    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-[9998]" @click="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] max-h-60 overflow-auto rounded-md bg-surface py-1 text-sm shadow-lg ring-1 ring-edge"
        >
          <button
            v-for="opt in options"
            :key="String(opt.value)"
            type="button"
            class="flex w-full items-center px-3 py-2 text-left"
            :class="
              opt.value === modelValue
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-ink hover:bg-surface-subtle'
            "
            @click="select(opt.value)"
          >
            <CheckIcon
              class="mr-2 size-4 shrink-0 text-brand-600 transition-opacity"
              :class="opt.value === modelValue ? 'opacity-100' : 'opacity-0'"
            />
            {{ opt.label }}
          </button>
        </div>
      </template>
    </Teleport>
  </div>
</template>
