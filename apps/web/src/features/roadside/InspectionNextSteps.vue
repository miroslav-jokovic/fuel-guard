<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon, QueryState } from "@silvicom/ui";
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from "@silvicom/ui/icons";
import {
  roadsideNextSteps,
  roadsideOpenSteps,
  todayInZone,
  type RoadsideAttributionDto,
  type RoadsideStep,
  type RoadsideStepOwner,
  type RoadsideStepSection,
} from "@silvicom/shared";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useInspectionRepairsQuery, useRepairCertificationQuery } from "./useRoadsideInspections";

/**
 * What is left to do on this inspection, first on the page (INSPECTION-CHALLENGE-PLAN Q-IC17, IC15).
 *
 * Every step is `roadsideNextSteps`'s — the same function the inbox, the Shop home and the bell read — and
 * the inputs are the queries the cards below already hold (vue-query shares them by key), so the strip
 * and the card it points at cannot disagree and nothing is fetched twice. A step's button scrolls to the
 * card where its action is; the strip itself decides nothing.
 *
 * The strip waits for the repair record before it says anything: drawn without it, it would first claim
 * there is nothing to repair and then grow steps under the reader's eye.
 */

const props = defineProps<{ inspectionId: string; attribution: RoadsideAttributionDto }>();
const id = toRef(props, "inspectionId");
const emit = defineEmits<{ go: [section: RoadsideStepSection] }>();

const { zone } = useOrgTimezone();
const repairs = useInspectionRepairsQuery(id);
const certification = useRepairCertificationQuery(id);

const steps = computed(() =>
  repairs.data.value
    ? roadsideNextSteps({
        attribution: props.attribution,
        repairs: repairs.data.value,
        certification: certification.data.value ?? null,
        today: todayInZone(new Date(), zone.value),
      })
    : [],
);
const open = computed(() => roadsideOpenSteps(steps.value));

const OWNER: Record<RoadsideStepOwner, string> = { safety: "Safety", maintenance: "Maintenance" };
const GO: Record<RoadsideStepSection, string> = { driver: "Go to driver", documents: "Go to documents", repair: "Go to repair" };

const summary = computed(() => {
  const o = open.value;
  if (o.total === 0) return { text: "Nothing left to do", tone: "success" };
  const maintenance = o.byOwner.maintenance ? ` · ${o.byOwner.maintenance} for maintenance` : "";
  return { text: `${o.total} open${maintenance}`, tone: "warning" };
});

/** "Due 10/29/2026 · 10 days left", or the days overdue in red. */
function due(s: RoadsideStep): { text: string; tone: string } | null {
  if (!s.dueOn || !s.clock) return null;
  const n = s.clock.days;
  if (s.clock.overdue) return { text: `${n} ${n === 1 ? "day" : "days"} overdue (due ${formatDate(s.dueOn)})`, tone: "text-danger-700 font-medium" };
  const left = n === 0 ? "due today" : `${n} ${n === 1 ? "day" : "days"} left`;
  return { text: `Due ${formatDate(s.dueOn)} · ${left}`, tone: n <= 3 ? "text-warning-700 font-medium" : "text-ink-muted" };
}

const ICON = { open: ExclamationTriangleIcon, waiting: ClockIcon, done: CheckCircleIcon } as const;
const ICON_TONE = { open: "text-warning-600", waiting: "text-ink-tertiary", done: "text-success-600" } as const;
</script>

<template>
  <BaseCard data-test="next-steps">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-ink">Next steps</h2>
      <span v-if="steps.length" :class="[BADGE_BASE, toneClass(summary.tone)]" data-test="next-steps-summary">{{ summary.text }}</span>
    </div>
    <div class="mt-3">
      <QueryState
        compact
        :loading="repairs.isLoading.value && !repairs.data.value"
        :error="repairs.isError.value ? repairs.error.value : null"
        :retrying="repairs.isFetching.value"
        loading-text="Working out what is left…"
        error-text="Could not work out what is left on this inspection."
        @retry="repairs.refetch()"
      >
        <ul class="divide-y divide-edge">
          <li
            v-for="s in steps"
            :key="s.key"
            class="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0 text-sm"
            :data-test="`step-${s.key}`"
            :data-state="s.state"
          >
            <AppIcon :icon="ICON[s.state]" :class="['mt-0.5 size-5 shrink-0', ICON_TONE[s.state]]" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p :class="s.state === 'done' ? 'text-ink-secondary' : 'font-medium text-ink'">
                {{ s.title }}<template v-if="s.state === 'done' && s.detail"><span class="text-ink-muted"> · {{ s.detail }}</span></template>
                <span v-if="s.state !== 'done'" :class="['ml-2', BADGE_BASE, toneClass('neutral')]">{{ OWNER[s.owner] }}</span>
              </p>
              <p v-if="s.state !== 'done' && s.detail" class="mt-0.5 text-ink-muted">{{ s.detail }}</p>
              <p v-if="s.state !== 'done' && due(s)" :class="['mt-0.5 text-xs', due(s)!.tone]" data-test="step-due">{{ due(s)!.text }}</p>
            </div>
            <BaseButton v-if="s.state === 'open'" variant="link" class="shrink-0" :data-test="`step-go-${s.key}`" @click="emit('go', s.section)">
              {{ GO[s.section] }}
            </BaseButton>
          </li>
        </ul>
      </QueryState>
    </div>
  </BaseCard>
</template>
