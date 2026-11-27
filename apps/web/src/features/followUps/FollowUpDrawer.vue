<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import {
  FOLLOW_UP_ACTION_LABELS,
  FOLLOW_UP_CATEGORY_LABELS,
  formatDisplayDateTime,
  type FollowUpAction,
  type FollowUpVideo,
  type FollowUpWarning,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppFormField, AppLinkArrow, AppTextarea, QueryState } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { phoneDialString, formatPhone } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { useFollowUpAction, useFollowUpDetailQuery, useFollowUpVideo } from "./useFollowUps";
import { coachingLabel, driverLabel, problemDetail, SEVERITY_BADGE, stateBadge, unitLabel } from "./followUpRows";

/**
 * One follow-up (WARNING-DESK-PLAN §4, D-WD7–D-WD9, D-WD16): what Samsara said, in time order; the
 * video of a safety event, fetched fresh on the click and never stored; the five things a person does
 * — called, no answer, sent to shop, close fixed, close not a problem — and every one of them, by whom.
 *
 * Calls only, no texts (D-WD16, until Q-TR9). Closing here changes nothing in Samsara (D-WD8).
 */
const props = defineProps<{ id: string | null }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();

const { data, isLoading, isError, error, isFetching, refetch } = useFollowUpDetailQuery(toRef(props, "id"));
const act = useFollowUpAction();
const video = useFollowUpVideo();

const note = ref("");
const noteErr = ref<string | undefined>();
const videos = ref<Record<string, FollowUpVideo>>({});
watch(
  () => props.id,
  () => {
    note.value = "";
    noteErr.value = undefined;
    videos.value = {};
  },
);

const line = computed(() => data.value?.line ?? null);
const open = computed(() => line.value !== null && line.value.status !== "closed");
const dial = computed(() => phoneDialString(line.value?.driver?.phone));
const title = computed(() => line.value?.ruleLabel ?? "Follow-up");

const BUTTONS: { action: FollowUpAction; label: string; variant: "primary" | "secondary" }[] = [
  { action: "called", label: "Called driver", variant: "primary" },
  { action: "no_answer", label: "No answer", variant: "secondary" },
  { action: "sent_to_shop", label: "Sent to shop", variant: "secondary" },
  { action: "closed_fixed", label: "Close — fixed", variant: "secondary" },
  { action: "closed_not_a_problem", label: "Close — not a problem", variant: "secondary" },
];

async function run(action: FollowUpAction) {
  const l = line.value;
  if (!l) return;
  const text = note.value.trim();
  if ((action === "closed_not_a_problem" || action === "note") && !text) {
    noteErr.value = action === "note" ? "Write the note first." : "Say why it is not a problem — the next person reads this.";
    return;
  }
  noteErr.value = undefined;
  try {
    await act.mutateAsync({ id: l.id, action, note: text || null, version: l.version });
    note.value = "";
    toast.success(FOLLOW_UP_ACTION_LABELS[action]);
    if (action.startsWith("closed_")) emit("close");
  } catch (e) {
    toast.error("Could not save that", e instanceof Error ? e.message : undefined);
  }
}

async function copyPhone() {
  const phone = line.value?.driver?.phone;
  if (!phone) return;
  try {
    await navigator.clipboard.writeText(formatPhone(phone));
    toast.success("Phone number copied");
  } catch {
    toast.error("Could not copy", "Select the number and copy it by hand.");
  }
}

async function playVideo(w: FollowUpWarning) {
  if (!line.value || !w.videoEventId) return;
  try {
    videos.value = { ...videos.value, [w.id]: await video.mutateAsync({ id: line.value.id, eventId: w.videoEventId }) };
  } catch (e) {
    toast.error("Could not fetch the video", e instanceof Error ? e.message : undefined);
  }
}

const CAMERA: Record<string, string> = { dashcamForwardFacing: "Road", dashcamDriverFacing: "Driver" };
</script>

<template>
  <SlideOver :open="id !== null" :title="title" size="lg" @close="emit('close')">
    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the follow-up…"
      error-text="Could not load this follow-up."
      @retry="refetch()"
    >
      <div v-if="data && line" class="space-y-6">
        <section aria-labelledby="fu-who" class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <AppBadge :tone="stateBadge(line).tone">{{ stateBadge(line).text }}</AppBadge>
            <AppBadge v-if="SEVERITY_BADGE[line.severity]" :tone="SEVERITY_BADGE[line.severity]!.tone">{{ SEVERITY_BADGE[line.severity]!.text }}</AppBadge>
            <span class="text-xs text-ink-tertiary">{{ FOLLOW_UP_CATEGORY_LABELS[line.category] }} · {{ problemDetail(line) }}</span>
          </div>
          <h3 id="fu-who" class="text-sm font-semibold text-ink">{{ unitLabel(line) || line.subjectName }}</h3>
          <p v-if="line.driver" class="text-sm text-ink-secondary">{{ driverLabel(line) }}</p>
          <div v-if="line.driver?.phone" class="flex flex-wrap items-center gap-3">
            <a v-if="dial" :href="`tel:${dial}`" class="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-hover" data-test="tel">{{ formatPhone(line.driver.phone) }}</a>
            <span v-else class="text-sm text-ink-secondary">{{ line.driver.phone }}</span>
            <AppButton size="sm" variant="secondary" @click="copyPhone">Copy</AppButton>
          </div>
          <p v-else-if="line.driver" class="text-xs text-ink-tertiary">No phone number on the driver's record.</p>
          <p v-else class="text-xs text-ink-tertiary">Nobody is on this unit in Samsara right now.</p>
        </section>

        <section v-if="open && data.canAct" aria-labelledby="fu-act" class="space-y-3">
          <h3 id="fu-act" class="text-sm font-semibold text-ink">What did you do?</h3>
          <AppFormField v-slot="{ id: fieldId }" label="Note" :error="noteErr">
            <AppTextarea :id="fieldId" v-model="note" rows="3" maxlength="2000" :invalid="Boolean(noteErr)" placeholder="What the driver said, what the shop will do…" />
          </AppFormField>
          <div class="flex flex-wrap gap-2">
            <AppButton
              v-for="b in BUTTONS"
              :key="b.action"
              :variant="b.variant"
              size="sm"
              :disabled="act.isPending.value"
              :data-test="`act-${b.action}`"
              @click="run(b.action)"
            >
              {{ b.label }}
            </AppButton>
            <AppButton variant="link" size="sm" :disabled="act.isPending.value || !note.trim()" @click="run('note')">Save note only</AppButton>
          </div>
          <p class="text-xs text-ink-tertiary">
            Closing here does not change Samsara: a safety event stays in Samsara's coaching list until it is coached there.
          </p>
        </section>
        <p v-else-if="open" class="text-sm text-ink-muted">You can read this follow-up but not change it.</p>

        <section aria-labelledby="fu-warnings" class="space-y-3">
          <h3 id="fu-warnings" class="text-sm font-semibold text-ink">What Samsara said</h3>
          <ol class="space-y-3">
            <li v-for="w in data.warnings" :key="w.id" class="rounded-detail ring-1 ring-edge p-3 space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-medium text-ink">{{ w.label }}</span>
                <AppBadge v-if="w.stillActive" tone="caution">Still on</AppBadge>
              </div>
              <p class="text-xs text-ink-tertiary">
                {{ formatDisplayDateTime(w.happenedAt) }}<template v-if="w.endedAt && w.endedAt !== w.happenedAt"> – {{ formatDisplayDateTime(w.endedAt) }}</template>
                <template v-if="w.unitName"> · {{ w.unitName }}</template>
                <template v-if="w.driverName"> · {{ w.driverName }}</template>
                <template v-if="w.coachingState"> · Samsara: {{ coachingLabel(w.coachingState) }}</template>
              </p>
              <div class="flex flex-wrap items-center gap-3">
                <a v-if="w.samsaraUrl" :href="w.samsaraUrl" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 text-sm text-link hover:text-link-hover">Open in Samsara <AppLinkArrow external /></a>
                <AppButton v-if="w.videoEventId && !videos[w.id]" variant="secondary" size="sm" :disabled="video.isPending.value" @click="playVideo(w)">Play video</AppButton>
              </div>
              <template v-if="videos[w.id]">
                <AppCallout v-if="videos[w.id]!.restricted" tone="info">
                  Samsara keeps crash video restricted. Open it in Samsara to watch it.
                </AppCallout>
                <template v-else-if="!videos[w.id]!.restricted">
                  <p v-if="(videos[w.id] as Extract<FollowUpVideo, { restricted: false }>).urls.length === 0" class="text-xs text-ink-tertiary">Samsara has no video for this event.</p>
                  <figure v-for="m in (videos[w.id] as Extract<FollowUpVideo, { restricted: false }>).urls" :key="m.url" class="space-y-1">
                    <!-- Signed link, ~8 h life, never stored (D-WD7); `media-src` admits *.samsara.com. -->
                    <video :src="m.url" controls playsinline preload="metadata" class="w-full rounded-detail bg-surface-subtle" />
                    <figcaption v-if="m.input" class="text-2xs text-ink-tertiary">{{ CAMERA[m.input] ?? m.input }} camera</figcaption>
                  </figure>
                </template>
              </template>
            </li>
          </ol>
          <p v-if="data.warnings.length === 0" class="text-sm text-ink-muted">Samsara's warnings for this follow-up are older than 90 days and no longer kept.</p>
        </section>

        <section aria-labelledby="fu-history" class="space-y-2">
          <h3 id="fu-history" class="text-sm font-semibold text-ink">History</h3>
          <ul v-if="data.actions.length" class="space-y-2">
            <li v-for="a in data.actions" :key="a.id" class="text-sm">
              <span class="font-medium text-ink">{{ FOLLOW_UP_ACTION_LABELS[a.action] }}</span>
              <span class="text-ink-tertiary"> · {{ a.actorName }} · {{ formatDisplayDateTime(a.at) }}</span>
              <p v-if="a.note" class="text-ink-secondary whitespace-pre-line">{{ a.note }}</p>
            </li>
          </ul>
          <p v-else class="text-sm text-ink-muted">Nobody has acted on this yet. First warning {{ formatDisplayDateTime(line.firstAt) }}.</p>
        </section>
      </div>
    </QueryState>
  </SlideOver>
</template>
