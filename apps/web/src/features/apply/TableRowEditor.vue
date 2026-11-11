<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import FactEditor from "./FactEditor.vue";
import { fieldId } from "./fieldLabels";
import type { TableColumn } from "./applicantFactRows";

/**
 * One row of a carrier question answered as a table — education, a personal reference — typed whole
 * (APPLICATION-FIX-PLAN F3c part 2, step 4). Each column has the card's control for its kind (E8).
 *
 * It holds what was typed and says what the API refused; the card sends it. A blank is `""` and an
 * unticked box `false`, the shape the driver's own form saves (`emptyQuestionRow`), never null — a null
 * is what took the drawer to the error boundary in the F3 browser pass.
 */
const props = defineProps<{
  idPrefix: (string | number)[];
  columns: readonly TableColumn[];
  start: Record<string, unknown>;
  problem: string | null;
  pending: boolean;
  /** An existing row may be removed; a new one is only cancelled. */
  removable: boolean;
}>();
const emit = defineEmits<{ save: [row: Record<string, unknown>]; remove: []; cancel: [] }>();

type Cell = string | boolean | null | readonly string[];
const values = ref<Record<string, Cell>>(
  Object.fromEntries(props.columns.map((c) => {
    const v = props.start[c.id];
    return [c.id, c.input === "yesno" ? v === true : v === null || v === undefined ? "" : String(v)];
  })),
);
const row = computed(() =>
  Object.fromEntries(props.columns.map((c) => {
    const v = values.value[c.id];
    return [c.id, c.input === "yesno" ? v === true : v === null ? "" : String(v).trim()];
  })),
);
const changed = computed(() => JSON.stringify(row.value) !== JSON.stringify({ ...Object.fromEntries(props.columns.map((c) => [c.id, c.input === "yesno" ? props.start[c.id] === true : String(props.start[c.id] ?? "").trim()])) }));
</script>

<template>
  <div class="space-y-3" data-table-row-editor>
    <div v-for="c in columns" :key="c.id" class="space-y-1">
      <label v-if="c.input !== 'yesno'" :for="fieldId([...idPrefix, c.id])" class="block text-sm text-ink-muted">{{ c.label }}</label>
      <FactEditor :id="fieldId([...idPrefix, c.id])" v-model="values[c.id]!" :input="c.input" :label="c.label" :date-kind="c.dateKind" />
    </div>
    <p v-if="problem" class="text-sm text-danger-700" role="alert" data-table-row-problem>{{ problem }}</p>
    <div class="flex items-center justify-between gap-2">
      <BaseButton v-if="removable" size="sm" variant="danger" :disabled="pending" @click="emit('remove')">
        Remove this row
      </BaseButton>
      <span v-else />
      <div class="flex gap-2">
        <BaseButton size="sm" variant="ghost" @click="emit('cancel')">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" :disabled="pending || !changed" @click="emit('save', row)">Save</BaseButton>
      </div>
    </div>
  </div>
</template>
