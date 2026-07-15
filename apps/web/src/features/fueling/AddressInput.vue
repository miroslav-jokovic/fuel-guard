<script setup lang="ts">
import { ref, watch } from "vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import { fetchAddressSuggestions, type AddressSuggestion } from "./useFuelPlan";

const props = defineProps<{ modelValue: string; id?: string; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string]; select: [s: AddressSuggestion] }>();

const query = ref(props.modelValue);
watch(() => props.modelValue, (v) => { if (v !== query.value) query.value = v; });

const suggestions = ref<AddressSuggestion[]>([]);
const open = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function onInput(v: string) {
  query.value = v;
  emit("update:modelValue", v);
  if (timer) clearTimeout(timer);
  if (v.trim().length < 3) { suggestions.value = []; open.value = false; return; }
  timer = setTimeout(async () => {
    suggestions.value = await fetchAddressSuggestions(v);
    open.value = suggestions.value.length > 0;
  }, 300);
}
function pick(s: AddressSuggestion) {
  query.value = s.label;
  emit("update:modelValue", s.label);
  emit("select", s);
  open.value = false;
}
</script>

<template>
  <div class="relative" @focusout="open = false" @focusin="open = suggestions.length > 0">
    <BaseInput :id="id" :model-value="query" :placeholder="placeholder" autocomplete="off" @update:model-value="onInput" />
    <ul v-if="open" class="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md bg-surface py-1 text-sm shadow-lg ring-1 ring-edge">
      <li
        v-for="(s, i) in suggestions"
        :key="i"
        class="cursor-pointer truncate px-3 py-1.5 text-ink-secondary hover:bg-surface-subtle"
        @mousedown.prevent="pick(s)"
      >
        {{ s.label }}
      </li>
    </ul>
  </div>
</template>
