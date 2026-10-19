<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppFormField as FormField,
  AppInput as BaseInput,
  QueryState,
} from "@silvicom/ui";
import { repairSettled, todayInZone } from "@silvicom/shared";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import { formatDate } from "@/lib/format";
import { RepairDecisionError, useCertifyRepairs, useInspectionRepairsQuery, useRepairCertificationQuery } from "./useRoadsideInspections";
import RepairUnitDecision from "./RepairUnitDecision.vue";

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
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

const { data: repairs, isLoading, isError, error, isFetching, refetch } = useInspectionRepairsQuery(id);

const show = computed(() => isLoading.value || isError.value || (repairs.value?.length ?? 0) > 0);

const canCertify = computed(() => session.can("safety"));
const { data: certification } = useRepairCertificationQuery(id);
const certify = useCertifyRepairs(id);
const settled = computed(() => (repairs.value?.length ?? 0) > 0 && repairs.value!.every(repairSettled));
/** The certification stands over every unit: the units fold behind it. */
const folded = computed(() => !!certification.value?.current);
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

    <!-- Once the certification stands, the units are the record behind it: folded to one line, open on a click
         (Q-IC17 — a settled section reads as its answer). -->
    <component :is="folded ? 'details' : 'div'" class="mt-4" data-test="repair-state">
      <summary v-if="folded" class="cursor-pointer text-sm font-medium text-ink-muted" data-test="repair-folded">
        Every repair is recorded and certified. Show the units
      </summary>
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
          <RepairUnitDecision
            v-for="r in repairs"
            :key="r.unitId"
            class="py-4 first:pt-0 last:pb-0"
            :inspection-id="inspectionId"
            :repair="r"
            :today="today"
          />
        </div>
      </QueryState>
    </component>


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
