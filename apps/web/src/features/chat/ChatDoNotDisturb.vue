<script setup lang="ts">
import { computed, ref } from "vue";
import { CHAT_DND_DEFAULT_WINDOW, CHAT_DND_MORNING } from "@silvicom/shared";
import { AppButton as BaseButton, AppInput } from "@silvicom/ui";
import { chatClock, chatDayLabel } from "./chatTime";
import { useChatDnd } from "./useChatDnd";

/**
 * Do not disturb, at the foot of the chat rail under the device's notification switch (CHAT-WEB-PUSH-PLAN WP5).
 *
 * Owner's ruling 2026-11-13: pause for an hour, until tomorrow morning, or every night between two times; for
 * the PERSON on every device; everything held back, a mention included; nothing replayed afterwards. So the
 * control says so where it is set — "nothing buzzes; messages wait in Chat" — and, while it holds, says until
 * when with one press to undo it: a pause nobody can see is a person who wonders why the office went silent.
 */
const dnd = useChatDnd();
const choosing = ref(false);
const editing = ref(false);
const start = ref<string>(CHAT_DND_DEFAULT_WINDOW.start);
const end = ref<string>(CHAT_DND_DEFAULT_WINDOW.end);
const note = ref<string | null>(null);

/** "10:00 PM" from "22:00". */
const wall = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return chatClock(new Date(2000, 0, 1, h ?? 0, m ?? 0));
};
const morning = wall(`${String(CHAT_DND_MORNING.hour).padStart(2, "0")}:${String(CHAT_DND_MORNING.minute).padStart(2, "0")}`);
const nightly = computed(() => {
  const s = dnd.current.value;
  return s.quiet_start && s.quiet_end ? `${wall(s.quiet_start)} – ${wall(s.quiet_end)}` : null;
});
/** "3:45 PM", "tomorrow 8:00 AM", or the house date and time for a pause days long. */
const until = computed(() => {
  const d = dnd.pausedUntil.value;
  if (!d) return null;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return chatClock(d);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${chatClock(d)}`;
  return `${chatDayLabel(d)} ${chatClock(d)}`;
});

async function act(fn: () => Promise<unknown>) {
  note.value = null;
  try {
    await fn();
    choosing.value = false;
    editing.value = false;
  } catch (e) {
    note.value = e instanceof Error ? e.message : "Could not change Do not disturb.";
  }
}
function openWindow() {
  start.value = dnd.current.value.quiet_start ?? CHAT_DND_DEFAULT_WINDOW.start;
  end.value = dnd.current.value.quiet_end ?? CHAT_DND_DEFAULT_WINDOW.end;
  choosing.value = false;
  editing.value = true;
}
const sameTime = computed(() => start.value === end.value);
</script>

<template>
  <div v-if="dnd.state.isSuccess.value" class="shrink-0 border-t border-edge-subtle px-3 py-2.5 text-xs text-ink-muted">
    <!-- While paused: until when, and one press to undo it -->
    <p v-if="until" class="flex items-center justify-between gap-2">
      <span><span class="font-medium text-ink">Do not disturb</span> until {{ until }}</span>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="dnd.busy.value" @click="act(dnd.resume)">Resume</BaseButton>
    </p>
    <p v-else class="flex items-center justify-between gap-2">
      <span>Do not disturb: {{ dnd.current.value.quiet_now && nightly ? "on now" : "off" }}</span>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="dnd.busy.value" @click="choosing = !choosing; editing = false">Pause</BaseButton>
    </p>
    <p v-if="nightly && !editing" class="mt-1 flex items-center justify-between gap-2">
      <span>Every night {{ nightly }}</span>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="dnd.busy.value" @click="openWindow">Change</BaseButton>
    </p>

    <div v-if="choosing" class="mt-2 flex flex-col items-start gap-1">
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="dnd.busy.value" @click="act(dnd.pauseForAnHour)">For 1 hour</BaseButton>
      <BaseButton size="sm" variant="link" class="text-xs" :disabled="dnd.busy.value" @click="act(dnd.pauseUntilMorning)">Until {{ morning }}</BaseButton>
      <BaseButton v-if="!nightly" size="sm" variant="link" class="text-xs" @click="openWindow">Every night…</BaseButton>
      <p class="text-ink-tertiary">Nothing buzzes on any of your devices. Messages wait in Chat.</p>
    </div>

    <form v-if="editing" class="mt-2 flex flex-col gap-2" @submit.prevent="act(() => dnd.setWindow(start, end))">
      <div class="flex items-center gap-2">
        <label class="flex flex-col gap-0.5">From <AppInput v-model="start" type="time" required class="w-28" /></label>
        <label class="flex flex-col gap-0.5">To <AppInput v-model="end" type="time" required class="w-28" /></label>
      </div>
      <p v-if="sameTime" class="text-ink-tertiary">Pick a different end time.</p>
      <div class="flex gap-2">
        <BaseButton size="sm" variant="primary" type="submit" :disabled="dnd.busy.value || sameTime">Save</BaseButton>
        <BaseButton v-if="nightly" size="sm" variant="ghost" :disabled="dnd.busy.value" @click="act(() => dnd.setWindow(null, null))">Remove</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="editing = false">Cancel</BaseButton>
      </div>
    </form>

    <p v-if="note" class="mt-1" role="status">{{ note }}</p>
  </div>
</template>
