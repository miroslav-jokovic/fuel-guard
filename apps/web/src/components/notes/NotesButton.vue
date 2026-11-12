<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { UnitNoteKind } from "@silvicom/shared";
import { useUnitNoteSummary } from "./useUnitNotes";
import { useNotesDrawer } from "./useNotesDrawer";

/**
 * The detail page's "Notes" button (D-UN12): opens the same drawer the table's cell opens, with the
 * unit's count beside the word. Renders nothing for somebody without the `notes` surface (D-UN14) —
 * the same answer `/api/notes` gives them.
 */
const props = defineProps<{ kind: UnitNoteKind; id: string; label: string }>();
const { on, summary } = useUnitNoteSummary(props.kind);
const drawer = useNotesDrawer();
const count = computed(() => summary.value[props.id]?.count ?? 0);
</script>

<template>
  <BaseButton v-if="on" data-notes-button @click="drawer.open([{ kind, id, label }])">
    Notes <span v-if="count" class="tabular-nums text-ink-tertiary">{{ count }}</span>
  </BaseButton>
</template>
