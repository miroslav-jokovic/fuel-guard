<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { formatDisplayDateTime, memberDevicesResponseSchema, type MemberDevicesResponse } from "@silvicom/shared";
import { QueryState } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";

/**
 * Device history (INSTALLED-APP-PLAN IA-S6; the owner's rulings of 2026-11-16, Q-IA17/Q-IA18 (a); migration 0620):
 * every device this account was used on, kept past sign-out, and every address each one used — under the
 * signed-in list in a person's own panel and in an admin's drawer for a member, from one component so the two
 * cannot say different things.
 *
 * It only shows. Signing a device out is the list above it, which reads Supabase's live sessions; this one reads
 * what the product remembers, so a device appears here from its first request after this shipped, and a device
 * signed out stays, marked so, for twelve months after it was last used.
 *
 * `path` is `/api/me/devices` or `/api/members/:userId/devices`; null while there is nobody to ask about.
 */
const props = defineProps<{ path: string | null }>();

const list = useQuery({
  queryKey: computed(() => ["devices", props.path] as const),
  enabled: computed(() => props.path !== null),
  queryFn: async (): Promise<MemberDevicesResponse> => {
    const res = await apiFetch<unknown>(props.path!);
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the device history.");
    return memberDevicesResponseSchema.parse(res.data);
  },
  staleTime: 0,
});
const devices = computed(() => list.data.value?.devices ?? []);
const months = computed(() => Math.round((list.data.value?.history_days ?? 365) / 30.4));
</script>

<template>
  <section class="mt-6 border-t border-edge-subtle pt-4" data-testid="device-history">
    <h3 class="text-sm font-semibold text-ink">Device history</h3>
    <p class="mt-1 text-xs text-ink-muted">
      Every device used to sign in, and the internet addresses it was used from. Kept for {{ months }} months after a device was last used.
    </p>
    <QueryState
      :loading="list.isLoading.value"
      :error="list.isError.value ? list.error.value : null"
      :retrying="list.isFetching.value"
      loading-text="Loading the device history…"
      error-text="Could not load the device history."
      @retry="list.refetch()"
    >
      <p v-if="devices.length === 0" class="mt-3 text-sm text-ink-muted" data-testid="device-history-empty">
        Nothing recorded yet. A device is recorded the first time it is used after this was turned on.
      </p>
      <ul v-else class="mt-2 divide-y divide-edge-subtle">
        <li v-for="d in devices" :key="d.id" class="py-3" data-testid="device-history-row">
          <p class="text-sm font-semibold text-ink">
            {{ d.device }}
            <span v-if="d.current" class="ml-1 text-xs font-medium text-ink-muted">This device</span>
            <span v-else-if="d.signed_in" class="ml-1 text-xs font-medium text-ink-muted">Signed in</span>
            <span v-else class="ml-1 text-xs font-medium text-ink-tertiary">Signed out</span>
          </p>
          <p class="mt-0.5 text-xs text-ink-muted">
            First used {{ formatDisplayDateTime(d.first_seen_at) }} · last used {{ formatDisplayDateTime(d.last_seen_at) }}
          </p>
          <ul v-if="d.addresses.length" class="mt-1 space-y-0.5" :aria-label="`Addresses ${d.device} was used from`">
            <li v-for="a in d.addresses" :key="a.ip" class="text-xs text-ink-secondary">
              <span class="font-mono">{{ a.ip }}</span>
              <span class="text-ink-tertiary"> · {{ formatDisplayDateTime(a.first_seen_at) }} to {{ formatDisplayDateTime(a.last_seen_at) }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </QueryState>
  </section>
</template>
