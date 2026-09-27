<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";
import { useRecordPortalConsent } from "@/features/recruitment/useApplicantScreening";

/**
 * The driver's consent to the full Clearinghouse query — D-AW5 (APPLICATION-FLOW-V2-PLAN §6.3 item 5,
 * C2b3).
 *
 * ── THE DRIVER'S MOVE, THEN THE OFFICE'S ──────────────────────────────────────────────────────
 * §382.703: the pre-employment full query needs the driver's own consent, which they give in FMCSA's
 * portal after registering there. The carrier never holds it, so the office records that the portal
 * shows it — and from then on the row is the office's move: run the query. The row's state IS that
 * reading (`hiringChecklist`: "waiting on them" until a consent is on file), so this panel reads the
 * row rather than asking the records a second time.
 *
 * ⚠ And the order after the drug result is the carrier's preference, not a rule (§382.701(a)(1) and
 * §382.301(a) order neither — D-AW5), so it is a WARNING here and never a refusal.
 *
 * ⚠ A testing record (§382.401(a), 0376's policies): a role that may not read it is told who records
 * it, rather than shown a form the API refuses.
 */
const props = defineProps<{ driverId: string; consented: boolean; done: boolean }>();

const session = useSessionStore();
const toast = useToastStore();
const record = useRecordPortalConsent();
const driverId = computed(() => props.driverId);
const checklistQ = useApplicantChecklistQuery(driverId);

const canRecord = computed(() => session.canReadKind("clearinghouse_portal_consent"));
const drugTestPending = computed(() => {
  const step = checklistQ.data.value?.steps.find((s) => s.key === "drug_test");
  return Boolean(step) && step!.state !== "done";
});

const occurredOn = ref("");

async function save(): Promise<void> {
  try {
    const r = await record.mutateAsync({ driverId: props.driverId, occurredOn: occurredOn.value });
    toast.success(r.created ? "Consent recorded" : "Already recorded for that day");
    occurredOn.value = "";
  } catch (e) {
    toast.error("Could not record the consent", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div v-if="!done" class="space-y-4 border-t border-edge pt-6">
    <p class="text-sm font-medium text-ink">The driver's consent</p>
    <p v-if="consented" class="text-xs text-ink-secondary">
      Recorded — the portal shows their consent, so the query is yours to run.
    </p>
    <template v-else>
      <p class="text-xs text-ink-secondary">
        The driver registers in FMCSA's Clearinghouse and consents to the full query there. Record it once
        the portal shows it.
      </p>
      <div v-if="canRecord" class="flex flex-wrap items-end gap-2">
        <FormField v-slot="{ id }" label="Consent shown in the portal on">
          <AppDateField :id="id" v-model="occurredOn" />
        </FormField>
        <BaseButton size="sm" :disabled="!occurredOn || record.isPending.value" @click="save">Record the consent</BaseButton>
      </div>
      <p v-else class="text-xs text-ink-muted">A safety manager or an admin records it: it is a drug and alcohol record.</p>
    </template>
    <p v-if="drugTestPending" class="text-xs text-warning-700">
      The drug test result is not in yet. The office's order is the result first, then the query — you can
      still run it.
    </p>
  </div>
</template>
