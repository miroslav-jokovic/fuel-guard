<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { CertificationCreateRequest, CertificationRow, CertificationKind } from "@fuelguard/shared";
import { HAZMAT_TRAINING_TYPES } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import { useDriversQuery } from "@/composables/useDrivers";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useCertificationsQuery, useCreateCertification } from "@/composables/useCompliance";

/**
 * Compliance — certifications management (M1/M2.5). Enter the temporal compliance records the §5
 * hazmat qualification gate reads: a driver's CDL, medical card, H/X (and N/X for tanks) endorsement
 * and the five §172.704(a) hazmat-training types; the carrier's PHMSA registration + insurance.
 * Until these exist a hazmat load stays in review (fail-closed) — this screen is what makes it clear.
 */
const session = useSessionStore();
const toast = useToastStore();
const { data: drivers } = useDriversQuery();

// Subject picker: "org" = the carrier, otherwise a driver id.
const subjectValue = ref<string>("");
const subjectOptions = computed(() => [
  { value: "org", label: "Carrier (organization)" },
  ...(drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);
const subjectType = computed<"driver" | "organization">(() => (subjectValue.value === "org" ? "organization" : "driver"));
const subjectId = computed<string | null>(() =>
  subjectValue.value === "org" ? session.orgId : (subjectValue.value || null),
);

const { data: certs, isLoading: certsLoading } = useCertificationsQuery(subjectType, subjectId);
const createCert = useCreateCertification();
const saving = computed(() => createCert.isPending.value);
const saveError = ref<string | null>(null);

const DRIVER_KINDS: CertificationKind[] = ["cdl", "medical_card", "endorsement", "hazmat_training", "twic"];
const ORG_KINDS: CertificationKind[] = ["phmsa_registration", "financial_responsibility", "insurance", "hazmat_safety_permit", "security_plan", "operating_authority"];

function labelForKind(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
const kindOptions = computed(() =>
  (subjectType.value === "organization" ? ORG_KINDS : DRIVER_KINDS).map((k) => ({ value: k, label: labelForKind(k) })),
);
const trainingTypeOptions = HAZMAT_TRAINING_TYPES.map((t) => ({ value: t, label: labelForKind(t) }));

const form = reactive({
  kind: "",
  qualifier: "",
  trainingType: "",
  trainingProviderName: "",
  trainingCertified: false,
  identifier: "",
  issuedAt: "",
  effectiveFrom: "",
  expiresAt: "",
});
const isEndorsement = computed(() => form.kind === "endorsement");
const isTraining = computed(() => form.kind === "hazmat_training");

function resetForm() {
  form.kind = ""; form.qualifier = ""; form.trainingType = ""; form.trainingProviderName = "";
  form.trainingCertified = false; form.identifier = ""; form.issuedAt = ""; form.effectiveFrom = ""; form.expiresAt = "";
}

async function submit() {
  saveError.value = null;
  const sid = subjectId.value;
  if (!sid) { saveError.value = "Select a driver or the carrier first."; return; }
  if (!form.kind) { saveError.value = "Choose a certification type."; return; }
  const body: CertificationCreateRequest = {
    id: crypto.randomUUID(),
    subjectType: subjectType.value,
    subjectId: sid,
    kind: form.kind as CertificationKind,
    qualifier: isEndorsement.value ? (form.qualifier.trim().toUpperCase() || null) : null,
    trainingType: isTraining.value ? (form.trainingType as (typeof HAZMAT_TRAINING_TYPES)[number]) : null,
    trainingProviderName: isTraining.value ? (form.trainingProviderName.trim() || null) : null,
    trainingCertified: isTraining.value ? form.trainingCertified : null,
    identifier: form.identifier.trim() || null,
    issuedAt: form.issuedAt || null,
    effectiveFrom: form.effectiveFrom || null,
    expiresAt: form.expiresAt || null,
  };
  try {
    const r = await createCert.mutateAsync(body);
    toast.success("Certification saved", r.supersededId ? "Replaced the previous current record." : undefined);
    resetForm();
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : "Could not save the certification.";
  }
}

const today = new Date().toISOString().slice(0, 10);
function statusOf(c: CertificationRow): { label: string; cls: string } {
  if (!c.expires_at) return { label: "no expiry", cls: "text-ink-muted" };
  const exp = c.expires_at.slice(0, 10);
  if (exp < today) return { label: "expired", cls: "text-danger-600" };
  const soon = new Date(today + "T00:00:00.000Z");
  soon.setUTCDate(soon.getUTCDate() + 30);
  if (exp <= soon.toISOString().slice(0, 10)) return { label: "expiring soon", cls: "text-warning-600" };
  return { label: "valid", cls: "text-success-600" };
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Certifications the hazmat qualification gate reads. A load stays in review until its driver and carrier have the required current records." />

    <BaseCard>
      <FormField v-slot="{ id }" label="Subject" hint="Pick a driver, or the carrier for organization-level records (PHMSA registration, insurance).">
        <ComboSelect :id="id" v-model="subjectValue" :options="subjectOptions" placeholder="Search drivers, or the carrier…" />
      </FormField>
    </BaseCard>

    <BaseCard v-if="subjectId" padding="none">
      <div class="border-b border-edge px-5 py-3">
        <h2 class="text-sm font-semibold text-ink">Current certifications</h2>
      </div>
      <p v-if="certsLoading" class="px-5 py-4 text-sm text-ink-muted">Loading…</p>
      <p v-else-if="!certs || certs.length === 0" class="px-5 py-8 text-center text-sm text-ink-muted">
        No certifications on file yet. Add the required records below.
      </p>
      <table v-else class="w-full text-sm">
        <thead class="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            <th class="px-5 py-2 font-medium">Type</th>
            <th class="px-5 py-2 font-medium">Qualifier</th>
            <th class="px-5 py-2 font-medium">Issued</th>
            <th class="px-5 py-2 font-medium">Expires</th>
            <th class="px-5 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in certs" :key="c.id" class="border-b border-edge last:border-0">
            <td class="px-5 py-2.5 text-ink">{{ labelForKind(c.kind) }}</td>
            <td class="px-5 py-2.5 text-ink-secondary">{{ c.qualifier ?? (c.training_type ? labelForKind(c.training_type) : "—") }}</td>
            <td class="px-5 py-2.5 text-ink-secondary">{{ c.issued_at ?? "—" }}</td>
            <td class="px-5 py-2.5 text-ink-secondary">{{ c.expires_at ?? "—" }}</td>
            <td class="px-5 py-2.5"><span :class="statusOf(c).cls">{{ statusOf(c).label }}</span></td>
          </tr>
        </tbody>
      </table>
    </BaseCard>

    <BaseCard v-if="subjectId">
      <h2 class="text-sm font-semibold text-ink">Add certification</h2>
      <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Type">
          <ComboSelect :id="id" v-model="form.kind" :options="kindOptions" placeholder="Certification type…" />
        </FormField>
        <FormField v-if="isEndorsement" v-slot="{ id }" label="Endorsement letter" hint="H or X for hazmat; N or X for cargo tank.">
          <BaseInput :id="id" v-model="form.qualifier" placeholder="H" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Training type">
          <ComboSelect :id="id" v-model="form.trainingType" :options="trainingTypeOptions" placeholder="Training type…" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Training provider">
          <BaseInput :id="id" v-model="form.trainingProviderName" placeholder="Provider name" />
        </FormField>
        <FormField v-slot="{ id }" label="Identifier" hint="Licence / policy / certificate number (optional).">
          <BaseInput :id="id" v-model="form.identifier" placeholder="Optional" />
        </FormField>
        <FormField v-slot="{ id }" label="Issued">
          <BaseInput :id="id" v-model="form.issuedAt" type="date" />
        </FormField>
        <FormField v-slot="{ id }" label="Effective from" hint="Defaults to today.">
          <BaseInput :id="id" v-model="form.effectiveFrom" type="date" />
        </FormField>
        <FormField v-slot="{ id }" label="Expires">
          <BaseInput :id="id" v-model="form.expiresAt" type="date" />
        </FormField>
      </div>
      <label v-if="isTraining" class="mt-3 flex items-center gap-2 text-sm text-ink">
        <BaseCheckbox v-model="form.trainingCertified" />
        I certify this training record is complete (§172.704(d)).
      </label>
      <div class="mt-4 flex items-center gap-3">
        <BaseButton variant="primary" size="sm" :disabled="saving" @click="submit">
          {{ saving ? "Saving…" : "Save certification" }}
        </BaseButton>
        <p v-if="saveError" class="text-sm text-danger-600">{{ saveError }}</p>
      </div>
    </BaseCard>
  </div>
</template>
