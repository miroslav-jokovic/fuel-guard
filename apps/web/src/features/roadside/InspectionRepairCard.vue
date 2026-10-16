<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppTextarea as BaseTextarea,
  QueryState,
} from "@silvicom/ui";
import { REPAIR_OUTCOME_TEXT, repairClock, repairSettled, repairUnitName, todayInZone, type RepairCandidate, type RoadsideRepairDto } from "@silvicom/shared";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";
import { RepairDecisionError, useCertifyRepairs, useDecideRepair, useInspectionRepairsQuery, useRepairCertificationQuery } from "./useRoadsideInspections";

/**
 * The repair of the inspection's vehicle violations (INSPECTION-CHALLENGE-PLAN IC11, D-IC14; 49 CFR
 * 396.9(d): corrected, in the maintenance record, certified within 15 days). One block per inspected unit
 * with a Part 393/396 violation: the FleetPal work orders the engine found on that unit between the
 * inspection and the due day, and the days left.
 *
 * ── THE ENGINE PROPOSES, MAINTENANCE DECIDES ───────────────────────────────────────────────────
 * Measured 2026-10-16, one work order in the window is the repair only some of the time (Q-IC14), so
 * nothing is pre-chosen: a person accepts the work order whose jobs answer the violations, or says the
 * repair was done outside FleetPal and where. Deciding needs the MAINTENANCE section's manage level
 * (Q-IC13), which the API checks; the buttons only follow it.
 *
 * ── THEN SAFETY CERTIFIES THE REPORT ───────────────────────────────────────────────────────────
 * Once every unit is settled (`repairSettled`), a safety manager certifies — 396.9(d)(3)(i)'s signature,
 * title and date. The name and the date are the server's; the person gives only their title. The rendered
 * repair record is filed on the Documents card with it. A unit re-read or re-decided afterwards leaves the
 * old certification standing for what it named and asks for a new one (`current: false`).
 *
 * A unit FMCSA could not tie to our fleet may still be closed as "outside FleetPal" with where — an
 * interchange trailer is repaired by its owner — or no inspection carrying one could ever be certified.
 *
 * Hidden when the engine has read no unit: an inspection with no vehicle violation, or older than a year.
 */

const props = defineProps<{ inspectionId: string }>();
const id = toRef(props, "inspectionId");

const session = useSessionStore();
const canDecide = computed(() => session.can("maintenance"));
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

const { data: repairs, isLoading, isError, error, isFetching, refetch } = useInspectionRepairsQuery(id);
const decide = useDecideRepair(id);

const show = computed(() => isLoading.value || isError.value || (repairs.value?.length ?? 0) > 0);

const unitName = repairUnitName;

/** The badge: closed when decided or repaired at the scene; otherwise the clock, red once overdue. */
function badge(r: RoadsideRepairDto): { text: string; tone: string } {
  if (r.decision) return { text: r.decision.outcome === "accepted" ? "Repair recorded" : "Repaired outside FleetPal", tone: "success" };
  if (r.proposal.outcome === "repaired_at_scene") return { text: "Repaired at the scene", tone: "success" };
  const c = repairClock(r.dueOn, today.value);
  if (c.overdue) return { text: `Overdue ${c.days} ${c.days === 1 ? "day" : "days"}`, tone: "danger" };
  return { text: c.days === 0 ? "Due today" : `${c.days} ${c.days === 1 ? "day" : "days"} left`, tone: c.days <= 3 ? "warning" : "neutral" };
}

/** What may be decided on a unit: anything the engine could not close by itself. */
const decidable = (r: RoadsideRepairDto) => canDecide.value && r.proposal.outcome !== "repaired_at_scene";

const writingFor = ref<string | null>(null);
const note = ref("");
const failure = computed(() => {
  const e = decide.error.value;
  if (!e) return null;
  return e instanceof RepairDecisionError && e.code === "changed"
    ? "This repair changed while the page was open — a work order opened, or someone else decided. It is shown again above; look before deciding."
    : e.message;
});

function accept(r: RoadsideRepairDto, c: RepairCandidate) {
  decide.mutate({ action: "accept", unitId: r.unitId, basedOn: r.basedOn, workOrderId: c.workOrderId });
}
function startOutside(r: RoadsideRepairDto) {
  decide.reset();
  note.value = "";
  writingFor.value = r.unitId;
}
function saveOutside(r: RoadsideRepairDto) {
  decide.mutate({ action: "outside", unitId: r.unitId, basedOn: r.basedOn, note: note.value.trim() }, { onSuccess: () => (writingFor.value = null) });
}

const canCertify = computed(() => session.can("safety"));
const { data: certification } = useRepairCertificationQuery(id);
const certify = useCertifyRepairs(id);
const settled = computed(() => (repairs.value?.length ?? 0) > 0 && repairs.value!.every(repairSettled));
/** The form shows when there is something to certify: settled, and never certified or no longer current. */
const certifiable = computed(() => canCertify.value && settled.value && !certification.value?.current);
const signerTitle = ref("");
const certifyFailure = computed(() => {
  const e = certify.error.value;
  if (!e) return null;
  return e instanceof RepairDecisionError && e.code === "changed"
    ? "The repair record changed while the page was open. It is shown again above; look before certifying."
    : e.message;
});
function submitCertification() {
  certify.mutate({ signerTitle: signerTitle.value.trim(), basedOn: (repairs.value ?? []).map((r) => r.basedOn) });
}
</script>

<template>
  <BaseCard v-if="show" data-test="repair-card">
    <h2 class="text-sm font-semibold text-ink">Repair</h2>
    <p class="mt-1 text-sm text-ink-muted">
      Every vehicle violation must be repaired, recorded in the maintenance file, and certified within 15 days of the inspection (49 CFR 396.9(d)). These are the FleetPal work orders opened on each unit since the inspection.
    </p>

    <div class="mt-4" data-test="repair-state">
      <QueryState
        compact
        :loading="isLoading && !repairs"
        :error="isError ? error : null"
        :retrying="isFetching"
        loading-text="Loading the repair record…"
        error-text="Could not load the repair record."
        @retry="refetch()"
      >
        <div class="divide-y divide-edge">
          <section v-for="r in repairs" :key="r.unitId" class="py-4 first:pt-0 last:pb-0 text-sm" data-test="repair-unit">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-ink">{{ unitName(r) }}</h3>
              <span :class="[BADGE_BASE, toneClass(badge(r).tone)]" data-test="repair-badge">{{ badge(r).text }}</span>
              <span class="text-xs text-ink-tertiary">Due {{ formatDate(r.dueOn) }}</span>
            </div>
            <ul v-if="r.violations.length" class="mt-1 text-ink-muted" data-test="repair-violations">
              <li v-for="(v, i) in r.violations" :key="i">{{ v.code }}<template v-if="v.description"> — {{ v.description }}</template></li>
            </ul>

            <div v-if="r.decision" class="mt-3 text-ink" data-test="repair-decision">
              <p v-if="r.decision.workOrder">
                Repaired under FleetPal work order <span class="font-medium">{{ r.decision.workOrder.reference ?? r.decision.workOrder.workOrderId }}</span>
                (opened {{ formatDate(r.decision.workOrder.openedOn) }}).
              </p>
              <p v-else>Repaired outside FleetPal: “{{ r.decision.note }}”</p>
              <p class="text-ink-muted">Recorded by {{ r.decision.decidedBy ?? "a former user" }} on {{ formatDateTime(r.decision.decidedAt) }}.</p>
            </div>

            <p class="mt-3 text-ink-muted" data-test="repair-proposal">{{ REPAIR_OUTCOME_TEXT[r.proposal.outcome] }}</p>
            <ul v-if="r.proposal.candidates.length" class="mt-2 space-y-2" data-test="repair-candidates">
              <li v-for="c in r.proposal.candidates" :key="c.workOrderId" class="flex flex-wrap items-start justify-between gap-2 rounded-detail border border-edge p-3" data-test="repair-candidate">
                <div>
                  <p class="font-medium text-ink">
                    {{ c.reference ?? c.workOrderId }}
                    <span class="font-normal text-ink-muted"> · opened {{ formatDate(c.openedOn) }} · {{ c.status?.toLowerCase() ?? "status unknown" }}</span>
                  </p>
                  <p v-if="c.jobs.length" class="text-ink-muted">{{ c.jobs.join(", ") }}</p>
                  <p v-else-if="c.description" class="text-ink-muted">{{ c.description }}</p>
                </div>
                <BaseButton
                  v-if="decidable(r) && r.decision?.workOrder?.workOrderId !== c.workOrderId"
                  :disabled="decide.isPending.value"
                  data-test="repair-accept"
                  @click="accept(r, c)"
                >
                  This is the repair
                </BaseButton>
              </li>
            </ul>

            <div v-if="decidable(r) && writingFor !== r.unitId" class="mt-3">
              <BaseButton variant="link" data-test="repair-outside" @click="startOutside(r)">Repaired outside FleetPal…</BaseButton>
            </div>
            <form v-if="writingFor === r.unitId" class="mt-3 space-y-3" data-test="repair-outside-form" @submit.prevent="saveOutside(r)">
              <FormField v-slot="{ id: fieldId }" label="Where was it repaired?" required>
                <BaseTextarea :id="fieldId" v-model="note" maxlength="1000" placeholder="For example: TA Joliet, road-service invoice 8812." />
              </FormField>
              <div class="flex gap-2">
                <BaseButton variant="primary" type="submit" :disabled="!note.trim() || decide.isPending.value" data-test="repair-outside-save">Save</BaseButton>
                <BaseButton @click="writingFor = null">Cancel</BaseButton>
              </div>
            </form>
          </section>
        </div>
      </QueryState>
    </div>

    <p v-if="failure" class="mt-3 text-sm text-danger-700" role="alert" data-test="repair-error">{{ failure }}</p>

    <section v-if="repairs?.length" class="mt-4 border-t border-edge pt-4 text-sm" data-test="repair-certification">
      <h3 class="text-sm font-semibold text-ink">Certification</h3>
      <p v-if="certification?.current" class="mt-1 text-ink" data-test="repair-certified">
        Certified by {{ certification.signerName }}, {{ certification.signerTitle }}, on {{ formatDate(certification.signedOn) }}. The repair record is on the Documents card.
      </p>
      <p v-else-if="certification" class="mt-1 text-warning-700" data-test="repair-certification-stale">
        Certified by {{ certification.signerName }} on {{ formatDate(certification.signedOn) }}, but a repair changed afterwards. Certify again.
      </p>
      <p v-else-if="!settled" class="mt-1 text-ink-muted" data-test="repair-certification-waits">
        Safety certifies the report once every unit's repair is recorded.
      </p>
      <p v-else-if="!canCertify" class="mt-1 text-ink-muted">Every repair is recorded. A safety manager certifies the report.</p>

      <form v-if="certifiable" class="mt-3 space-y-3" data-test="repair-certify-form" @submit.prevent="submitCertification">
        <p class="text-ink-muted">
          You certify that every violation on this report was corrected. Your name and today's date are recorded with it, and the repair record is filed on the Documents card.
        </p>
        <FormField v-slot="{ id: fieldId }" label="Your title" required>
          <BaseInput :id="fieldId" v-model="signerTitle" maxlength="120" placeholder="For example: Safety Director" data-test="repair-certify-title" />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="!signerTitle.trim() || certify.isPending.value" data-test="repair-certify">
          Certify repairs
        </BaseButton>
      </form>
      <p v-if="certifyFailure" class="mt-3 text-danger-700" role="alert" data-test="repair-certify-error">{{ certifyFailure }}</p>
    </section>
  </BaseCard>
</template>
