<script setup lang="ts">
import type { Inline } from "./answerBlocks";

defineProps<{ inlines: Inline[] }>();
</script>

<template>
  <template v-for="(s, i) in inlines" :key="i">
    <strong v-if="s.kind === 'strong'" class="font-semibold text-ink">{{ s.text }}</strong>
    <code v-else-if="s.kind === 'code'" class="rounded-detail bg-surface-muted px-1 py-0.5 font-mono text-xs text-ink">{{ s.text }}</code>
    <template v-else>{{ s.text }}</template>
  </template>
</template>
