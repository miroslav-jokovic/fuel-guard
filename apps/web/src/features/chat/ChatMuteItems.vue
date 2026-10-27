<script setup lang="ts">
import type { ChatMuteLevel } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { CheckIcon } from "@silvicom/ui/icons";

/**
 * A conversation's mute, as three items of its header's menu (CHAT-REDESIGN-PLAN §6: "mute is a kebab
 * item"; D-CHAT23). Each says what reaches you, not the setting's name: everything; only a mention of
 * you — a reply to your post is quiet too, which is 0521's rule; or nothing, which also moves it to
 * Muted at the bottom of the rail. The current one carries a check and `aria-checked`.
 */
defineProps<{ muted: ChatMuteLevel | null }>();
defineEmits<{ set: [level: ChatMuteLevel] }>();

const LEVELS: ReadonlyArray<{ level: ChatMuteLevel; label: string }> = [
  { level: "none", label: "Notify me of everything" },
  { level: "mentions", label: "Only when I'm mentioned" },
  { level: "all", label: "Mute" },
];
</script>

<template>
  <BaseButton
    v-for="o in LEVELS"
    :key="o.level"
    class="kebab-item"
    role="menuitemradio"
    :aria-checked="(muted ?? 'none') === o.level"
    @click="$emit('set', o.level)"
  >
    <span class="flex w-full items-center justify-between gap-3">
      {{ o.label }}
      <AppIcon v-if="(muted ?? 'none') === o.level" :icon="CheckIcon" class="size-4 text-ink-secondary" aria-hidden="true" />
    </span>
  </BaseButton>
</template>
