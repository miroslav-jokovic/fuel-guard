<script setup lang="ts">
import { CHAT_REACTIONS, CHAT_REACTION_EMOJI, type ChatReaction } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { SmileIcon } from "@silvicom/ui/icons";
import KebabMenu from "@/components/KebabMenu.vue";

/**
 * The six reactions (D-CHAT26), from a line's toolbar. Six fixed keys, never free emoji: the database's
 * CHECK holds the same list, so a picker offering a seventh would offer a refusal. The ones the reader
 * already chose show pressed; choosing one again takes it back, as the bar under the line does.
 */
defineProps<{ mine: readonly ChatReaction[] }>();
const emit = defineEmits<{ pick: [reaction: ChatReaction] }>();
</script>

<template>
  <KebabMenu trigger-label="Add a reaction" :icon="SmileIcon" placement="bottom-end">
    <div class="flex gap-0.5 px-1.5" role="group" aria-label="Reactions">
      <BaseButton
        v-for="r in CHAT_REACTIONS"
        :key="r"
        size="icon"
        :variant="mine.includes(r) ? 'soft' : 'ghost'"
        class="text-lg"
        :aria-label="CHAT_REACTION_EMOJI[r]"
        :aria-pressed="mine.includes(r)"
        @click="emit('pick', r)"
      >{{ CHAT_REACTION_EMOJI[r] }}</BaseButton>
    </div>
  </KebabMenu>
</template>
