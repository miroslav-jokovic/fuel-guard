<script setup lang="ts">
import { computed, reactive, ref, toRef } from "vue";
import type { CertificationCreateRequest, CertificationRow, CertificationKind } from "@fuelguard/shared";
import { HAZMAT_TRAINING_TYPES } from "@fuelguard/shared";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import FormField from "@/components/ui/FormField.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import { useToastStore } from "@/stores/toast";
import { useCertificationsQuery, useCreateCertification } from "@/composables/useCompliance";

/** Reusable certifications editor for one subject (a driver, or the carrier organization). */
const props = defineProps<{ subjectType: "driver" | "organization"; subjectId: string }>();
const toast = useToastStore();

const subjectTypeRef = toRef(props, "subjectType");
const subjectIdRef = computed<string | null>(() => props.subjectId);
const { data: certs, isLoading } = useCertificationsQuery(subjectTypeRef, subjectIdRef);
const createCert = useCreateCertification();
const saving = computed(() => createCert.isPending.value);
const saveError = ref<string | null>(null);

const DRIVER_KINDS: CertificationKind[] = ["cdl", "medical_card", "endorsement", "hazmat_training", "twic"];
const ORG_KINDS: CertificationKind[] = ["phmsa_registration", "financial_responsibility", "insurance", "hazmat_safety_permit", "security_plan", "operating_authority"];
function labelForKind(k: string): string { return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
const kindOptions = computed(() => (props.subjectType === "organization" ? ORG_KINDS : DRIVER_KINDS).map((k) => ({ value: k, label: labelForKind(k) })));
const trainingTypeOptions = HAZMAT_TRAINING_TYPES.map((t) => ({ value: t, label: labelForKind(t) }));

const form = reactive({ kind: "", qualifier: "", trainingType: "", trainingProviderName: "", trainingCertified: false, identifier: "", issuedAt: "", effectiveFrom: "", expiresAt: "" });
const isEndorsement = computed(() => form.kind === "endorsement");
const isTraining = computed(() => form.kind === "hazmat_training");
function resetForm() { form.kind = ""; form.qualifier = ""; form.trainingType = ""; form.trainingProviderName = ""; form.trainingCertified = false; form.identifier = ""; form.issuedAt = ""; form.effectiveFrom = ""; form.expiresAt = ""; }

async function submit() {
  saveError.value = null;
  if (!form.kind) { saveError.value = "Choose a certification type."; return; }
  const body: CertificationCreateRequest = {
    id: crypto.randomUUID(),
    subjectType: props.subjectType,
    subjectId: props.subjectId,
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
  } catch (e) { saveError.value = e instanceof Error ? e.message : "Could not save the certification."; }
}

const today = new Date().toISOString().slice(0, 10);
function statusOf(c: CertificationRow): { label: string; cls: string } {
  if (!c.expires_at) return { label: "no expiry", cls: "text-ink-muted" };
  const exp = c.expires_at.slice(0, 10);
  if (exp < today) return { label: "expired", cls: "text-danger-600" };
  const soon = new Date(today + "T00:00:00.000Z"); soon.setUTCDate(soon.getUTCDate() + 30);
  if (exp <= soon.toISOString().slice(0, 10)) return { label: "expiring soon", cls: "text-warning-600" };
  return { label: "valid", cls: "text-success-600" };
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-semibold text-ink">Current records</h3>
      <p v-if="isLoading" class="mt-2 text-sm text-ink-muted">Loading…</p>
      <p v-else-if="!certs || certs.length === 0" class="mt-2 text-sm text-ink-muted">No records on file yet.</p>
      <table v-else class="mt-2 w-full text-sm">
        <thead class="text-left text-xs uppercase tracking-wide text-ink-subtle">
          <tr><th class="py-1 pr-3 font-medium">Type</th><th class="py-1 pr-3 font-medium">Qualifier</th><th class="py-1 pr-3 font-medium">Expires</th><th class="py-1 font-medium">Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in certs" :key="c.id" class="border-t border-edge-subtle">
            <td class="py-1.5 pr-3 text-ink">{{ labelForKind(c.kind) }}</td>
            <td class="py-1.5 pr-3 text-ink-secondary">{{ c.qualifier ?? (c.training_type ? labelForKind(c.training_type) : "—") }}</td>
            <td class="py-1.5 pr-3 text-ink-secondary">{{ c.expires_at ?? "—" }}</td>
            <td class="py-1.5"><span :class="statusOf(c).cls">{{ statusOf(c).label }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="border-t border-edge pt-5">
      <h3 class="text-sm font-semibold text-ink">Add record</h3>
      <div class="mt-3 space-y-4">
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
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Issued"><BaseInput :id="id" v-model="form.issuedAt" type="date" /></FormField>
          <FormField v-slot="{ id }" label="Effective from" hint="Defaults to today."><BaseInput :id="id" v-model="form.effectiveFrom" type="date" /></FormField>
          <FormField v-slot="{ id }" label="Expires"><BaseInput :id="id" v-model="form.expiresAt" type="date" /></FormField>
        </div>
        <label v-if="isTraining" class="flex items-center gap-2 text-sm text-ink">
          <BaseCheckbox v-model="form.trainingCertified" /> I certify this training record is complete (§172.704(d)).
        </label>
        <div class="flex items-center gap-3">
          <BaseButton variant="primary" size="sm" :disabled="saving" @click="submit">{{ saving ? "Saving…" : "Add record" }}</BaseButton>
          <p v-if="saveError" class="text-sm text-danger-600">{{ saveError }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
