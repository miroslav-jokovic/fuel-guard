<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton, AppInput as BaseInput } from "@silvicom/ui";
import type { ClosureRequest } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { useClosureRequestsQuery, useResolveClosureRequest } from "./useClosureRequests";

/**
 * Account-closure requests — the fleet's 30-day queue (DIRECTION-B-PLAN §6 P4.4, table 0330).
 *
 * ── WHY THIS IS NOT A DataTable ────────────────────────────────────────────────────────────────
 * The house primitive for rows of data is `DataTable`, and it is the right answer for a page whose
 * job is to scan hundreds of records. This is the opposite shape: a queue that is empty almost
 * always, holds one or two rows when it is not, and asks for a DECISION with a consequence on each
 * of them. A table would give every row a `KebabMenu` and hide behind it the two actions that are
 * the entire point, and it has nowhere to put the sentence explaining what "Complete" attests to.
 *
 * ── THE COPY IS THE FEATURE ────────────────────────────────────────────────────────────────────
 * "Complete" is not a tidy-up gesture. It records that this fleet deleted the driver's non-retained
 * data per the published privacy policy, it names the person who said so, and 0330 makes it
 * permanent — the row cannot be reopened. A manager who presses it thinking it means "seen" has
 * made a false attestation, so the card says what it means before the button, not in a tooltip.
 */
const requests = useClosureRequestsQuery();
const resolve = useResolveClosureRequest();
const toast = useToastStore();

/** The note being typed, keyed by request — two open requests must not share one box. */
const notes = ref<Record<string, string>>({});
/** Which request is mid-flight, so only its buttons disable. */
const busyId = ref<string | null>(null);

const open = computed(() => (requests.data.value ?? []).filter((r) => r.status === "open"));
const resolved = computed(() => (requests.data.value ?? []).filter((r) => r.status !== "open"));

const STATUS_TONE = { completed: "success", declined: "neutral", open: "caution" } as const;
const STATUS_LABEL = { completed: "Completed", declined: "Declined", open: "Open" } as const;

async function act(request: ClosureRequest, outcome: "complete" | "decline") {
  busyId.value = request.id;
  try {
    await resolve.mutateAsync({ id: request.id, outcome, note: notes.value[request.id]?.trim() || undefined });
    delete notes.value[request.id];
    toast.push("success", outcome === "complete" ? "Request completed" : "Request declined");
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "Could not resolve the request.");
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <BaseCard as="section">
    <h3 class="text-sm font-semibold text-ink">Account closure requests</h3>
    <p class="mt-1 text-sm text-ink-muted">
      A driver asked for their login to be closed from the app. The login already stopped working —
      what remains is deleting the data you are allowed to delete, within 30 days.
      <span class="text-ink">Their driver qualification file is kept for three years</span> by
      49 CFR §391.51 and is not part of this.
    </p>

    <p v-if="requests.isLoading.value" class="mt-4 text-sm text-ink-muted">Loading requests…</p>
    <p v-else-if="requests.isError.value" class="mt-4 text-sm text-danger-700">
      {{ requests.error.value instanceof Error ? requests.error.value.message : "Could not load requests." }}
    </p>

    <template v-else>
      <p v-if="open.length === 0" class="mt-4 text-sm text-ink-muted">
        No open requests. Drivers can ask from More → Close my account in the app.
      </p>

      <ul v-else class="mt-4 space-y-4">
        <li v-for="r in open" :key="r.id" class="rounded-surface bg-surface-subtle p-4 ring-1 ring-edge">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-medium text-ink">{{ r.driver_name ?? "Driver" }}</span>
            <span class="text-xs text-ink-tertiary">Asked {{ formatDateTime(r.requested_at) }}</span>
          </div>
          <label class="mt-3 block">
            <span class="text-xs text-ink-muted">Note — what you deleted, or why you are declining</span>
            <BaseInput
              v-model="notes[r.id]"
              class="mt-1"
              placeholder="e.g. App preferences, messages and push tokens deleted"
            />
          </label>
          <div class="mt-3 flex flex-wrap gap-2">
            <BaseButton variant="primary" :disabled="busyId === r.id" @click="act(r, 'complete')">
              {{ busyId === r.id ? "Saving…" : "Mark completed" }}
            </BaseButton>
            <BaseButton variant="soft" :disabled="busyId === r.id" @click="act(r, 'decline')">Decline</BaseButton>
          </div>
          <p class="mt-2 text-xs text-ink-tertiary">
            Marking it completed records that you deleted this driver's non-retained data. It cannot be
            undone.
          </p>
        </li>
      </ul>

      <div v-if="resolved.length" class="mt-6">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Resolved</h4>
        <ul class="mt-2 space-y-2">
          <li v-for="r in resolved" :key="r.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span :class="[BADGE_BASE, toneClass(STATUS_TONE[r.status])]">{{ STATUS_LABEL[r.status] }}</span>
            <span class="text-ink">{{ r.driver_name ?? "Driver" }}</span>
            <span class="text-ink-tertiary">
              {{ formatDateTime(r.resolved_at) }}<template v-if="r.resolved_by_name"> · {{ r.resolved_by_name }}</template>
            </span>
            <span v-if="r.note" class="w-full text-xs text-ink-muted">{{ r.note }}</span>
          </li>
        </ul>
      </div>
    </template>
  </BaseCard>
</template>
