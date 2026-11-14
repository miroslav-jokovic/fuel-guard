<script setup lang="ts">
import { ref, watch } from "vue";
import type { WebPushDevice } from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, BaseModal, QueryState } from "@silvicom/ui";
import { listPushDevices, removePushDevice, thisDeviceId } from "@/lib/webPush";
import { chatRowTime } from "./chatTime";

/**
 * Every device where the person turned chat notifications on (CHAT-WEB-PUSH-PLAN WP4), from the rail's
 * "Your devices". Its purpose is the lost or replaced phone: Remove stops that device from here (D-WP10), and
 * it does not come back by itself — only a press of Turn on on that device does. Removing THIS device is the
 * same as Turn off. A device unused for 90 days has already been retired and is not listed (D-WP9).
 *
 * The list is the server's, read when the dialog opens: there is nothing here a second tab could change
 * under it that matters for longer than the dialog is open.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const devices = ref<WebPushDevice[] | null>(null);
const loading = ref(false);
const failed = ref(false);
const busyId = ref<string | null>(null);
const note = ref<string | null>(null);
const here = ref<string | null>(null);

async function load() {
  loading.value = true;
  failed.value = false;
  here.value = thisDeviceId();
  const list = await listPushDevices();
  loading.value = false;
  if (list === null) failed.value = true;
  else devices.value = list;
}
watch(() => props.open, (open) => { if (open) { note.value = null; void load(); } }, { immediate: true });

async function remove(d: WebPushDevice) {
  busyId.value = d.id;
  const ok = await removePushDevice(d.id);
  busyId.value = null;
  if (!ok) {
    note.value = "Could not remove that device. Try again.";
    return;
  }
  devices.value = (devices.value ?? []).filter((x) => x.id !== d.id);
  note.value = `${d.device_label ?? "The device"} will no longer get chat notifications.`;
}

const name = (d: WebPushDevice) => d.device_label ?? "A browser";
</script>

<template>
  <BaseModal :open="open" title="Your devices" description="Where chat notifications reach you. Remove one you no longer use." @close="emit('close')">
    <ul v-if="devices && devices.length" class="-mx-2 divide-y divide-edge-subtle">
      <li v-for="d in devices" :key="d.id" class="flex items-start justify-between gap-3 px-2 py-3">
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-sm text-ink">
            <span class="truncate">{{ name(d) }}</span>
            <AppBadge v-if="d.id === here" tone="info">This device</AppBadge>
          </p>
          <p class="mt-0.5 text-xs text-ink-muted">
            Turned on {{ chatRowTime(d.created_at) }} · Last opened {{ chatRowTime(d.last_seen_at) }}
          </p>
          <p class="text-xs text-ink-muted">
            <template v-if="d.last_success_at">Last notification {{ chatRowTime(d.last_success_at) }}</template>
            <template v-else>No notification delivered yet</template>
            <template v-if="d.last_failure_at && (!d.last_success_at || d.last_failure_at > d.last_success_at)"> · the last one failed</template>
          </p>
        </div>
        <BaseButton size="sm" variant="ghost" :disabled="busyId !== null" @click="remove(d)">
          {{ busyId === d.id ? "Removing…" : "Remove" }}
        </BaseButton>
      </li>
    </ul>
    <div v-else class="py-6 text-center text-sm text-ink-muted">
      <QueryState
        compact
        :loading="loading"
        :error="failed || null"
        loading-text="Loading your devices…"
        error-text="Could not load your devices."
        @retry="load()"
      >
        Notifications are not on for any device. Turn them on in Chat on the device you want them on.
      </QueryState>
    </div>
    <p v-if="note" class="mt-2 text-xs text-ink-muted" role="status">{{ note }}</p>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
