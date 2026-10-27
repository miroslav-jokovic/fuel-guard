<script setup lang="ts">
import { computed } from "vue";
import { chatBodyParts } from "@silvicom/shared";
import { useChatNames } from "./chatNames";

/**
 * A line's words, with each `<@id>` token drawn as a chip of the person's name (D-CHAT22). The body is
 * the one record of what was written; this only decides how a token looks. A mention of the reader is
 * the stronger chip — the one a reader scanning a channel is looking for.
 */
const props = defineProps<{ body: string; viewerId: string }>();
const nameOf = useChatNames();
const parts = computed(() => chatBodyParts(props.body));
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <template v-if="'text' in p">{{ p.text }}</template>
    <span
      v-else
      class="rounded px-0.5 font-medium"
      :class="p.mention === viewerId.toLowerCase() ? 'bg-brand-accent-strong text-ink' : 'bg-brand-50 text-brand-700'"
      data-chat-mention
    >@{{ nameOf(p.mention) ?? "someone" }}</span>
  </template>
</template>
