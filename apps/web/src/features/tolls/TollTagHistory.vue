<script setup lang="ts">
import type { TransponderAssignmentDto, TransponderDto } from "@silvicom/shared";
import { AppButton } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

/**
 * One tag's dated history, newest first, voided entries crossed out with why (TL2). Shared by the
 * truck's tag card and the Tolls page's tag drawer, so "why did June's tolls move to unit 702" reads
 * the same in both places. Voiding is asked of the parent, which owns the dialog.
 */
defineProps<{ tag: TransponderDto; canManage: boolean }>();
const emit = defineEmits<{ void: [entry: TransponderAssignmentDto, label: string] }>();

const { zone } = useOrgTimezone();
const at = (iso: string) => formatDateTime(iso, "—", zone.value);
const entryLabel = (h: TransponderAssignmentDto) => `Unit ${h.unitNumber ?? "?"}, ${at(h.validFrom)} to ${h.validTo ? at(h.validTo) : "now"}`;
</script>

<template>
  <ol class="space-y-1 border-l border-edge-subtle pl-3 text-xs" data-test="toll-tag-history">
    <li v-for="h in tag.history" :key="h.id" class="flex flex-wrap items-center justify-between gap-2">
      <span :class="h.voidedAt ? 'text-ink-tertiary line-through' : 'text-ink-secondary'">{{ entryLabel(h) }}</span>
      <span v-if="h.voidedAt" class="text-ink-tertiary">Voided: {{ h.voidReason }}</span>
      <AppButton v-else-if="canManage" size="sm" variant="link" data-test="toll-entry-void" @click="emit('void', h, entryLabel(h))">This is wrong…</AppButton>
    </li>
    <li v-if="tag.history.length === 0" class="text-ink-tertiary">Never on a truck.</li>
  </ol>
</template>
