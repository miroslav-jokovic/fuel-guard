<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplicationRowList, PartOneFactsView } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import FactEditor from "./FactEditor.vue";
import { fieldId } from "./fieldLabels";
import { blankRow, isStringList, rowChange, rowColumns, rowNoun } from "./factRowLists";
import { useCorrectPartOne, useEditApplicationAnswer } from "./useApplicationReview";

/**
 * A new row of one of the card's lists, typed whole and saved as ONE `add_row` (F3c part 2, E2) — see
 * `factRowLists.ts` for why whole. The questions are the catalogue's columns, each with the control the
 * card corrects it with; what was typed stays on screen until the server holds it (F0, E9), so a
 * refusal (a blank city, "they said no accidents") leaves the form open with the reason under it.
 */
const props = defineProps<{
  invitationId: string;
  list: ApplicationRowList;
  /** The position the row will take — the end of the list. */
  index: number;
  revision: number;
  /** A v2 link's Part 1 — its licences are added through Part 1's correction (`rowChange`). */
  partOne?: PartOneFactsView | null;
  addresses?: unknown;
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const edit = useEditApplicationAnswer(toRef(props, "invitationId"));
const partOneEdit = useCorrectPartOne(toRef(props, "invitationId"));
const pending = computed(() => edit.isPending.value || partOneEdit.isPending.value);
const columns = computed(() => rowColumns(props.list, props.index));
const noun = computed(() => rowNoun(props.list));

type Cell = string | boolean | null | readonly string[];
/** The driver's own blank row, one value per question. */
const blank = blankRow(props.list);
const values = ref<Record<string, Cell>>(
  isStringList(props.list)
    ? { "": "" }
    : Object.fromEntries(Object.entries(blank as Record<string, unknown>).map(([k, v]) => [k, v as Cell])),
);
const problem = ref<string | null>(null);

/** A blank is `""`, never null — `fromDraftPayload` trims it (the F3 browser pass). */
const stored = (v: Cell): unknown => (v === null ? "" : v);

const row = computed<unknown>(() =>
  isStringList(props.list)
    ? String(stored(values.value[""] ?? "")).trim()
    : { ...(blank as Record<string, unknown>), ...Object.fromEntries(Object.entries(values.value).map(([k, v]) => [k, stored(v)])) },
);

async function save(): Promise<void> {
  problem.value = null;
  const change = rowChange(props.list, { add: row.value }, { revision: props.revision, partOne: props.partOne, addresses: props.addresses });
  if ("problem" in change) {
    problem.value = change.problem;
    return;
  }
  try {
    if (change.door === "draft") await edit.mutateAsync(change.edit);
    else await partOneEdit.mutateAsync(change.body);
    toast.push("success", `${noun.value} added`, "The applicant is shown it before they sign.");
    emit("close");
  } catch (e) {
    problem.value = e instanceof Error ? e.message : "That could not be added.";
  }
}
</script>

<template>
  <div class="space-y-3 rounded-surface bg-surface-muted p-3" :data-fact-adder="list">
    <p class="text-sm font-medium text-ink">New: {{ noun.toLowerCase() }}</p>
    <div v-for="c in columns" :key="c.column" class="space-y-1">
      <label v-if="c.input !== 'yesno'" :for="fieldId([list, index, c.column || 'value'])" class="block text-sm text-ink-muted">
        {{ c.label }}
      </label>
      <FactEditor
        :id="fieldId([list, index, c.column || 'value'])"
        v-model="values[c.column]!"
        :input="c.input"
        :label="c.label"
        :choices="c.choices"
      />
    </div>
    <p v-if="problem" class="text-sm text-danger-700" role="alert" data-fact-adder-problem>{{ problem }}</p>
    <div class="flex justify-end gap-2">
      <BaseButton size="sm" variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton size="sm" variant="primary" :disabled="pending" @click="save">Add</BaseButton>
    </div>
  </div>
</template>
