<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { BellIcon } from "@silvicom/ui/icons";
import { pushOnHere, pushPermission, pushServer, pushSupport, sendTestPush, turnOffPush, turnOnPush } from "@/lib/webPush";
import { useChatDesktopAlertsChoice } from "./useChatDesktopAlerts";

/**
 * The foot of the chat rail: notifications on THIS device (CHAT-WEB-PUSH-PLAN D-WP5; CH6d before it).
 *
 *   · A browser that can take Web Push, on a server that has its keys: Turn on asks the browser, registers the
 *     device, and from then on a chat line reaches it with the tab — or the browser — closed. Then one quiet
 *     line with Send a test and Turn off.
 *   · An iPhone or iPad in a Safari tab cannot be asked at all (no notifications until the site is on the Home
 *     Screen), so it gets the three steps that make it possible instead of a button that would do nothing.
 *   · Anything else that has notifications keeps CH6d's desktop alerts while the tab is open.
 *
 * "Not now" is the same per-browser choice CH6d stored, so dismissing once dismisses in both modes. A browser
 * that blocked notifications says so and how to undo it: the browser will not ask twice.
 */
const { choice, permission, on, turnOn, turnOff } = useChatDesktopAlertsChoice();
const support = pushSupport();
const pushMode = computed(() => support === "available" && pushServer.value?.available === true);
const device = typeof navigator !== "undefined" && /iPad/.test(navigator.userAgent) ? "iPad" : "phone";
const busy = ref(false);
const note = ref<string | null>(null);

async function pushOn() {
  if (busy.value) return;
  busy.value = true;
  note.value = null;
  const r = await turnOnPush();
  busy.value = false;
  if (r === "failed") note.value = "Could not turn notifications on in this browser. Try again, or reload the page.";
}
async function pushOff() {
  busy.value = true;
  await turnOffPush();
  busy.value = false;
  note.value = null;
}
async function test() {
  busy.value = true;
  const r = await sendTestPush();
  busy.value = false;
  note.value = r === null ? "Wait a few seconds before sending another test."
    : r.sent === 0 ? "No device took the test. Turn notifications off and on again here."
    : `Test sent to ${r.sent} ${r.sent === 1 ? "device" : "devices"}.`;
}
</script>

<template>
  <!-- Web Push: this device, tab open or not -->
  <div v-if="pushMode" class="shrink-0 border-t border-edge-subtle px-3 py-2.5">
    <p v-if="pushPermission === 'denied'" class="text-xs text-ink-muted">
      Notifications are blocked in this browser. Allow notifications for this site in the browser's settings, then turn them on here.
    </p>
    <div v-else-if="pushOnHere" class="flex flex-col gap-1">
      <p class="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span>Notifications: on for this device</span>
        <BaseButton size="sm" variant="link" class="text-xs" :disabled="busy" @click="pushOff">Turn off</BaseButton>
      </p>
      <BaseButton size="sm" variant="link" class="self-start text-xs" :disabled="busy" @click="test">Send a test</BaseButton>
    </div>
    <AppCallout v-else-if="choice === null" tone="info" :icon="BellIcon">
      <p class="text-xs">Get a notification on this device when a message for you arrives, even when Silvicom is closed.</p>
      <div class="mt-2 flex gap-2">
        <BaseButton size="sm" variant="primary" :disabled="busy" @click="pushOn">Turn on</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="turnOff">Not now</BaseButton>
      </div>
    </AppCallout>
    <p v-else class="flex items-center justify-between gap-2 text-xs text-ink-muted">
      <span>Notifications: off for this device</span>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="busy" @click="pushOn">Turn on</BaseButton>
    </p>
    <p v-if="note" class="mt-1 text-xs text-ink-muted" role="status">{{ note }}</p>
  </div>

  <!-- An iPhone or iPad in a Safari tab: the Home Screen is the only way in -->
  <div v-else-if="support === 'ios-install' && choice === null" class="shrink-0 border-t border-edge-subtle px-3 py-2.5">
    <AppCallout tone="info" :icon="BellIcon">
      <p class="text-xs">To get chat notifications on this {{ device }}:</p>
      <ol class="mt-1 list-decimal pl-4 text-xs">
        <li>Tap Share, then Add to Home Screen.</li>
        <li>Open Silvicom from your Home Screen and sign in.</li>
        <li>Open Chat and turn notifications on there.</li>
      </ol>
      <div class="mt-2">
        <BaseButton size="sm" variant="ghost" @click="turnOff">Not now</BaseButton>
      </div>
    </AppCallout>
  </div>

  <!-- CH6d: desktop alerts while this tab is open -->
  <div v-else-if="permission !== 'unsupported'" class="shrink-0 border-t border-edge-subtle px-3 py-2.5">
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
