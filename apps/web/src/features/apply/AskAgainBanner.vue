<script setup lang="ts">
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { APPLY_COPY } from "./strings";

/**
 * Above the application while the driver is in it to answer a question the office sent back (F5): the
 * office's words stay in front of them, and "Done" is the way back — whatever screen they wandered to.
 */
defineProps<{ carrier: string; question: string }>();
const emit = defineEmits<{ done: [] }>();
const copy = APPLY_COPY.askAgain;
</script>

<template>
  <AppCallout tone="info" data-ask-again-banner>
    <p class="text-xs font-medium">{{ copy.asked(carrier) }}</p>
    <p class="mt-1 whitespace-pre-line break-words text-sm text-ink">{{ question }}</p>
    <div class="mt-2">
      <BaseButton size="touch" variant="ghost" @click="emit('done')">{{ copy.done }}</BaseButton>
    </div>
  </AppCallout>
</template>
