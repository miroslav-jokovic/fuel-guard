<script setup lang="ts">
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { BellIcon } from "@silvicom/ui/icons";
import { useChatDesktopAlertsChoice } from "./useChatDesktopAlerts";

/**
 * The foot of the chat rail: desktop alerts for this browser (CH6d). Until the person has answered, an
 * offer with Turn on and Not now; after that, one quiet line with the way back. A browser that blocked
 * them says so and how to undo it, because a Turn on that does nothing would read as broken — the
 * browser will not ask twice. A browser with no notifications shows nothing.
 */
const { choice, permission, on, turnOn, turnOff } = useChatDesktopAlertsChoice();
</script>

<template>
  <div v-if="permission !== 'unsupported'" class="shrink-0 border-t border-edge-subtle px-3 py-2.5">
    <AppCallout v-if="choice === null && permission === 'default'" tone="info" :icon="BellIcon">
      <p class="text-xs">Get a desktop alert when a message for you arrives while this tab is in the background.</p>
      <div class="mt-2 flex gap-2">
        <BaseButton size="sm" variant="primary" @click="turnOn">Turn on</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="turnOff">Not now</BaseButton>
      </div>
    </AppCallout>
    <p v-else-if="permission === 'denied'" class="text-xs text-ink-muted">
      Desktop alerts are blocked in this browser. Allow notifications for this site in the browser's settings to turn them on.
    </p>
    <p v-else class="flex items-center justify-between gap-2 text-xs text-ink-muted">
      <span>Desktop alerts: {{ on ? "on" : "off" }}</span>
      <BaseButton size="sm" variant="link" class="text-xs" @click="on ? turnOff() : turnOn()">{{ on ? "Turn off" : "Turn on" }}</BaseButton>
    </p>
  </div>
</template>
