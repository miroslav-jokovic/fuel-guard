<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CheckIcon, ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/20/solid";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";

/**
 * Compact toolbar filter (see docs/DESIGN-SYSTEM.md §3). Renders as a small
 * trigger button — "Risk ▾" when idle, "Risk: Review ✕" with a brand tint
 * when active — and opens the standard popover with the option list.
 * Options with more than 8 entries get an inline search box automatically
 * (units, drivers, error codes). The "" option means "no filter".
 *
 *   <FilterSelect v-model="suspicion" label="Risk" :options="suspicionOptions" />
 */
interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    /** Dimension name shown on the trigger, e.g. "Risk", "Unit". */
    label: string;
    disabled?: boolean;
    /** Full-width trigger — for use inside the "Filters" popover. */
    block?: boolean;
  }>(),
  { disabled: false, block: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const query = ref("");
watch(open, (o) => {
  if (!o) query.value = "";
});

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-start",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

const selected = computed(() => props.options.find((o) => o.value !== "" && o.value === props.modelValue));
const searchable = computed(() => props.options.length > 8);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

function select(value: string) {
  emit("update:modelValue", value);
  open.value = false;
}
function clear() {
  emit("update:modelValue", "");
  open.value = false;
}
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-block'">
    <button
      ref="triggerRef"
      type="button"
      :disabled="disabled"
      class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      :class="[
        selected
          ? 'bg-brand-50/60 text-brand-800 ring-brand-600/30 hover:bg-brand-50'
          : 'bg-surface text-ink-secondary ring-edge-strong hover:bg-surface-subtle',
        block ? 'w-full justify-between' : '',
      ]"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >
      <span class="truncate" :class="block ? '' : 'max-w-[14rem]'">
        {{ label }}<template v-if="selected">: {{ selected.label }}</template>
      </span>
      <span
        v-if="selected"
        class="-mr-0.5 rounded p-0.5 text-brand-700/70 hover:bg-brand-100 hover:text-brand-800"
        role="button"
        :aria-label="`Clear ${label} filter`"
        @click.stop="clear"
      >
        <XMarkIcon class="size-3.5" aria-hidden="true" />
      </span>
      <ChevronDownIcon v-else class="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-[9998]" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] w-60 rounded-md bg-surface py-1 text-sm shadow-lg ring-1 ring-edge"
          role="listbox"
          :aria-label="`${label} options`"
        >
          <div v-if="searchable" class="border-b border-edge-subtle px-2 pb-2 pt-1.5">
            <div class="relative">
              <MagnifyingGlassIcon class="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
              <input
                v-model="query"
                type="text"
                :placeholder="`Filter ${label.toLowerCase()}s…`"
                class="block w-full rounded-md border-0 py-1 pl-7 pr-2 text-sm text-ink ring-1 ring-inset ring-edge placeholder:text-ink-subtle focus:ring-2 focus:ring-brand-600"
                @click.stop
              />
            </div>
          </div>
          <div class="max-h-64 overflow-auto py-0.5">
            <button
              v-for="opt in filtered"
              :key="opt.value"
              type="button"
              class="flex w-full items-center px-3 py-1.5 text-left"
              :class="
                opt.value === modelValue || (opt.value === '' && !selected)
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink hover:bg-surface-subtle'
              "
              role="option"
              :aria-selected="opt.value === modelValue"
              @click="select(opt.value)"
            >
              <CheckIcon
                class="mr-2 size-4 shrink-0 text-brand-600"
                :class="opt.value === modelValue || (opt.value === '' && !selected) ? 'opacity-100' : 'opacity-0'"
                aria-hidden="true"
              />
              <span class="truncate">{{ opt.label }}</span>
            </button>
            <p v-if="filtered.length === 0" class="px-3 py-2 text-ink-muted">No matches</p>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
