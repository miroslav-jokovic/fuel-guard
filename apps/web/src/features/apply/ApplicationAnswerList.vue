<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppSearchField,
  AppSelect,
} from "@silvicom/ui";
import type { ApplicationPath } from "@silvicom/shared";
import { fieldId } from "./fieldLabels";
import { matchingFields, pathKey, type EditableField } from "./editableFields";

/**
 * The office correcting answers, one at a time (F4, D-AX13).
 *
 * ── WHY EVERY ANSWER IS A ROW RATHER THAN A FORM ──────────────────────────────────────────────
 * A form saves everything at once, and this screen must not: each correction is a separate act with
 * its own before-and-after, its own audit row, and its own mark on the driver's certify screen. A
 * bulk save would collapse five corrections into one undifferentiated "the office changed it", which
 * is exactly the record §391.21(b)(12) makes worth keeping.
 *
 * ── AND WHY THE SAVE BUTTON APPEARS ONLY WHEN SOMETHING CHANGED ───────────────────────────────
 * Sixty rows with sixty live buttons is sixty chances to record an edit that changed nothing — and an
 * edit row saying `"Joliet" → "Joliet"` is noise the driver then has to read past on the screen where
 * they are being asked what moved.
 */
const props = defineProps<{
  fields: readonly EditableField[];
  /** Paths the office has already corrected, so the row can say so. */
  corrected: ReadonlySet<string>;
  pending: boolean;
}>();
const emit = defineEmits<{ save: [path: ApplicationPath, value: string | boolean] }>();

const query = ref("");
/** What the office has typed but not yet saved, keyed by path. */
const typed = reactive<Record<string, string | boolean>>({});

const shown = computed(() => matchingFields(props.fields, query.value));

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const current = (f: EditableField): string | boolean => typed[pathKey(f.path)] ?? f.value;

const changed = (f: EditableField): boolean => current(f) !== f.value;

function set(f: EditableField, value: string | boolean): void {
  typed[pathKey(f.path)] = value;
}

function save(f: EditableField): void {
  emit("save", f.path, current(f));
}

/** Put the row back to the answer on file. */
function undo(f: EditableField): void {
  delete typed[pathKey(f.path)];
}

/**
 * What was typed is kept until the SERVER holds it (F0, APPLICATION-FIX-PLAN E9).
 *
 * ⚠ This used to clear the box the moment Save was pressed, so that a refused correction would leave the
 * stored answer on screen. It did that by throwing away what the recruiter had typed — a refusal (a stale
 * revision, a value the contract rejects) cost them the whole correction. Now the typed value stays, with
 * Save still offered, and the stored answer is printed under it as "On file", which is the honesty the old
 * rule was after. A row clears itself when the refetched answer matches what was typed — the save landed.
 */
watch(
  () => props.fields,
  (fields) => {
    for (const f of fields) {
      const k = pathKey(f.path);
      if (k in typed && typed[k] === f.value) delete typed[k];
    }
  },
);
</script>

<template>
  <div class="space-y-3">
    <AppSearchField v-model="query" placeholder="Find an answer" aria-label="Find an answer" />

    <p v-if="shown.length === 0" class="text-sm text-ink-muted">
      Nothing matches “{{ query }}”. Try the words the driver saw above the box.
    </p>

    <ul class="divide-y divide-edge">
      <li v-for="f in shown" :key="pathKey(f.path)" class="py-3">
        <!-- Stacks on a phone and sits on one line from `sm` up. Recruiters read this on a desk and
             on a handset, and a two-column row at 360px is where labels start overlapping. -->
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <label :for="fieldId(f.path)" class="min-w-0 text-sm text-ink-muted sm:w-56 sm:shrink-0">
            {{ f.label }}
            <span v-if="corrected.has(pathKey(f.path))" class="block text-2xs text-ink-tertiary">
              Corrected
            </span>
          </label>

          <AppSelect
            v-if="f.kind === 'boolean'"
            :id="fieldId(f.path)"
            :model-value="current(f) === '' ? '' : current(f) ? 'yes' : 'no'"
            :options="YES_NO"
            :placeholder="current(f) === '' ? 'Not answered' : ''"
            class="sm:flex-1"
            @update:model-value="set(f, $event === 'yes')"
          />
          <BaseInput
            v-else
            :id="fieldId(f.path)"
            :model-value="String(current(f))"
            :placeholder="f.value === '' ? 'Not answered' : undefined"
            class="sm:flex-1"
            @update:model-value="set(f, String($event))"
          />

          <BaseButton
            v-if="changed(f)"
            variant="secondary"
            size="sm"
            :disabled="pending"
            class="sm:shrink-0"
            @click="save(f)"
          >
            Save
          </BaseButton>
          <BaseButton v-if="changed(f)" variant="ghost" size="sm" class="sm:shrink-0" @click="undo(f)">
            Undo
          </BaseButton>
        </div>
        <p v-if="changed(f)" class="mt-1 text-2xs text-ink-tertiary" data-testid="answer-on-file">
          On file: {{ f.value === "" ? "not answered" : f.kind === "boolean" ? (f.value ? "Yes" : "No") : f.value }}
        </p>
      </li>
    </ul>
  </div>
</template>
