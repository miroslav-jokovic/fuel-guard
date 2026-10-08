<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppTextarea } from "@silvicom/ui";
import {
  ANOMALY_DISPOSITIONS, DISPOSITION_LABELS, incidentStory,
  type AnomalyDisposition, type CardFraudIncidentTransition,
} from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useCardFraudIncident, useCardFraudIncidentTransition } from "./useCardFraudIncident";

/**
 * A card used where its truck was not (CF2), opened from the fuel queue (F02-F04 chunk 8c3).
 *
 * What happened first, in plain sentences (`incidentStory`); then each attempt with its time; then the
 * actions, which work exactly as a fill case's do (`AnomalyDetail`): pick a verdict, write a note, resolve
 * or dismiss; reopen a closed one. Only a person who manages fuel sees the actions (Q-F11 (a)), the same
 * rule the API enforces.
 */
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ changed: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const { data: incident, isLoading, isError, error } = useCardFraudIncident(toRef(props, "id"));
const transition = useCardFraudIncidentTransition();

const story = computed(() => (incident.value ? incidentStory(incident.value) : []));
const isOpen = computed(() => incident.value?.status === "open" || incident.value?.status === "investigating");
const canAct = computed(() => session.can("fuel"));

const verdicts = ANOMALY_DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABELS[d] }));
const disposition = ref<AnomalyDisposition | null>(null);
const note = ref("");

const STEP_WORDS = { opened: "First try", escalated: "Got worse", new_place: "New place" } as const;
const SOURCE_WORDS = { decline: "Declined", fill: "Fuel taken" } as const;

async function move(status: CardFraudIncidentTransition["status"]): Promise<void> {
  const d = incident.value;
  if (!d) return;
  const closing = status !== "investigating";
  if (closing && (!disposition.value || !note.value.trim())) {
    toast.error("Pick a verdict and write a note", "Both are needed to close an incident.");
    return;
  }
  try {
    await transition.mutateAsync({
      id: d.id,
      status,
      version: d.version,
      note: note.value.trim() || undefined,
      disposition: closing ? disposition.value! : undefined,
    });
    toast.success(status === "investigating" ? "Incident is being investigated" : "Incident closed");
    note.value = "";
    disposition.value = null;
    emit("changed");
  } catch (e) {
    toast.error("Could not update the incident", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="text-sm text-danger-700">
      Couldn't load the incident: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <template v-else-if="incident">
      <div class="space-y-1.5">
        <span :class="[BADGE_BASE, toneClass(incident.level === 'escalated' ? 'danger' : 'warning')]">
          {{ incident.level === "escalated" ? "Escalated" : "Alert" }}
        </span>
        <p v-for="line in story" :key="line" class="text-sm text-ink">{{ line }}</p>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-medium text-ink-muted">Attempts</p>
        <ul class="divide-y divide-edge rounded-surface ring-1 ring-edge">
          <li v-for="a in incident.attempts" :key="a.attemptedAt + a.source" class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span class="text-ink-secondary">{{ formatDateTime(a.attemptedAt) }}</span>
            <span class="text-ink">{{ SOURCE_WORDS[a.source] }}<span v-if="a.step" class="text-ink-muted"> · {{ STEP_WORDS[a.step] }}</span></span>
          </li>
        </ul>
      </div>

      <div v-if="isOpen && canAct" class="space-y-3 border-t border-edge pt-5">
        <p class="text-xs font-medium text-ink-muted">Verdict <span class="text-ink-tertiary">(needed to close)</span></p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            v-for="v in verdicts"
            :key="v.value"
            type="button"
            class="rounded-full px-3 py-1 text-sm ring-1 ring-inset transition-colors"
            :class="disposition === v.value ? 'bg-action-primary text-action-primary-foreground ring-action-primary' : 'bg-surface text-ink-secondary ring-edge-control hover:bg-surface-subtle'"
            @click="disposition = v.value"
          >
            {{ v.label }}
          </BaseButton>
        </div>
        <AppTextarea v-model="note" rows="2" placeholder="Note (needed to close)" />
        <div class="flex flex-wrap gap-2">
          <BaseButton
            v-if="incident.status === 'open'"
            variant="secondary"
            :disabled="transition.isPending.value"
            @click="move('investigating')"
          >
            Start investigating
          </BaseButton>
          <BaseButton :disabled="transition.isPending.value" @click="move('resolved')">Resolve</BaseButton>
          <BaseButton variant="secondary" :disabled="transition.isPending.value" @click="move('dismissed')">Dismiss</BaseButton>
        </div>
      </div>

      <div v-else-if="!isOpen" class="space-y-2 border-t border-edge pt-4 text-sm text-ink-muted">
        <p>
          Closed<span v-if="incident.disposition">: {{ DISPOSITION_LABELS[incident.disposition] }}</span>
          <span v-if="incident.resolutionNote"> — {{ incident.resolutionNote }}</span>
        </p>
        <BaseButton v-if="canAct" size="sm" variant="secondary" :disabled="transition.isPending.value" @click="move('investigating')">
          Reopen
        </BaseButton>
      </div>
    </template>
  </div>
</template>
