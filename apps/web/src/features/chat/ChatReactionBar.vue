<script setup lang="ts">
import { computed } from "vue";
import { CHAT_REACTION_EMOJI, type ChatLineReaction, type ChatReaction } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useChatNames } from "./chatNames";

/**
 * A line's reactions, under its words (CH6c-2): each kind as a small pill with its count, in D-CHAT26's
 * order as the database returns them. The reader's own kinds are pressed; pressing a pill adds or takes
 * back the reader's reaction of that kind, as Slack's and Teams' do. Its tooltip names who reacted,
 * because "3" alone does not say whether the person you asked has seen it.
 */
const props = defineProps<{ reactions: readonly ChatLineReaction[]; viewerId: string; disabled?: boolean }>();
const emit = defineEmits<{ toggle: [reaction: ChatReaction, on: boolean] }>();
const nameOf = useChatNames();

const pills = computed(() =>
  props.reactions.map((r) => {
    const mine = r.users.some((u) => u.toLowerCase() === props.viewerId.toLowerCase());
    const names = r.users.map((u) => (u.toLowerCase() === props.viewerId.toLowerCase() ? "You" : nameOf(u) ?? "Someone"));
    return { ...r, mine, who: names.join(", ") };
  }),
);
</script>

<template>
  <div v-if="pills.length" class="mt-1 flex flex-wrap gap-1" role="group" aria-label="Reactions">
    <BaseButton
      v-for="p in pills"
      :key="p.reaction"
      size="sm"
      :variant="p.mine ? 'soft' : 'secondary'"
      class="h-6 gap-1 rounded-full px-2 text-xs tabular-nums"
      :class="p.mine ? 'ring-1 ring-inset ring-focus-ring' : ''"
      :aria-pressed="p.mine"
      :aria-label="`${CHAT_REACTION_EMOJI[p.reaction]} ${p.users.length}: ${p.who}`"
      :title="p.who"
      :disabled="disabled"
      @click="emit('toggle', p.reaction, !p.mine)"
    ><span aria-hidden="true">{{ CHAT_REACTION_EMOJI[p.reaction] }}</span><span>{{ p.users.length }}</span></BaseButton>
  </div>
</template>
