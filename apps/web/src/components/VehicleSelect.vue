<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  CheckIcon,
  ChevronUpDownIcon,
  TruckIcon,
  XMarkIcon,
} from "@fuelguard/ui/icons";
import { ref, computed, watch, nextTick } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, size } from "@floating-ui/vue";
import type { Vehicle } from "@fuelguard/shared";

const props = withDefaults(
  defineProps<{
    modelValue: string | undefined;
    vehicles: Vehicle[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "All vehicles", disabled: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string | undefined] }>();

const open = ref(false);
const search = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);

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

const selectedVehicle = computed(() =>
  props.modelValue ? props.vehicles.find((v) => v.id === props.modelValue) ?? null : null,
);

const filteredVehicles = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.vehicles;
  return props.vehicles.filter(
    (v) =>
      v.unit_number.toLowerCase().includes(q) ||
      (v.make ?? "").toLowerCase().includes(q) ||
      (v.model ?? "").toLowerCase().includes(q) ||
      (v.plate ?? "").toLowerCase().includes(q),
  );
});

const isUnset = computed(() => !props.modelValue);

function openDropdown() {
  if (props.disabled) return;
  search.value = "";
  open.value = true;
  nextTick(() => inputRef.value?.focus());
}

function closeDropdown() {
  open.value = false;
  search.value = "";
}

function select(id: string | undefined) {
  emit("update:modelValue", id);
  closeDropdown();
}

function clear(e: Event) {
  e.stopPropagation();
  emit("update:modelValue", undefined);
  search.value = "";
  open.value = false;
}

function onInputKeydown(e: Event) {
  const ke = e as unknown as { key: string };
  if (ke.key === "Escape") closeDropdown();
  if (ke.key === "Tab") closeDropdown();
}

watch(
  () => props.modelValue,
  () => {
    if (!open.value) search.value = "";
  },
);
</script>

<template>
  <div ref="triggerRef" class="relative min-w-[10rem]">
    <!-- Trigger / input wrapper -->
    <!-- The input/clear controls own keyboard interaction; this wrapper expands their pointer hit area. -->
    <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
    <div
      class="flex w-full items-center gap-1.5 rounded-control border-0 bg-surface px-2.5 py-1.5 text-sm ring-1 ring-inset transition-shadow"
      :class="[
        open ? 'ring-2 ring-brand-600' : 'ring-edge-control',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ]"
      @click="openDropdown"
    >
      <AppIcon :icon="TruckIcon" class="size-4 shrink-0 text-ink-tertiary" />

      <input
        v-if="open"
        ref="inputRef"
        v-model="search"
        type="text"
        :placeholder="placeholder"
        class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-disabled"
        @keydown="onInputKeydown"
        @click.stop
      />
      <span
        v-else
        class="min-w-0 flex-1 truncate text-sm"
        :class="isUnset ? 'text-ink-tertiary' : 'text-ink'"
      >
        {{ isUnset ? placeholder : selectedVehicle?.unit_number }}
      </span>

      <button
        v-if="!isUnset && !open"
        type="button"
        class="ml-auto shrink-0 text-ink-tertiary hover:text-ink-secondary"
        aria-label="Clear vehicle filter"
        @click="clear"
      >
        <AppIcon :icon="XMarkIcon" class="size-4" />
      </button>
      <AppIcon v-else :icon="ChevronUpDownIcon" class="ml-auto size-4 shrink-0 text-ink-tertiary" />
    </div>

    <!-- Dropdown -->
    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-[9998]" aria-label="Close vehicle options" @click="closeDropdown" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] overflow-hidden rounded-control bg-surface shadow-overlay ring-1 ring-edge-subtle"
        >
          <!-- "All vehicles" option -->
          <button
            type="button"
            class="flex w-full items-center px-3 py-2 text-left text-sm"
            :class="isUnset ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-muted hover:bg-surface-subtle'"
            @click="select(undefined)"
          >
            <AppIcon
:icon="CheckIcon"
              class="mr-2 size-4 shrink-0 text-brand-600 transition-opacity"
              :class="isUnset ? 'opacity-100' : 'opacity-0'"
            />
            All vehicles
          </button>

          <div class="max-h-56 overflow-y-auto border-t border-edge-subtle">
            <!-- No results -->
            <p v-if="filteredVehicles.length === 0" class="px-3 py-2 text-sm text-ink-tertiary italic">
              No vehicles match "{{ search }}"
            </p>

            <button
              v-for="v in filteredVehicles"
              :key="v.id"
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              :class="
                v.id === modelValue
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink hover:bg-surface-subtle'
              "
              @click="select(v.id)"
            >
              <AppIcon
:icon="CheckIcon"
                class="size-4 shrink-0 text-brand-600 transition-opacity"
                :class="v.id === modelValue ? 'opacity-100' : 'opacity-0'"
              />
              <span class="font-medium">{{ v.unit_number }}</span>
              <span v-if="v.make || v.model" class="truncate text-xs text-ink-tertiary">
                {{ [v.year, v.make, v.model].filter(Boolean).join(" ") }}
              </span>
            </button>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
