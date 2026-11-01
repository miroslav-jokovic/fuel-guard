<script setup lang="ts">
import { AppButton as BaseButton, AppIcon, AppIconChip } from "@silvicom/ui";
import { ChatAddIcon, ChatIcon } from "@silvicom/ui/icons";

/**
 * The stage when nothing is open (CR4's first run, D-CHATUI18; the idle state, D-CHATUI25 2026-11-01).
 *
 * The idle stage used to be one grey sentence — "Pick a conversation or a channel, or start one with
 * New." — telling somebody to go and find a button. It now holds the button: the brand chip the
 * dashboard's cards lead with, a heading, and New conversation, so the empty half of the screen is a
 * place to begin rather than a caption. The first run keeps its own words (nobody has started
 * anything) and adds New team for whoever may make one.
 */
defineProps<{ firstRun: boolean; canManage: boolean }>();
defineEmits<{ "new-conversation": []; "new-team": [] }>();
</script>

<template>
  <div class="flex max-w-sm flex-col items-center gap-4 text-center">
    <AppIconChip :icon="ChatIcon" tone="brand" />
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ firstRun ? "Nobody has started a conversation yet" : "Your conversations" }}</h2>
      <p class="mt-1 text-sm text-ink-muted">
        <template v-if="firstRun">Message somebody in the office<template v-if="canManage">, or make a team with a channel for each thing it talks about</template>.</template>
        <template v-else>Pick one on the left, or start a new one.</template>
      </p>
    </div>
    <div class="flex flex-wrap justify-center gap-2">
      <BaseButton variant="primary" @click="$emit('new-conversation')">
        <AppIcon :icon="ChatAddIcon" class="mr-1.5 size-4" aria-hidden="true" />New conversation
      </BaseButton>
      <BaseButton v-if="firstRun && canManage" @click="$emit('new-team')">New team</BaseButton>
    </div>
  </div>
</template>
