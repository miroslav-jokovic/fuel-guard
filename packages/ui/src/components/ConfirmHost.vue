<script setup lang="ts">
import { computed } from "vue";
import BaseButton from "./AppButton.vue";
import BaseModal from "./BaseModal.vue";
import { useConfirmStore } from "../lists/confirm";

/**
 * Draws the one pending `useConfirm()` question (D-US7). Mounted once in `App.vue`, beside the
 * toasts. Escape, the scrim and Cancel all answer "no"; only the named button answers "yes".
 */
const store = useConfirmStore();
const open = computed(() => store.pending !== null);
</script>

<template>
  <BaseModal :open="open" :title="store.pending?.title ?? ''" @close="store.answer(false)">
    <p v-if="store.pending?.message" class="text-sm text-ink-secondary whitespace-pre-line">{{ store.pending.message }}</p>
    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton @click="store.answer(false)">{{ store.pending?.cancelLabel ?? "Cancel" }}</BaseButton>
        <BaseButton
          :variant="store.pending?.tone === 'danger' ? 'danger' : 'primary'"
          data-testid="confirm-yes"
          @click="store.answer(true)"
        >
          {{ store.pending?.confirmLabel }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
