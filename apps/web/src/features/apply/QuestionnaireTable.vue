<script setup lang="ts">
import { computed } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppDateField,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
} from "@silvicom/ui";
import type { QuestionnaireQuestion } from "@silvicom/shared";
import { emptyQuestionRow } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One `table` question — the shape three of the owner's four carrier questions actually are (A9).
 *
 * Stacked cards rather than a grid, and that is the phone talking. The packet is a printed table with
 * five columns; nine in ten of these forms are filled on a phone, where five columns is a horizontal
 * scroll and a horizontal scroll inside a form is where drivers stop. One card per row, labelled
 * fields inside it, and the row count is what the paper asked for.
 */
const props = defineProps<{ question: QuestionnaireQuestion; rows: Record<string, unknown>[] }>();
const emit = defineEmits<{ update: [Record<string, unknown>[]] }>();

const copy = APPLY_COPY.questions;
const columns = computed(() => props.question.columns ?? []);
const canAdd = computed(() => props.rows.length < (props.question.maxRows ?? 20));

const set = (index: number, columnId: string, value: unknown): void => {
  const next = props.rows.map((row, i) => (i === index ? { ...row, [columnId]: value } : row));
  emit("update", next);
};
const add = (): void => emit("update", [...props.rows, emptyQuestionRow(props.question)]);
const remove = (index: number): void => emit("update", props.rows.filter((_, i) => i !== index));

const options = (column: { options?: readonly string[] }) =>
  (column.options ?? []).map((o) => ({ value: o, label: o }));
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="space-y-3 rounded-surface bg-surface-muted p-4"
    >
      <div v-for="column in columns" :key="column.id" class="space-y-1">
        <label class="block text-sm text-ink-secondary" :for="`q-${question.id}-${index}-${column.id}`">
          {{ column.label }}
        </label>
        <BaseCheckbox
          v-if="column.kind === 'boolean'"
          :id="`q-${question.id}-${index}-${column.id}`"
          :model-value="row[column.id] === true"
          @update:model-value="set(index, column.id, $event)"
        />
        <BaseSelect
          v-else-if="column.kind === 'select'"
          :id="`q-${question.id}-${index}-${column.id}`"
          :model-value="(row[column.id] as string) ?? ''"
          :options="options(column)"
          @update:model-value="set(index, column.id, $event)"
        />
        <AppDateField
          v-else-if="column.kind === 'date'"
          :id="`q-${question.id}-${index}-${column.id}`"
          :model-value="(row[column.id] as string) ?? ''"
          @update:model-value="set(index, column.id, $event)"
        />
        <BaseInput
          v-else
          :id="`q-${question.id}-${index}-${column.id}`"
          :model-value="(row[column.id] as string) ?? ''"
          :inputmode="column.kind === 'number' ? 'numeric' : undefined"
          @update:model-value="set(index, column.id, $event)"
        />
      </div>
      <div class="flex justify-end">
        <BaseButton variant="ghost" @click="remove(index)">{{ copy.removeRow }}</BaseButton>
      </div>
    </div>

    <BaseButton v-if="canAdd" variant="secondary" @click="add">{{ copy.addRow }}</BaseButton>
  </div>
</template>
