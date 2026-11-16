<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { memberSessionsResponseSchema, type MemberSession, type OrgMember } from "@silvicom/shared";
import { QueryState } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { apiRefusal, useStepUpRetry } from "@/composables/useStepUpRetry";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import SignedInDeviceList from "./SignedInDeviceList.vue";

/**
 * "Signed-in devices…" on the Users page (INSTALLED-APP-PLAN IA-S3; Q-IA3 (b): an admin may end anybody's
 * sessions in their company).
 *
 * For the phone a dispatcher left in a truck: the admin signs out THAT device and the person keeps working on
 * their PC. Everything-at-once already exists on this page and is said here rather than rebuilt — Suspend, or
 * Send password reset.
 *
 * Ending one is a write on the Users page, so the API asks for the admin's password first (`requireFreshAuth`);
 * the prompt replaces the drawer body and the same sign-out re-runs once it is given — MemberPasswordResetDrawer's
 * pattern. An admin looking at their OWN row sees the device they are using marked, with no button.
 */
const props = defineProps<{ member: OrgMember | null }>();
const emit = defineEmits<{ close: [] }>();

const qc = useQueryClient();
const userId = computed(() => props.member?.userId ?? null);
const key = computed(() => ["members", userId.value, "sessions"] as const);
const list = useQuery({
  queryKey: key,
  enabled: computed(() => userId.value !== null),
  queryFn: async (): Promise<MemberSession[]> => {
    const res = await apiFetch<unknown>(`/api/members/${userId.value}/sessions`);
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load their devices.");
    return memberSessionsResponseSchema.parse(res.data).sessions;
  },
  staleTime: 0,
});
const devices = computed(() => list.data.value ?? []);
const who = computed(() => props.member?.fullName ?? props.member?.email ?? "This member");

const busy = ref(false);
const note = ref<string | null>(null);
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();
watch(userId, () => { note.value = null; });

async function end(device: MemberSession): Promise<void> {
  const id = userId.value;
  if (!id) return;
  busy.value = true;
  note.value = null;
  try {
    const res = await apiFetch<{ ended: boolean }>(`/api/members/${id}/sessions/${device.id}`, { method: "DELETE" });
    // Already gone is what was wanted: not an error to show.
    if (!res.ok && res.status !== 404) throw apiRefusal(res.error, "Could not sign that device out.");
    note.value = `${device.device} is signed out.`;
    await qc.invalidateQueries({ queryKey: key.value });
  } catch (e) {
    if (holdForStepUp(e, () => end(device))) return;
    note.value = e instanceof Error ? e.message : "Could not sign that device out.";
  } finally {
    busy.value = false;
  }
}

function close(): void {
  cancel();
  emit("close");
}
</script>

<template>
  <SlideOver :open="member !== null" title="Signed-in devices" :description="member?.email ?? undefined" @close="close">
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <QueryState
      v-else
      :loading="list.isLoading.value"
      :error="list.isError.value ? list.error.value : null"
      :retrying="list.isFetching.value"
      loading-text="Loading their devices…"
      error-text="Could not load their devices."
      @retry="list.refetch()"
    >
      <!-- The answer to a press and what it means sit above the list: a list can be 160 rows long. -->
      <p v-if="note" class="mb-3 text-sm text-ink-secondary" role="status">{{ note }}</p>
      <p class="mb-2 text-xs text-ink-muted">
        A device signed out here stops working within a few seconds and cannot sign back in without the password. To
        sign out every device at once, use Suspend member or Send password reset.
      </p>
      <p v-if="devices.length === 0" class="text-sm text-ink-muted" data-testid="member-devices-empty">{{ who }} is not signed in anywhere.</p>
      <SignedInDeviceList v-else :devices="devices" :busy="busy" @end="end" />
    </QueryState>
  </SlideOver>
</template>
