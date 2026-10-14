<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import type { FieldNote } from "./bolPrefill";

/**
 * The one line under a field the BOL reader filled (§7A N6): where the value came from and whether the two
 * readers agree (`fieldNote`, bolPrefill.ts). Absent on a field nobody read. When Calculate waits on a
 * person here (D-DR24, bolReview.ts) it offers the act that settles it: the value matches the page, or one
 * of the readings for a disputed count or weight. Changing the value settles it too.
 */
defineProps<{ note: FieldNote | null | undefined }>();
const emit = defineEmits<{ confirm: []; choose: [value: number] }>();

const TONE = {
  neutral: "text-ink-muted",
  warning: "text-warning-800",
  success: "text-success-700",
} as const;
</script>

<template>
  <div v-if="note" class="mt-1 space-y-1" data-testid="bol-field-note">
    <p class="text-xs" :class="TONE[note.tone]">{{ note.text }}</p>
    <div v-if="note.pending && (note.confirmable || note.choices?.length)" class="flex flex-wrap items-center gap-2" data-testid="bol-field-acts">
      <BaseButton
        v-for="v in note.choices ?? []"
        :key="v"
        variant="secondary"
        size="sm"
        data-testid="bol-field-choose"
        @click="emit('choose', v)"
      >
        Use {{ v.toLocaleString("en-US") }}
      </BaseButton>
      <BaseButton v-if="note.confirmable" variant="secondary" size="sm" data-testid="bol-field-confirm" @click="emit('confirm')">
        Matches the page
      </BaseButton>
    </div>
  </div>
</template>
