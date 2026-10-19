<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppDateField,
  AppFormField as FormField,
  AppTextarea as BaseTextarea,
  QueryState,
} from "@silvicom/ui";
import { COURT_FOLLOW_UP_DAYS, citationStanding, shiftDay, todayInZone, type RoadsideCitationDto } from "@silvicom/shared";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";
import { RepairDecisionError, useActOnCitation, useInspectionCitationsQuery } from "./useRoadsideInspections";

/**
 * The inspection's tickets and their court results (INSPECTION-CHALLENGE-PLAN IC4, R-ADJ1; Q-IC2 (a): the safety
 * office obtains them). Each ticket says where it stands — `citationStanding`, the rule the Next steps strip and
 * the inbox read — and offers the office's two acts: "Requested from the court" (with the day to follow up,
 * 30 days on by default) and "Not contested". The third way to close it is filing the court's paper on the
 * Documents card, which this card points at rather than duplicates.
 *
 * Acting needs the safety section's manage level, which the API checks; the buttons only follow it. Hidden on an
 * inspection with no ticket (a warning is not one).
 */

const props = defineProps<{ inspectionId: string; inspectionDate: string | null }>();
const emit = defineEmits<{ fileResult: [] }>();
const id = toRef(props, "inspectionId");

const session = useSessionStore();
const canAct = computed(() => session.can("safety"));
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

const { data, isLoading, isError, error, isFetching, refetch } = useInspectionCitationsQuery(id);
const act = useActOnCitation(id);
const show = computed(() => isLoading.value || isError.value || (data.value?.tickets.length ?? 0) > 0);

const standing = (t: RoadsideCitationDto) => citationStanding(t, data.value?.courtResultFiled ?? false, props.inspectionDate, today.value);
function badge(t: RoadsideCitationDto): { text: string; tone: string } {
  const s = standing(t);
  switch (s.kind) {
    case "decided":
      return { text: s.text, tone: /dismiss|not guilty/i.test(s.text) ? "success" : "neutral" };
    case "result_filed":
      return { text: "Court result on file", tone: "success" };
    case "not_contested":
      return { text: "Not contested", tone: "neutral" };
    case "too_old":
      return { text: "Past the 24 months CSA counts", tone: "neutral" };
    case "too_soon":
      return { text: `Court has until ${formatDate(s.askOn)}`, tone: "neutral" };
    case "requested":
      return { text: `Requested · follow up ${formatDate(s.followUpOn)}`, tone: "brand" };
    case "follow_up":
      return { text: "Follow up with the court", tone: "warning" };
    case "ask":
      return { text: "Get the court result", tone: "warning" };
  }
}
/** Acts are offered while the court's word can still change something. */
const actable = (t: RoadsideCitationDto) => canAct.value && ["ask", "follow_up", "requested", "too_soon"].includes(standing(t).kind);

const writing = ref<{ violationId: string; kind: "requested_from_court" | "not_contested" } | null>(null);
const followUpOn = ref("");
const note = ref("");
function start(t: RoadsideCitationDto, kind: "requested_from_court" | "not_contested") {
  act.reset();
  note.value = "";
  followUpOn.value = shiftDay(today.value, COURT_FOLLOW_UP_DAYS);
  writing.value = { violationId: t.violationId, kind };
}
function save(t: RoadsideCitationDto) {
  const w = writing.value!;
  const base = { violationId: t.violationId, basedOn: t.action?.id ?? null, note: note.value.trim() || undefined };
  act.mutate(
    w.kind === "requested_from_court" ? { ...base, action: "requested_from_court", followUpOn: followUpOn.value } : { ...base, action: "not_contested" },
    { onSuccess: () => (writing.value = null) },
  );
}
const failure = computed(() => {
  const e = act.error.value;
  if (!e) return null;
  return e instanceof RepairDecisionError && e.code === "changed" ? "Someone else recorded something about this ticket. It is shown again above." : e.message;
});
const ACT_TEXT = { requested_from_court: "Requested from the court", not_contested: "Not contested" } as const;
</script>

<template>
  <BaseCard v-if="show" data-test="tickets-card">
    <h2 class="text-sm font-semibold text-ink">Tickets</h2>
    <p class="mt-1 text-sm text-ink-muted">
      A court's dismissal removes the violation from CSA and a different charge lowers it; a paid ticket keeps its full weight for 24 months. FMCSA's record carries a result only when the state sends one.
    </p>
    <div class="mt-4">
      <QueryState
        compact
        :loading="isLoading && !data"
        :error="isError ? error : null"
        :retrying="isFetching"
        loading-text="Loading the tickets…"
        error-text="Could not load the tickets."
        @retry="refetch()"
      >
        <div class="divide-y divide-edge">
          <section v-for="t in data?.tickets ?? []" :key="t.violationId" class="space-y-2 py-4 text-sm first:pt-0 last:pb-0" data-test="ticket">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-ink">Ticket {{ t.citationNumber }}</h3>
              <span :class="[BADGE_BASE, toneClass(badge(t).tone)]" data-test="ticket-badge">{{ badge(t).text }}</span>
            </div>
            <p class="text-ink-muted"><span class="font-mono text-xs">{{ t.code }}</span> — {{ t.description }}</p>
            <p v-if="t.action" class="text-ink-muted" data-test="ticket-act">
              {{ ACT_TEXT[t.action.kind] }} by {{ t.action.actedBy ?? "a former user" }} on {{ formatDateTime(t.action.actedAt) }}<template v-if="t.action.note">: “{{ t.action.note }}”</template>
            </p>

            <div v-if="actable(t) && writing?.violationId !== t.violationId" class="flex flex-wrap gap-2" data-test="ticket-actions">
              <BaseButton size="sm" variant="primary" data-test="ticket-requested" @click="start(t, 'requested_from_court')">
                {{ t.action?.kind === "requested_from_court" ? "Asked the court again" : "Requested from the court" }}
              </BaseButton>
              <BaseButton size="sm" data-test="ticket-result" @click="emit('fileResult')">Upload the court result</BaseButton>
              <BaseButton size="sm" variant="link" data-test="ticket-not-contested" @click="start(t, 'not_contested')">Not contested (paid)</BaseButton>
            </div>

            <form v-if="writing?.violationId === t.violationId" class="space-y-3 rounded-detail border border-edge p-3" data-test="ticket-form" @submit.prevent="save(t)">
              <p v-if="writing.kind === 'not_contested'" class="text-ink">
                A paid ticket is a conviction of the original charge: the violation keeps its full CSA weight, and there is nothing to file in DataQs.
              </p>
              <FormField v-if="writing.kind === 'requested_from_court'" v-slot="{ id: fieldId }" label="Follow up on" required>
                <AppDateField :id="fieldId" v-model="followUpOn" :min-date="today" data-test="ticket-follow-up" />
              </FormField>
              <FormField v-slot="{ id: fieldId }" label="Note">
                <BaseTextarea :id="fieldId" v-model="note" maxlength="1000" placeholder="For example: Will County Circuit Court, case 26TR1234, asked by email." />
              </FormField>
              <div class="flex gap-2">
                <BaseButton variant="primary" type="submit" :disabled="act.isPending.value || (writing.kind === 'requested_from_court' && !followUpOn)" data-test="ticket-save">Save</BaseButton>
                <BaseButton @click="writing = null">Cancel</BaseButton>
              </div>
            </form>
          </section>
        </div>
      </QueryState>
    </div>
    <p v-if="failure" class="mt-3 text-sm text-danger-700" role="alert" data-test="ticket-error">{{ failure }}</p>
  </BaseCard>
</template>
