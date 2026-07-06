<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, size } from "@floating-ui/vue";
import { ChevronUpDownIcon, CheckIcon, XMarkIcon, TruckIcon } from "@heroicons/vue/20/solid";
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
    <div
      class="flex w-full items-center gap-1.5 rounded-md border-0 bg-white px-2.5 py-1.5 text-sm ring-1 ring-inset transition-shadow"
      :class="[
        open ? 'ring-2 ring-indigo-600' : 'ring-gray-300',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ]"
      @click="openDropdown"
    >
      <TruckIcon class="size-4 shrink-0 text-gray-400" />

      <input
        v-if="open"
        ref="inputRef"
        v-model="search"
        type="text"
        :placeholder="placeholder"
        class="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
        @keydown="onInputKeydown"
        @click.stop
      />
      <span
        v-else
        class="min-w-0 flex-1 truncate text-sm"
        :class="isUnset ? 'text-gray-400' : 'text-gray-900'"
      >
        {{ isUnset ? placeholder : selectedVehicle?.unit_number }}
      </span>

      <button
        v-if="!isUnset && !open"
        type="button"
        class="ml-auto shrink-0 text-gray-400 hover:text-gray-600"
        aria-label="Clear vehicle filter"
        @click="clear"
      >
        <XMarkIcon class="size-4" />
      </button>
      <ChevronUpDownIcon v-else class="ml-auto size-4 shrink-0 text-gray-400" />
    </div>

    <!-- Dropdown -->
    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-[9998]" @click="closeDropdown" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black/5"
        >
          <!-- "All vehicles" option -->
          <button
            type="button"
            class="flex w-full items-center px-3 py-2 text-left text-sm"
            :class="isUnset ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-gray-500 hover:bg-gray-50'"
            @click="select(undefined)"
          >
            <CheckIcon
              class="mr-2 size-4 shrink-0 text-indigo-600 transition-opacity"
              :class="isUnset ? 'opacity-100' : 'opacity-0'"
            />
            All vehicles
          </button>

          <div class="max-h-56 overflow-y-auto border-t border-gray-100">
            <!-- No results -->
            <p v-if="filteredVehicles.length === 0" class="px-3 py-2 text-sm text-gray-400 italic">
              No vehicles match "{{ search }}"
            </p>

            <button
              v-for="v in filteredVehicles"
              :key="v.id"
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              :class="
                v.id === modelValue
                  ? 'bg-indigo-50 font-medium text-indigo-700'
                  : 'text-gray-900 hover:bg-gray-50'
              "
              @click="select(v.id)"
            >
              <CheckIcon
                class="size-4 shrink-0 text-indigo-600 transition-opacity"
                :class="v.id === modelValue ? 'opacity-100' : 'opacity-0'"
              />
              <span class="font-medium">{{ v.unit_number }}</span>
              <span v-if="v.make || v.model" class="truncate text-xs text-gray-400">
                {{ [v.year, v.make, v.model].filter(Boolean).join(" ") }}
              </span>
            </button>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
