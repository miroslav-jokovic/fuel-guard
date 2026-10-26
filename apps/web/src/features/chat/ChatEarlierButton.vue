<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * The top of a conversation, a channel or a reply thread that holds more than its page (CH6a): one
 * button for the page above, and the page's own sentence when it failed — the same button tries
 * again. Shown only while the page says there is more (`before_seq`), so the start of a conversation
 * has no button to press for nothing.
 */
defineProps<{ noun: string; loading: boolean; failed: boolean }>();
defineEmits<{ load: [] }>();
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <BaseButton size="sm" variant="ghost" :disabled="loading" @click="$emit('load')">
      {{ loading ? "Loading…" : `Show earlier ${noun}` }}
    </BaseButton>
    <p v-if="failed" role="alert" class="text-xs text-danger-700">Could not load the earlier {{ noun }}. Try again.</p>
  </div>
</template>
