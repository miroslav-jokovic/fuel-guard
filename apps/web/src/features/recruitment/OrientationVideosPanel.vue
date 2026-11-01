<script setup lang="ts">
import { computed, toRef } from "vue";
import { formatDisplayDate, formatDisplayDateTime } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useApplicantOrientationVideos, useSendOrientationVideos } from "@/features/recruitment/useOrientationVideos";

/**
 * The orientation videos step's drawer (HW8a, 0538; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8) — it was
 * "unbuilt". The carrier's videos, each with what the applicant did with it, and "Send the videos".
 *
 * ── HONEST WORDS ──────────────────────────────────────────────────────────────────────────────
 * "Opened" means the link was pressed on the applicant's page — all a link list can know (§8.2). "Said
 * they watched" is the applicant's tick, with the name they typed. Nothing here says "watched" as a
 * measured fact.
 *
 * ── THE SEND ──────────────────────────────────────────────────────────────────────────────────
 * The application link, sent again and pointed at the videos page, by email and by text where the
 * applicant agreed to texts (`orientationVideosApplicant.ts`). The earlier link stops working, as with
 * "send the link again", and the button says that before it is pressed.
 *
 * An empty list is the state this ships in (Q-WF8 is the owner's): it says where to add the videos.
 */
const props = defineProps<{ driverId: string }>();
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const q = useApplicantOrientationVideos(toRef(props, "driverId"));
const send = useSendOrientationVideos();

const view = computed(() => q.data.value ?? null);
const statusOf = (v: { openedAt: string | null; attestedAt: string | null }): string => {
  if (v.attestedAt) return `Said they watched it · ${formatDisplayDate(v.attestedAt)}`;
  if (v.openedAt) return `Opened ${formatDisplayDate(v.openedAt)} · not ticked yet`;
  return "Not opened";
};

const TEXT_WORDS: Record<string, string> = {
  sent: "and by text",
  queued: "and by text in their morning",
  held: "— not by text: they have not agreed to texts",
  failed: "— the text could not be sent",
};

async function sendVideos(): Promise<void> {
  try {
    const r = await send.mutateAsync(props.driverId);
    const where = r.email.sent ? `By email to ${r.email.email}` : "Not by email — there is no address to send to";
    toast.success("Videos sent", `${where} ${TEXT_WORDS[r.text.state] ?? ""}.`.replace(" .", "."));
  } catch (e) {
    toast.error("Could not send the videos", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <QueryState
    :loading="q.isPending.value"
    :error="q.isError.value ? q.error.value : null"
    error-text="Could not load the applicant's videos."
    :retrying="q.isFetching.value"
    loading-text="Loading the videos…"
    compact
    @retry="q.refetch()"
  >
    <div v-if="view" class="space-y-4" data-testid="orientation-videos-panel">
      <AppCallout v-if="view.videos.length === 0" tone="info" data-testid="no-videos">
        No orientation videos yet. Add your videos in Settings → Recruiting, then send them from here.
        <BaseButton v-if="canManage" variant="link" size="sm" to="/settings/recruiting">Open Settings → Recruiting</BaseButton>
      </AppCallout>

      <template v-else>
        <h3 class="text-sm font-semibold text-ink">Videos</h3>
        <ul class="divide-y divide-edge">
          <li v-for="v in view.videos" :key="v.id" class="flex items-start justify-between gap-4 py-2">
            <div class="min-w-0">
              <a :href="v.url" target="_blank" rel="noopener noreferrer" class="text-sm text-link hover:text-link-hover">{{ v.title }}</a>
              <p class="text-xs text-ink-muted">{{ v.required ? "Required" : "Optional" }}{{ v.minutes ? ` · ${v.minutes} min` : "" }}</p>
            </div>
            <span class="shrink-0 text-xs text-ink-secondary" :data-testid="`video-status-${v.id}`">{{ statusOf(v) }}</span>
          </li>
        </ul>

        <p v-if="view.lastAttestation" class="text-xs text-ink-secondary" data-testid="last-attestation">
          {{ view.lastAttestation.signerName }} ticked “I watched these” on {{ formatDisplayDateTime(view.lastAttestation.attestedAt) }}.
        </p>
        <p class="text-xs text-ink-muted" data-testid="sent-at">
          {{ view.sentAt ? `Last sent ${formatDisplayDateTime(view.sentAt)}.` : "Not sent yet." }}
        </p>

        <template v-if="canManage">
          <p v-if="!view.canSend" class="text-xs text-ink-secondary" data-testid="cannot-send">
            Send the invitation first — the videos go out on the same link.
          </p>
          <div v-else class="space-y-1">
            <BaseButton size="sm" :disabled="send.isPending.value" data-testid="send-videos" @click="sendVideos">
              {{ send.isPending.value ? "Sending…" : view.sentAt ? "Send the videos again" : "Send the videos" }}
            </BaseButton>
            <p class="text-xs text-ink-muted">
              Goes by email, and by text if they agreed to texts. It replaces their application link; the old one stops working.
            </p>
          </div>
        </template>
      </template>
    </div>
  </QueryState>
</template>
