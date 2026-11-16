<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { formatDisplayDateTime, memberDevicesResponseSchema, type MemberDevice } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, QueryState } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

/**
 * "You are signed in on 3 devices" (INSTALLED-APP-PLAN IA-S6; the owner's ruling Q-IA14 (b), 2026-11-16).
 *
 * An account holds at most `DEVICE_LIMIT` devices at once. A fourth sign-in is STOPPED — nobody else is signed
 * out without choosing it — and the API answers every request from it 403 `device_limit` except the two this
 * page uses: the person's own devices (`GET /api/me/devices`) and signing one out (`DELETE /api/me/sessions/:id`).
 * `lib/api.ts` brings any page here on that answer.
 *
 * Signing one out frees its place at once (the API's refusal is never cached), so "Continue" simply goes on:
 * the next request is admitted. If somebody else freed a place meanwhile — or a device went unused long enough
 * to lose its own — Continue works without signing anything out, which is why it is always offered.
 *
 * The other way out is not to use this device: Sign out, below.
 */
const router = useRouter();
const session = useSessionStore();

const devices = ref<MemberDevice[]>([]);
const limit = ref(3);
const loading = ref(true);
const loadError = ref<unknown>(null);
const busy = ref<string | null>(null);
const note = ref<string | null>(null);
const failure = ref<string | null>(null);

// The devices holding the places: signed in, and not this one (which holds none — that is why it is here).
const holding = computed(() => devices.value.filter((d) => d.signed_in && !d.current && d.session_id));

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const res = await apiFetch<unknown>("/api/me/devices");
  const parsed = res.ok ? memberDevicesResponseSchema.safeParse(res.data) : null;
  if (parsed?.success) {
    devices.value = parsed.data.devices;
    limit.value = parsed.data.limit;
  } else {
    loadError.value = new Error(res.error?.message ?? "Could not load your devices.");
  }
  loading.value = false;
}

async function signOutDevice(d: MemberDevice): Promise<void> {
  busy.value = d.id;
  failure.value = null;
  note.value = null;
  const res = await apiFetch<{ ended: boolean }>(`/api/me/sessions/${d.session_id}`, { method: "DELETE" });
  busy.value = null;
  // Already gone (signed out from elsewhere a moment ago) is what was wanted.
  if (!res.ok && res.status !== 404) {
    failure.value = res.error?.message ?? "Could not sign that device out. Try again.";
    return;
  }
  note.value = `${d.device} is signed out. You can continue on this device.`;
  await load();
}

function carryOn(): void {
  // A full navigation: the shell and the store load afresh, now that this device holds a place.
  window.location.assign("/");
}

async function signOutHere(): Promise<void> {
  await session.signOut();
  await router.push("/login");
}

onMounted(load);
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold text-ink">You are signed in on {{ limit }} devices</h2>
    <p class="mt-1 text-sm text-ink-muted" data-testid="too-many-devices-lead">
      An account can be signed in on {{ limit }} devices at once. To use this one, sign one of the others out.
    </p>

    <QueryState
      class="mt-5"
      compact
      :loading="loading"
      :error="loadError"
      loading-text="Loading your devices…"
      error-text="Could not load your devices."
      @retry="load"
    >
      <p v-if="note" class="mb-3 text-sm text-ink-secondary" role="status">{{ note }}</p>
      <AppCallout v-if="failure" tone="danger" role="alert" class="mb-3">{{ failure }}</AppCallout>
      <ul v-if="holding.length" class="divide-y divide-edge-subtle" data-testid="too-many-devices-list">
        <li v-for="d in holding" :key="d.id" class="flex items-start justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-ink">{{ d.device }}</p>
            <p class="mt-0.5 text-xs text-ink-muted">
              Last used {{ formatDisplayDateTime(d.last_seen_at) }}<template v-if="d.addresses[0]"> · {{ d.addresses[0].ip }}</template>
            </p>
          </div>
          <BaseButton
            size="sm"
            variant="secondary"
            :disabled="busy !== null"
            :aria-label="`Sign out ${d.device}, last used ${formatDisplayDateTime(d.last_seen_at)}`"
            @click="signOutDevice(d)"
          >
            {{ busy === d.id ? "Signing out…" : "Sign out" }}
          </BaseButton>
        </li>
      </ul>
      <p v-else class="text-sm text-ink-muted" data-testid="too-many-devices-free">A place is free now. Continue to use this device.</p>
      <BaseButton class="mt-5" variant="primary" block :disabled="busy !== null" @click="carryOn">Continue</BaseButton>
    </QueryState>

    <p class="mt-4 text-xs text-ink-muted">
      Do not recognise one of these? Sign it out, then change your password with “Forgot password?” on the sign-in page:
      a new password signs out every device.
    </p>
    <div class="mt-6 flex items-center justify-end text-sm">
      <BaseButton variant="link" @click="signOutHere">Sign out of this device instead</BaseButton>
    </div>
  </div>
</template>
