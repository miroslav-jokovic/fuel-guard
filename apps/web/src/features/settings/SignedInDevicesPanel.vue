<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import SignedInDeviceList from "./SignedInDeviceList.vue";
import { useSignedInDevices, useSignedInDevicesPanel } from "./useSignedInDevices";

/**
 * "Signed-in devices", from the account menu (INSTALLED-APP-PLAN IA-S3; the owner's ruling of 2026-11-15):
 * every place this person is signed in, and a way to sign one out without changing the password.
 *
 * The device in the person's hand is marked and has no button — that is Sign out, one item below this one in
 * the same menu, which also stops this browser's notifications. Everything else can be signed out one at a
 * time or all at once.
 *
 * ⚠ The line under the list says what "signed out" means, because it is not instant: a device that is open
 * right now keeps working for up to an hour (0615 §4; Q-IA10 is whether to close that). A person who has
 * lost a phone must not read "Signed out" as "nobody can see anything from this second".
 */
const panel = useSignedInDevicesPanel();
const { list, endOne, endOthers } = useSignedInDevices(panel.open);
const devices = computed(() => list.data.value ?? []);
const others = computed(() => devices.value.filter((d) => !d.current));
const busy = computed(() => endOne.isPending.value || endOthers.isPending.value);
const note = ref<string | null>(null);

async function act(fn: () => Promise<unknown>, done: string) {
  note.value = null;
  try {
    await fn();
    note.value = done;
  } catch (e) {
    note.value = e instanceof Error ? e.message : "Could not sign that device out.";
  }
}
</script>

<template>
  <SlideOver :open="panel.open.value" title="Signed-in devices" description="Where your account is signed in." @close="panel.close()">
    <QueryState
      :loading="list.isLoading.value"
      :error="list.isError.value ? list.error.value : null"
      :retrying="list.isFetching.value"
      loading-text="Loading your devices…"
      error-text="Could not load your devices."
      @retry="list.refetch()"
    >
      <!-- Above the list, not under it: on staging one login had 160 sign-ins, which put this button and the
           answer to a press 13,000 px down (browser pass, 2026-11-15). -->
      <p class="text-sm text-ink-secondary" data-testid="signed-in-devices-summary">
        {{ others.length === 0 ? "You are signed in on this device only." : `You are signed in on this device and ${others.length} other${others.length === 1 ? "" : "s"}.` }}
      </p>
      <BaseButton
        v-if="others.length > 1"
        class="mt-3"
        size="sm"
        variant="secondary"
        :disabled="busy"
        @click="act(() => endOthers.mutateAsync(), 'Every other device is signed out.')"
      >
        Sign out of all {{ others.length }} other devices
      </BaseButton>
      <p v-if="note" class="mt-3 text-sm text-ink-secondary" role="status">{{ note }}</p>
      <p class="mb-2 mt-3 text-xs text-ink-muted">
        A device you sign out here cannot sign back in without your password. If it is open right now, it can keep
        working for up to an hour. If you think somebody else has your password, sign out and use “Forgot password?” on
        the sign-in page: a new password signs out every device.
      </p>
      <SignedInDeviceList :devices="devices" :busy="busy" @end="(d) => act(() => endOne.mutateAsync(d.id), `${d.device} is signed out.`)" />
    </QueryState>
  </SlideOver>
</template>
