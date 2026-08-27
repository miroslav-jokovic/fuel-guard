<script setup lang="ts">
import { ref, watch } from "vue";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
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
    <ul v-if="open" class="absolute z-sticky-lead mt-1 max-h-60 w-full overflow-auto rounded-control bg-surface py-1 text-sm shadow-overlay ring-1 ring-edge-subtle">
      <li
        v-for="(s, i) in suggestions"
        :key="i"
      >
        <BaseButton
          type="button"
          variant="ghost"
          block
          class="justify-start truncate px-3 text-left font-normal"
          @mousedown.prevent="pick(s)"
          @click="pick(s)"
        >
          {{ s.label }}
        </BaseButton>
      </li>
    </ul>
  </div>
</template>
